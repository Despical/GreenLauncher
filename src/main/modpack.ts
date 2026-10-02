import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import type { LauncherActivity, LauncherProfile, LauncherState, ModLoader } from '../shared/types'
import { GameService, message } from './game'
import { LauncherStore } from './store'
import { downloadVerified, type FileHashes } from './modrinth-download'

type PackFile = { path: string; hashes: FileHashes; downloads: string[]; fileSize?: number; env?: { client?: 'required' | 'optional' | 'unsupported' } }
type PackIndex = { formatVersion: number; game: string; versionId: string; name: string; files: PackFile[]; dependencies: Record<string, string> }
type PackVersion = { id: string; project_id: string; name: string; game_versions: string[]; loaders: string[]; files: Array<{ url: string; filename: string; primary: boolean; hashes: FileHashes }> }
const dependencyKeys: Partial<Record<ModLoader, string>> = { forge: 'forge', neoforge: 'neoforge', fabric: 'fabric-loader', quilt: 'quilt-loader' }
const idPattern = /^[a-zA-Z0-9]{8,16}$/

export function safePath(root: string, value: string): string {
  const clean = value.replace(/\\/g, '/')
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.includes('\0')) throw new Error('Mod paketinde geçersiz dosya yolu var.')
  const parts = clean.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Mod paketinde güvensiz dosya yolu var.')
  const target = resolve(root, ...parts)
  if (!target.toLowerCase().startsWith(`${resolve(root).toLowerCase()}${sep}`)) throw new Error('Mod paketi profil klasörünün dışına yazmaya çalışıyor.')
  return target
}

export function streamEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error('Mod paketi dosyası okunamadı.')) : resolveStream(stream)))
}

export function walkArchive(path: string, visit: (entry: Entry, zip: ZipFile) => Promise<void>): Promise<void> {
  return new Promise((resolveWalk, rejectWalk) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) { rejectWalk(openError ?? new Error('Mod paketi arşivi açılamadı.')); return }
      let count = 0
      let totalSize = 0
      let settled = false
      const fail = (error: unknown) => { if (settled) return; settled = true; zip.close(); rejectWalk(error) }
      zip.on('error', fail)
      zip.on('entry', (entry: Entry) => {
        count += 1
        totalSize += entry.uncompressedSize
        if (count > 10000 || entry.uncompressedSize > 256 * 1024 * 1024 || totalSize > 2 * 1024 * 1024 * 1024) { fail(new Error('Mod paketi arşivi izin verilen boyutu aşıyor.')); return }
        const unixMode = entry.externalFileAttributes >>> 16
        if ((unixMode & 0o170000) === 0o120000) { fail(new Error('Mod paketinde sembolik bağlantı bulunuyor.')); return }
        void visit(entry, zip).then(() => { if (!settled) zip.readEntry() }, fail)
      })
      zip.on('end', () => { if (settled) return; settled = true; zip.close(); resolveWalk() })
      zip.readEntry()
    })
  })
}

async function readIndex(path: string): Promise<PackIndex> {
  let bytes: Buffer | null = null
  await walkArchive(path, async (entry, zip) => {
    if (entry.fileName !== 'modrinth.index.json') return
    if (entry.uncompressedSize > 2 * 1024 * 1024) throw new Error('Mod paketi bilgisi çok büyük.')
    const stream = await streamEntry(zip, entry)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of stream) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new Error('Mod paketi bilgisi çok büyük.'); chunks.push(Buffer.from(chunk)) }
    bytes = Buffer.concat(chunks)
  })
  if (!bytes) throw new Error('Mod paketinde modrinth.index.json bulunamadı.')
  const index = JSON.parse((bytes as Buffer).toString('utf8')) as PackIndex
  if (index.formatVersion !== 1 || index.game !== 'minecraft' || typeof index.name !== 'string' || !Array.isArray(index.files) || index.files.length > 2000 || !index.dependencies || typeof index.dependencies.minecraft !== 'string') throw new Error('Desteklenmeyen Modrinth mod paketi.')
  return index
}

