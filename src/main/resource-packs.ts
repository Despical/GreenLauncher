import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import type { InstalledResourcePack } from '../shared/types'
import type { LauncherStore } from './store'
import type { ModrinthService } from './modrinth'
import type { CurseForgeService } from './curseforge'
import { downloadVerified } from './modrinth-download'
import { diskSpace } from './disk-space'

type PackMetadata = { description: string; format?: string; icon?: string }
type ManagedPack = Pick<InstalledResourcePack, 'filename' | 'title' | 'provider' | 'projectId' | 'versionId' | 'versionNumber' | 'sourceUrl'>
const validName = (name: string) => typeof name === 'string' && !!name && basename(name) === name && !/[\\/:\x00-\x1f]/.test(name) && name !== '.' && name !== '..'
const noLink = (path: string) => { if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Kaynak paketi yolu doğrulanamadı.') }
function metadata(bytes: Buffer, icon?: Buffer): PackMetadata {
  const pack = JSON.parse(bytes.toString('utf8')).pack
  if (!pack || typeof pack !== 'object') throw new Error('Kaynak paketi dosyası doğrulanamadı.')
  const text = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text((value as { text?: unknown }).text) + text((value as { extra?: unknown }).extra) : ''
  const format = Array.isArray(pack.pack_format) ? pack.pack_format.join('.') : typeof pack.pack_format === 'number' ? String(pack.pack_format) : Array.isArray(pack.min_format) ? pack.min_format.join('.') : undefined
  return { description: text(pack.description).replace(/§./g, '').slice(0, 2000), format, icon: icon?.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? `data:image/png;base64,${icon.toString('base64')}` : undefined }
}
/** Inspect only two bounded ZIP entries; never extract an archive to disk. */
export async function inspectResourcePack(path: string): Promise<PackMetadata> {
  noLink(path)
  if (statSync(path).isDirectory()) {
    const info = join(path, 'pack.mcmeta'), icon = join(path, 'pack.png')
    noLink(info); noLink(icon)
    if (!existsSync(info) || statSync(info).size > 65536) return Promise.reject(new Error('Kaynak paketi dosyası doğrulanamadı.'))
    return Promise.resolve(metadata(readFileSync(info), existsSync(icon) && statSync(icon).size <= 262144 ? readFileSync(icon) : undefined))
  }
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('Kaynak paketi dosyası doğrulanamadı.')); return }
      let info: Buffer | undefined, icon: Buffer | undefined, count = 0, settled = false
      const fail = (error: Error) => { if (settled) return; settled = true; zip.close(); reject(error) }
      zip.on('error', fail)
      zip.on('entry', entry => {
        if (++count > 50000) { fail(new Error('Kaynak paketi dosyası doğrulanamadı.')); return }
        const limit = entry.fileName === 'pack.mcmeta' ? 65536 : entry.fileName === 'pack.png' ? 262144 : 0
        if (!limit || entry.uncompressedSize > limit) { zip.readEntry(); return }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { fail(error ?? new Error('Kaynak paketi dosyası doğrulanamadı.')); return }
          const chunks: Buffer[] = []; let size = 0
          stream.on('error', fail)
          stream.on('data', chunk => { size += chunk.length; if (size > limit) { stream.destroy(); fail(new Error('Kaynak paketi dosyası doğrulanamadı.')) } else chunks.push(chunk) })
          stream.on('end', () => { if (settled) return; if (entry.fileName === 'pack.mcmeta') info = Buffer.concat(chunks); else icon = Buffer.concat(chunks); zip.readEntry() })
        })
      })
      zip.on('end', () => { if (settled) return; settled = true; try { if (!info) throw new Error('Kaynak paketi dosyası doğrulanamadı.'); resolve(metadata(info, icon)) } catch { reject(new Error('Kaynak paketi dosyası doğrulanamadı.')) } })
      zip.readEntry()
    })
  })
}

