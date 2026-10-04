import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'
import type { InstalledMod, InstalledResourcePack } from '../shared/types'
import type { LauncherStore } from './store'
import type { ModrinthService } from './modrinth'
import type { CurseForgeService } from './curseforge'
import { downloadVerified } from './modrinth-download'
import { diskSpace } from './disk-space'
import { inspectShaderPack, shaderConfiguration, readShaderSelection, writeShaderSelection } from './shader-packs'
import { modFileHash } from './mod-metadata'

type PackMetadata = { description: string; format?: string; icon?: string }
type ManagedPack = Pick<InstalledResourcePack, 'filename' | 'title' | 'provider' | 'projectId' | 'versionId' | 'versionNumber' | 'sourceUrl' | 'fileHash' | 'icon'> & { description?: string }
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
  private descriptions = new Map<string, { expires: number; task: Promise<string> }>()
  private listing = new Map<string, Promise<InstalledResourcePack[]>>()
  private metadata = new Map<string, { signature: string; hashed: boolean; task: Promise<{ info?: PackMetadata; hash?: string }> }>()
  private identified = new Map<string, { retryAt: number; match?: Omit<InstalledMod, 'filename'> }>()
  constructor(private store: LauncherStore, private modrinth: ModrinthService, private curseforge: CurseForgeService, private busy: (profileId: string) => boolean = () => false, private kind: 'resourcepack' | 'shader' = 'resourcepack') {}
  private paths(profileId: string) {
    const profile = this.store.get().profiles.find(profile => profile.id === profileId)
    if (!profile) throw new Error('Profil bulunamadı.')
    const game = this.store.gamePath(profile), directory = join(game, this.kind === 'shader' ? 'shaderpacks' : 'resourcepacks'), options = this.kind === 'shader' ? shaderConfiguration(game, /-OptiFine_/i.test(profile.versionId)).path : join(game, 'options.txt'), manifest = join(this.store.profilePath(profileId), this.kind === 'shader' ? 'green-launcher-shaderpacks.json' : 'green-launcher-resourcepacks.json')
    for (const path of [directory, options, manifest]) noLink(path)
    return { profile, directory, options, manifest }
  }
  private inspect(path: string): Promise<PackMetadata> { return this.kind === 'shader' ? inspectShaderPack(path) : inspectResourcePack(path) }
  private description(pack: ManagedPack): Promise<string> {
    const key = `${pack.provider}:${pack.projectId}`, cached = this.descriptions.get(key)
    if (cached && cached.expires > Date.now()) return cached.task
    const service = pack.provider === 'modrinth' ? this.modrinth : this.curseforge
    if (!pack.projectId || !service.project) return Promise.resolve('')
    const entry = { expires: Date.now() + 10 * 60_000, task: Promise.resolve('') }
    entry.task = service.project(pack.projectId).then(project => project.projectType === this.kind ? project.description.slice(0, 2000) : '').catch(() => { entry.expires = Date.now() + 60_000; return '' })
    this.descriptions.set(key, entry)
    while (this.descriptions.size > 256) this.descriptions.delete(this.descriptions.keys().next().value!)
    return entry.task
  }
  private managed(path: string): ManagedPack[] {
    if (!existsSync(path)) return []
    try { const items = JSON.parse(readFileSync(path, 'utf8')); return Array.isArray(items) ? items.filter(item => validName(item?.filename) && ['modrinth', 'curseforge'].includes(item.provider) && typeof item.title === 'string') : [] } catch { return [] }
  }
  private selected(path: string): { text: string; packs: string[] } {
    if (this.kind === 'shader') return readShaderSelection(path)
    const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const raw = text.match(/^resourcePacks:(.*)$/m)?.[1].trim()
    if (raw === undefined) return { text, packs: [] }
    try { const packs = JSON.parse(raw); if (!Array.isArray(packs) || packs.some(pack => typeof pack !== 'string')) throw Error(); return { text, packs } } catch { throw new Error('Kaynak paketi listesi okunamadı.') }
  }
  private writeSelection(path: string, text: string, packs: string[]) {
    if (this.kind === 'shader') { writeShaderSelection(path, text, packs); return }
    const line = `resourcePacks:${JSON.stringify(packs)}`, newline = text.includes('\r\n') ? '\r\n' : '\n'
    const next = /^resourcePacks:/m.test(text) ? text.replace(/^resourcePacks:[^\r\n]*/m, line) : text + (text && !text.endsWith('\n') ? newline : '') + line + newline
    const temp = `${path}.${randomUUID()}.tmp`
    writeFileSync(temp, next, 'utf8'); renameSync(temp, path)
  }
  async list(profileId: string): Promise<InstalledResourcePack[]> {
    const pending = this.listing.get(profileId)
    if (pending) return pending
    const task = this.listFiles(profileId).finally(() => { if (this.listing.get(profileId) === task) this.listing.delete(profileId) })
    this.listing.set(profileId, task)
    return task
  }
  private remember(profileId: string, records: ManagedPack[]) {
    const { manifest } = this.paths(profileId)
    if (existsSync(manifest)) {
      try { const parsed = JSON.parse(readFileSync(manifest, 'utf8')); if (!Array.isArray(parsed) || this.managed(manifest).length !== parsed.length) return } catch { return }
    }
    const current = this.managed(manifest)
    for (const record of records) {
      const index = current.findIndex(item => item.filename === record.filename)
      if (index < 0) current.push(record)
      else if (current[index].fileHash || !current[index].versionId || !current[index].projectId) current[index] = record
      else if (!current[index].description && record.description) current[index] = { ...current[index], description: record.description }
    }
    mkdirSync(this.store.profilePath(profileId), { recursive: true })
    const temporary = `${manifest}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(current, null, 2)); renameSync(temporary, manifest)
  }
  private async listFiles(profileId: string): Promise<InstalledResourcePack[]> {
    const { directory, manifest, options } = this.paths(profileId)
    if (!existsSync(directory)) return []
    const known = new Map(this.managed(manifest).map(pack => [pack.filename, pack])), { packs } = this.selected(options)
    const items = readdirSync(directory, { withFileTypes: true }).filter(item => !item.isSymbolicLink() && (item.isDirectory() || item.isFile() && /\.zip$/i.test(item.name)))
    const signature = (info: { size: number; mtimeMs: number; ctimeMs: number }) => `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
    const inspected: Array<{ filename: string; signature: string; modifiedAt: string; info: PackMetadata; hash?: string; record?: ManagedPack }> = []
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
      while (cursor < items.length) {
        const file = items[cursor++], path = join(directory, file.name)
        noLink(path)
        const stats = statSync(path), key = signature(stats)
        let record = known.get(file.name), cached = this.metadata.get(path)
        const hashRequired = file.isFile() && stats.size <= 256 * 1024 * 1024 && (!record?.versionId || !record.projectId || !!record.fileHash)
        // Directory packs are inexpensive and their child metadata can change independently.
        if (!cached || cached.signature !== key || file.isDirectory() || hashRequired && !cached.hashed) {
          cached = { signature: key, hashed: hashRequired, task: Promise.all([this.inspect(path).catch(() => undefined), hashRequired ? modFileHash(path).catch(() => undefined) : Promise.resolve(undefined)]).then(([info, hash]) => ({ info, hash })) }
          this.metadata.set(path, cached)
          if (this.metadata.size > 512) this.metadata.delete(this.metadata.keys().next().value!)
        }
        const { info, hash } = await cached.task
        if (!info && file.isDirectory()) continue
        if (record?.fileHash && record.fileHash !== hash) record = undefined
        inspected.push({ filename: file.name, signature: key, modifiedAt: stats.mtime.toISOString(), info: info ?? { description: '' }, hash, record })
      }
    }))
    const hashes = [...new Set(inspected.filter(item => !item.record?.versionId || !item.record.projectId).flatMap(item => item.hash && (this.identified.get(item.hash)?.retryAt ?? 0) <= Date.now() ? [item.hash] : []))]
    if (hashes.length && this.modrinth.identify) {
      try { const matches = await this.modrinth.identify(hashes, this.kind); for (const hash of hashes) this.identified.set(hash, { retryAt: Date.now() + 10 * 60_000, match: matches.get(hash) }) }
      catch { for (const hash of hashes) this.identified.set(hash, { retryAt: Date.now() + 60_000 }) }
      while (this.identified.size > 2000) this.identified.delete(this.identified.keys().next().value!)
    }
    if (this.paths(profileId).directory !== directory) throw new Error('Profil ayarları değişti. Tekrar dene.')
    const missing = inspected.filter(item => item.record && !item.info.description && !item.record.description)
    let detailCursor = 0
    await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
      while (detailCursor < missing.length) {
        const item = missing[detailCursor++], description = await this.description(item.record!)
        if (description) item.record = { ...item.record!, description }
      }
    }))
    if (this.paths(profileId).directory !== directory) throw new Error('Profil ayarları değişti. Tekrar dene.')
    const result: InstalledResourcePack[] = [], recovered: ManagedPack[] = []
    for (const item of inspected) {
      const path = join(directory, item.filename)
      if (!existsSync(path)) continue
      noLink(path)
      if (signature(statSync(path)) !== item.signature) continue
      let record = item.record
      const match = item.hash ? this.identified.get(item.hash)?.match : undefined
      if ((!record?.versionId || !record.projectId) && match?.provider === 'modrinth') {
        record = { filename: item.filename, title: match.title, provider: 'modrinth', projectId: match.projectId, versionId: match.versionId, versionNumber: match.versionNumber, sourceUrl: match.sourceUrl, icon: match.icon, description: match.description, fileHash: item.hash }
        recovered.push(record)
      }
      else if (record?.description && !known.get(item.filename)?.description) recovered.push(record)
      result.push({ ...record, filename: item.filename, title: record?.title ?? item.filename.replace(/\.zip$/i, ''), ...item.info, description: item.info.description || record?.description || '', icon: item.info.icon ?? record?.icon, modifiedAt: item.modifiedAt, enabled: packs.includes(`file/${item.filename}`) || packs.includes(`file:${item.filename}`) || packs.includes(item.filename) })
    }
    if (recovered.length) this.remember(profileId, recovered)
    return result.sort((a, b) => a.title.localeCompare(b.title))
  }
  async enable(profileId: string, filename: string, enabled: boolean): Promise<InstalledResourcePack[]> {
    if (this.busy(profileId)) throw new Error('Kaynak paketlerini değiştirmek için oyunu kapat.')
    const { profile, directory, options } = this.paths(profileId)
    if (this.kind === 'shader' && enabled && !shaderConfiguration(this.store.gamePath(profile), /-OptiFine_/i.test(profile.versionId)).engine) throw new Error('Shader paketlerini kullanmak için Iris, Oculus veya OptiFine gerekir.')
    if (!validName(filename) || !existsSync(join(directory, filename))) throw new Error('Kaynak paketi bulunamadı.')
    await this.inspect(join(directory, filename))
    if (this.busy(profileId)) throw new Error('Paketleri değiştirmek için oyunu kapat.')
    const fresh = this.paths(profileId)
    if (fresh.directory !== directory || fresh.options !== options) throw new Error('Profil ayarları değişti. Tekrar dene.')
    const { text, packs } = this.selected(options)
    const next = this.kind === 'shader' && enabled ? [] : packs.filter(pack => ![filename, `file/${filename}`, `file:${filename}`].includes(pack))
    if (enabled) next.push(`file/${filename}`)
    this.writeSelection(options, text, next)
    this.listing.delete(profileId)
    return this.list(profileId)
  }
  async install(profileId: string, versionId: string, provider: 'modrinth' | 'curseforge'): Promise<InstalledResourcePack[]> {
    if (this.busy(profileId)) throw new Error('Kaynak paketlerini değiştirmek için oyunu kapat.')
    if (!['modrinth', 'curseforge'].includes(provider)) throw new Error('Geçersiz mod kaynağı.')
    const { profile, directory, manifest, options } = this.paths(profileId)
    const gameVersion = profile.versionId.split(/-OptiFine_/i)[0]
    let record: ManagedPack, original: string, download: (path: string) => Promise<void>
    if (provider === 'modrinth') {
      const plan = await this.modrinth.resourcePack(versionId, gameVersion, this.kind)
      original = plan.file.filename
      record = { filename: '', title: plan.project.title, provider, projectId: plan.project.id, versionId: plan.version.id, versionNumber: plan.version.versionNumber, sourceUrl: plan.project.sourceUrl ?? undefined, description: plan.project.description }
      download = path => downloadVerified([plan.file.url], plan.file.hashes, path, join(this.store.dataPath, 'cache', 'modrinth-files'))
    } else {
      const file = await this.curseforge.file(versionId)
      if (await this.curseforge.destination(String(file.modId)) !== (this.kind === 'shader' ? 'shaderpacks' : 'resourcepacks') || !file.gameVersions.includes(gameVersion)) throw new Error('Kaynak paketi profilin Minecraft sürümüyle uyumlu değil.')
      const project = await this.curseforge.project(String(file.modId))
      original = file.fileName
      record = { filename: '', title: project.title, provider, projectId: project.id, versionId, versionNumber: file.displayName, sourceUrl: project.sourceUrl ?? undefined, description: project.description }
      download = path => this.curseforge.download(file, path)
    }
    if (!validName(original) || !/\.zip$/i.test(original)) throw new Error('Kaynak paketi dosyası doğrulanamadı.')
    record.filename = `${provider}-${record.projectId}-${versionId.replace(/:/g, '-')}-${original.replace(/[^a-zA-Z0-9._+() -]/g, '_').slice(0, 120)}`
    if (!validName(record.filename)) throw new Error('Kaynak paketi dosyası doğrulanamadı.')
    const staging = join(this.store.dataPath, 'cache', this.kind === 'shader' ? 'shaderpacks' : 'resourcepacks'); mkdirSync(staging, { recursive: true })
    const archive = join(staging, `${randomUUID()}.zip`)
    await download(archive); await this.inspect(archive)
    if (statSync(archive).size <= 256 * 1024 * 1024) record.fileHash = await modFileHash(archive)
    if (this.busy(profileId)) throw new Error('Kaynak paketlerini değiştirmek için oyunu kapat.')
    // Revalidate after asynchronous requests. Game options are read at commit time.
    const fresh = this.paths(profileId)
    if (fresh.directory !== directory || fresh.options !== options || fresh.profile.versionId.split(/-OptiFine_/i)[0] !== gameVersion) throw new Error('Profil ayarları değişti. Tekrar dene.')
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
    this.listing.delete(profileId)
    return this.list(profileId)
  }
}