export async function extractOverrides(archive: string, stage: string, layer: string): Promise<string[]> {
  const paths: string[] = []
  await walkArchive(archive, async (entry, zip) => {
    if (!entry.fileName.startsWith(layer) || entry.fileName.endsWith('/')) return
    const relative = entry.fileName.slice(layer.length)
    const target = safePath(stage, relative)
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.extracting`
    await pipeline(await streamEntry(zip, entry), createWriteStream(temporary))
    if (statSync(temporary).size !== entry.uncompressedSize) throw new Error('Mod paketi arşivindeki dosya eksik.')
    copyFileSync(temporary, target)
    rmSync(temporary, { force: true })
    paths.push(relative)
  })
  return paths
}

export class ModpackService {
  private installing = false
  get isInstalling(): boolean { return this.installing }
  constructor(private readonly store: LauncherStore, private readonly game: GameService, private readonly onActivity?: (activity: LauncherActivity) => void) {}

  async importArchive(archive: string): Promise<{ state: LauncherState; profileId: string }> {
    const index = await readIndex(archive)
    const loader = (Object.entries(dependencyKeys).find(([, key]) => key && index.dependencies[key])?.[0]) as ModLoader | undefined
    if (!loader) throw new Error('Bu Modrinth paketinin desteklenen bir mod yükleyicisi yok.')
    return this.install(randomUUID().replaceAll('-', '').slice(0, 16), index.dependencies.minecraft, loader, archive)
  }

  async install(versionId: string, gameVersion: string, loader: ModLoader, localArchive?: string): Promise<{ state: LauncherState; profileId: string }> {
    if (!this.store.get().selectedAccountId) throw new Error('Önce bir hesap seçin.')
    if (this.installing) throw new Error('Başka bir mod paketi kuruluyor.')
    if (!idPattern.test(versionId) || !/^[a-zA-Z0-9._-]{1,90}$/.test(gameVersion)) throw new Error('Geçersiz mod paketi sürümü.')
    if (!dependencyKeys[loader]) throw new Error('Bu yükleyici Modrinth mod paketlerinde desteklenmiyor.')
    this.installing = true
    let stage: string | undefined
    try {
      this.onActivity?.({ kind: 'installing', label: 'Mod paketi hazırlanıyor', progress: 2 })
      let version: PackVersion
      let archive = localArchive ?? join(this.store.dataPath, 'cache', 'modrinth-packs', `${versionId}.mrpack`)
      const cacheRoot = join(this.store.dataPath, 'cache', 'modrinth-files')
      if (!localArchive) {
      const response = await fetch(`https://api.modrinth.com/v2/version/${versionId}`, { headers: { 'User-Agent': 'Despical/GreenLauncher/0.12.2' }, signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`Mod paketi sürümü alınamadı (${response.status}).`)
      version = await response.json() as PackVersion
      if (!version.game_versions.includes(gameVersion) || !version.loaders.includes(loader)) throw new Error('Mod paketi seçilen sürüm ve yükleyiciyle uyumlu değil.')
      const packFile = version.files.find(item => item.primary && item.filename.toLowerCase().endsWith('.mrpack')) ?? version.files.find(item => item.filename.toLowerCase().endsWith('.mrpack'))
      if (!packFile) throw new Error('Mod paketinin .mrpack dosyası bulunamadı.')
      await downloadVerified([packFile.url], packFile.hashes, archive, cacheRoot, 512 * 1024 * 1024)
      } else version = { id: versionId, project_id: 'local', name: '', game_versions: [gameVersion], loaders: [loader], files: [] }
      const index = await readIndex(archive)
      if (index.dependencies.minecraft !== gameVersion) throw new Error(`Bu paket Minecraft ${index.dependencies.minecraft} gerektiriyor.`)
      const knownDependencies = new Set(['minecraft', 'forge', 'neoforge', 'fabric-loader', 'quilt-loader'])
      if (Object.keys(index.dependencies).some(key => !knownDependencies.has(key))) throw new Error('Mod paketi henüz desteklenmeyen bir ek yükleyici gerektiriyor.')
      const packLoaders = Object.keys(index.dependencies).filter(key => key !== 'minecraft')
      if (packLoaders.length !== 1 || packLoaders[0] !== dependencyKeys[loader]) throw new Error('Mod paketi seçilen yükleyiciyle uyumlu değil.')
      const loaderVersion = index.dependencies[dependencyKeys[loader]!]
      if (!loaderVersion || !/^[a-zA-Z0-9._-]{1,90}$/.test(loaderVersion)) throw new Error('Mod paketinin yükleyici sürümü geçersiz veya eksik.')
      stage = join(this.store.dataPath, 'cache', 'modrinth-pack-stage', versionId)
      const paths = new Set<string>()
      let completed = 0
      for (const file of index.files) {
        if (file.env?.client === 'unsupported' || file.env?.client === 'optional') continue
        if (!Array.isArray(file.downloads) || !file.downloads.length || !file.hashes?.sha512 || !file.hashes?.sha1) throw new Error('Mod paketinde eksik dosya bilgisi var.')
        const target = safePath(stage, file.path)
        this.onActivity?.({ kind: 'installing', label: 'Mod paketi dosyaları indiriliyor', detail: `${completed + 1}/${index.files.length}`, progress: 8 + Math.round(completed / Math.max(index.files.length, 1) * 64) })
        await downloadVerified(file.downloads, file.hashes, target, cacheRoot)
        paths.add(file.path)
        completed++
      }
      for (const layer of ['overrides/', 'client-overrides/'] as const) {
        for (const path of await extractOverrides(archive, stage, layer)) paths.add(path)
      }
      const state = this.store.get()
      const template: LauncherProfile = { id: '', name: index.name, versionId: gameVersion, javaPath: '', memoryMb: state.settings.memoryMb, minMemoryMb: Math.min(1024, state.settings.memoryMb), width: state.settings.width, height: state.settings.height, gameDirectory: '', createdAt: new Date().toISOString() }
      this.onActivity?.({ kind: 'installing', label: 'Mod paketi yükleyicisi hazırlanıyor', detail: `${loader} ${loaderVersion}`, progress: 75 })
      const reusable = state.profiles.find(item => item.versionId === gameVersion && item.modLoader === loader && item.modLoaderVersion?.endsWith(loaderVersion))
      const installedLoader = reusable?.modLoaderVersion && await this.game.hasModLoaderInstallation(reusable.modLoaderVersion) ? reusable.modLoaderVersion : await this.game.installModLoader(gameVersion, loader, template, loaderVersion)
      let project: { title: string; project_type: string } = { title: index.name, project_type: 'modpack' }
      if (!localArchive) {
      const projectResponse = await fetch(`https://api.modrinth.com/v2/project/${version.project_id}`, { headers: { 'User-Agent': 'Despical/GreenLauncher/0.12.2' }, signal: AbortSignal.timeout(15000) })
      if (!projectResponse.ok) throw new Error('Mod paketi bilgileri alınamadı.')
      project = await projectResponse.json() as { title: string; project_type: string }
      }
      if (project.project_type !== 'modpack') throw new Error('Seçilen proje mod paketi değil.')
      const baseName = (project.title || index.name).trim().slice(0, 42) || 'Mod paketi'
      let name = baseName
      let counter = 2
      while (state.profiles.some(item => item.name === name)) name = `${baseName.slice(0, 43 - String(counter).length)} (${counter++})`
      const saved = this.store.saveProfile({ ...template, name })
      const profileId = saved.selectedProfileId!
      try {
      this.store.setModLoader(profileId, gameVersion, loader, installedLoader)
      const profileRoot = this.store.profilePath(profileId)
      this.onActivity?.({ kind: 'installing', label: 'Mod paketi profile yerleştiriliyor', detail: name, progress: 92 })
      for (const relative of paths) {
        const destination = safePath(profileRoot, relative)
        mkdirSync(dirname(destination), { recursive: true })
        copyFileSync(safePath(stage, relative), destination)
      }
      writeFileSync(join(profileRoot, 'green-launcher-pack.json'), JSON.stringify({ projectId: version.project_id, versionId, name: project.title, minecraft: gameVersion, loader, loaderVersion, files: [...paths], integrity: index.files.filter(file => !['unsupported', 'optional'].includes(file.env?.client ?? '')).map(file => ({ path: file.path, hashes: file.hashes, downloads: file.downloads })) }, null, 2), 'utf8')
      this.store.setModpack(profileId, { projectId: version.project_id, versionId, title: project.title, fileCount: paths.size, provider: 'modrinth', sourceUrl: `https://modrinth.com/modpack/${encodeURIComponent(version.project_id)}` })
      this.onActivity?.({ kind: 'idle', label: 'Hazır' })
      return { state: this.store.get(), profileId }
      } catch (error) {
        this.store.deleteProfile(profileId)
        if (state.selectedProfileId) this.store.selectProfile(state.selectedProfileId)
        throw error
      }
    } catch (error) {
      this.onActivity?.({ kind: 'error', label: 'Mod paketi kurulamadı', detail: message(error) })
      throw error
    } finally { this.installing = false; if (stage) rmSync(stage, { recursive: true, force: true }) }
  }
}