export class ResourcePacks {
  constructor(private store: LauncherStore, private modrinth: ModrinthService, private curseforge: CurseForgeService, private busy: (profileId: string) => boolean = () => false) {}
  private paths(profileId: string) {
    const profile = this.store.get().profiles.find(profile => profile.id === profileId)
    if (!profile) throw new Error('Profil bulunamadı.')
    const game = this.store.gamePath(profile), directory = join(game, 'resourcepacks'), options = join(game, 'options.txt'), manifest = join(this.store.profilePath(profileId), 'green-launcher-resourcepacks.json')
    for (const path of [directory, options, manifest]) noLink(path)
    return { profile, directory, options, manifest }
  }
  private managed(path: string): ManagedPack[] {
    if (!existsSync(path)) return []
    try { const items = JSON.parse(readFileSync(path, 'utf8')); return Array.isArray(items) ? items.filter(item => validName(item?.filename) && ['modrinth', 'curseforge'].includes(item.provider) && typeof item.title === 'string') : [] } catch { return [] }
  }
  private selected(path: string): { text: string; packs: string[] } {
    const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const raw = text.match(/^resourcePacks:(.*)$/m)?.[1].trim()
    if (raw === undefined) return { text, packs: [] }
    try { const packs = JSON.parse(raw); if (!Array.isArray(packs) || packs.some(pack => typeof pack !== 'string')) throw Error(); return { text, packs } } catch { throw new Error('Kaynak paketi listesi okunamadı.') }
  }
  private writeSelection(path: string, text: string, packs: string[]) {
    const line = `resourcePacks:${JSON.stringify(packs)}`, newline = text.includes('\r\n') ? '\r\n' : '\n'
    const next = /^resourcePacks:/m.test(text) ? text.replace(/^resourcePacks:[^\r\n]*/m, line) : text + (text && !text.endsWith('\n') ? newline : '') + line + newline
    const temp = `${path}.${randomUUID()}.tmp`
    writeFileSync(temp, next, 'utf8'); renameSync(temp, path)
  }
  async list(profileId: string): Promise<InstalledResourcePack[]> {
    const { directory, manifest, options } = this.paths(profileId)
    if (!existsSync(directory)) return []
    const known = new Map(this.managed(manifest).map(pack => [pack.filename, pack])), { packs } = this.selected(options)
    const items = readdirSync(directory, { withFileTypes: true }).filter(item => !item.isSymbolicLink() && (item.isDirectory() || item.isFile() && /\.zip$/i.test(item.name)))
    const result: InstalledResourcePack[] = []
    // Sequential inspection bounds open descriptors and ZIP decompression memory.
    for (const file of items) {
      const path = join(directory, file.name)
      let info: PackMetadata
      try { info = await inspectResourcePack(path) } catch { if (file.isDirectory()) continue; info = { description: '' } }
      result.push({ ...known.get(file.name), filename: file.name, title: known.get(file.name)?.title ?? file.name.replace(/\.zip$/i, ''), ...info, modifiedAt: statSync(path).mtime.toISOString(), enabled: packs.includes(`file/${file.name}`) || packs.includes(`file:${file.name}`) || packs.includes(file.name) })
    }
    return result.sort((a, b) => a.title.localeCompare(b.title))
  }
  async enable(profileId: string, filename: string, enabled: boolean): Promise<InstalledResourcePack[]> {
    if (this.busy(profileId)) throw new Error('Kaynak paketlerini değiştirmek için oyunu kapat.')
    const { directory, options } = this.paths(profileId)
    if (!validName(filename) || !existsSync(join(directory, filename))) throw new Error('Kaynak paketi bulunamadı.')
    await inspectResourcePack(join(directory, filename))
    const { text, packs } = this.selected(options)
    const next = packs.filter(pack => ![filename, `file/${filename}`, `file:${filename}`].includes(pack))
    if (enabled) next.push(`file/${filename}`)
    this.writeSelection(options, text, next)
    return this.list(profileId)
  }
  async install(profileId: string, versionId: string, provider: 'modrinth' | 'curseforge'): Promise<InstalledResourcePack[]> {
    if (this.busy(profileId)) throw new Error('Kaynak paketlerini değiştirmek için oyunu kapat.')
    if (!['modrinth', 'curseforge'].includes(provider)) throw new Error('Geçersiz mod kaynağı.')
    const { profile, directory, manifest, options } = this.paths(profileId)
    const gameVersion = profile.versionId.split(/-OptiFine_/i)[0]
    let record: ManagedPack, original: string, download: (path: string) => Promise<void>
    if (provider === 'modrinth') {
      const plan = await this.modrinth.resourcePack(versionId, gameVersion)
      original = plan.file.filename
      record = { filename: '', title: plan.project.title, provider, projectId: plan.project.id, versionId: plan.version.id, versionNumber: plan.version.versionNumber, sourceUrl: plan.project.sourceUrl ?? undefined }
      download = path => downloadVerified([plan.file.url], plan.file.hashes, path, join(this.store.dataPath, 'cache', 'modrinth-files'))
    } else {
      const file = await this.curseforge.file(versionId)
      if (await this.curseforge.destination(String(file.modId)) !== 'resourcepacks' || !file.gameVersions.includes(gameVersion)) throw new Error('Kaynak paketi profilin Minecraft sürümüyle uyumlu değil.')
      const project = await this.curseforge.project(String(file.modId))
      original = file.fileName
      record = { filename: '', title: project.title, provider, projectId: project.id, versionId, versionNumber: file.displayName, sourceUrl: project.sourceUrl ?? undefined }
      download = path => this.curseforge.download(file, path)
    }
    if (!validName(original) || !/\.zip$/i.test(original)) throw new Error('Kaynak paketi dosyası doğrulanamadı.')
    record.filename = `${provider}-${record.projectId}-${versionId.replace(/:/g, '-')}-${original.replace(/[^a-zA-Z0-9._+() -]/g, '_').slice(0, 120)}`
    if (!validName(record.filename)) throw new Error('Kaynak paketi dosyası doğrulanamadı.')
    const staging = join(this.store.dataPath, 'cache', 'resourcepacks'); mkdirSync(staging, { recursive: true })
    const archive = join(staging, `${randomUUID()}.zip`)
    await download(archive); await inspectResourcePack(archive)
    if (this.busy(profileId)) throw new Error('Kaynak paketlerini değiştirmek için oyunu kapat.')
    // Revalidate after asynchronous requests. Game options are read at commit time.
    this.paths(profileId)
    const selected = this.selected(options), managed = this.managed(manifest)
    const previous = managed.find(pack => pack.provider === provider && pack.projectId === record.projectId)
    mkdirSync(directory, { recursive: true })
    const target = join(directory, record.filename); noLink(target)
    diskSpace().check(target, statSync(archive).size)
    if (existsSync(target)) record.filename = record.filename.replace(/\.zip$/i, `-${randomUUID().slice(0, 8)}.zip`)
    copyFileSync(archive, join(directory, record.filename))
    let packs = selected.packs
    if (previous && previous.filename !== record.filename) {
      const wasEnabled = packs.some(pack => [previous.filename, `file/${previous.filename}`, `file:${previous.filename}`].includes(pack))
      packs = packs.filter(pack => ![previous.filename, `file/${previous.filename}`, `file:${previous.filename}`].includes(pack))
      if (wasEnabled) packs.push(`file/${record.filename}`)
      // Keep the old archive as a backup without showing two active versions.
      const old = join(directory, previous.filename); noLink(old)
      if (existsSync(old)) renameSync(old, `${old}.${randomUUID()}.disabled`)
    }
    const next = [...managed.filter(pack => pack.provider !== provider || pack.projectId !== record.projectId), record]
    const temp = `${manifest}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8'); renameSync(temp, manifest)
    if (packs !== selected.packs) this.writeSelection(options, selected.text, packs)
    return this.list(profileId)
  }
}
