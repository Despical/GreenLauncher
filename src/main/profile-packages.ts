import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmdirSync } from 'node:fs'
import { copyFile, lstat, readdir, rm } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { ZipFile } from 'yazl'
import type { LauncherActivity, LauncherProfile, LauncherState, ModLoader } from '../shared/types'
import { LauncherStore, normalizeProfileCover } from './store'
import { normalizeProfileIcon } from '../shared/profile-icons'
import { GameService } from './game'
import { safePath, streamEntry, walkArchive } from './modpack'

interface PackageManifest {
  format: 'green-launcher-profile'; formatVersion: 1
  profile: Pick<LauncherProfile, 'name' | 'versionId' | 'memoryMb' | 'minMemoryMb' | 'width' | 'height' | 'fullscreen' | 'serverAddress' | 'cover' | 'icon'>
  loader?: { type: ModLoader; version: string }
  modpack?: LauncherProfile['modpack']
  files: Array<{ path: string; bytes: number; sha256: string }>
}
const omitted = new Set(['logs', 'crash-reports', 'cache', '.cache', '.fabric', 'natives', 'libraries', 'assets', 'versions', 'webcache', 'launcher_accounts.json', 'launcher_profiles.json', 'usercache.json', 'usernamecache.json', 'launcher_log.txt'])
const packageExtensions = new Set(['.glprofile', '.mrpack', '.zip'])
const metadataFiles = ['green-launcher-mods.json', 'green-launcher-pack.json']
const maxFiles = 9900, maxFileBytes = 256 * 1024 ** 2, maxTotalBytes = 2 * 1024 ** 3

export async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export class ProfilePackages {
  constructor(private store: LauncherStore, private game: GameService, private emit: (activity: LauncherActivity) => void) {}

  private profile(id: string): LauncherProfile {
    const profile = this.store.get().profiles.find(item => item.id === id)
    if (!profile) throw new Error('Profil bulunamadı.')
    if (this.game.getRunningInstances().some(item => item.profileId === id)) throw new Error('Bu işlem için önce profilin açık oyununu kapatın.')
    return profile
  }
  private stage(): string {
    const root = join(this.store.dataPath, 'cache', 'profile-packages')
    mkdirSync(root, { recursive: true })
    return mkdtempSync(join(root, 'stage-'))
  }
  private name(value: string): string {
    const base = value.trim().slice(0, 42) || 'İçe aktarılan profil'
    let name = base, suffix = 2
    while (this.store.get().profiles.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${base} (${suffix++})`.slice(0, 48)
    return name
  }
  private async files(profile: LauncherProfile): Promise<Array<{ path: string; source: string; bytes: number }>> {
    const root = this.store.gamePath(profile), files: Array<{ path: string; source: string; bytes: number }> = []
    for (const protectedRoot of [this.store.dataPath, join(this.store.dataPath, 'profiles')]) {
      const child = relative(root, protectedRoot)
      if (!child || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))) throw new Error('Oyun klasörü launcher verilerini içeriyor. Profil ayarlarında ayrı bir oyun klasörü seçin.')
    }
    let total = 0
    const walk = async (directory: string) => {
      if (!existsSync(directory)) return
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const source = join(directory, entry.name), path = relative(root, source).replace(/\\/g, '/')
        if ((!path.includes('/') && omitted.has(entry.name.toLowerCase())) || /(?:\.green-part(?:\.json)?|\.lock|\.tmp|\.extracting)$/i.test(entry.name) || packageExtensions.has(extname(entry.name).toLowerCase())) continue
        safePath(root, path)
        const info = await lstat(source)
        if (info.isSymbolicLink()) throw new Error(`Profil dosyasında bağlantı bulundu: ${path}`)
        if (info.isDirectory()) { await walk(source); continue }
        if (!info.isFile()) continue
        total += info.size
        if (files.length >= maxFiles || info.size > maxFileBytes || total > maxTotalBytes) throw new Error('Profil paketi en fazla 2 GB, tek dosya en fazla 256 MB olabilir.')
        files.push({ path, source, bytes: info.size })
      }
    }
    await walk(root)
    // Custom game directories keep launcher bookkeeping in the owned profile directory.
    for (const path of metadataFiles) {
      const source = join(this.store.profilePath(profile.id), path)
      if (existsSync(source) && !files.some(item => item.path === path)) {
        const info = await lstat(source)
        if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 ** 2) throw new Error('Profil kurulum bilgisi geçersiz.')
        files.push({ path, source, bytes: info.size })
      }
    }
    return files
  }

  private loader(profile: LauncherProfile): PackageManifest['loader'] {
    if (!profile.modLoader || !profile.modLoaderVersion) return undefined
    const id = profile.modLoaderVersion
    let version = ''
    if (profile.modLoader === 'fabric' || profile.modLoader === 'quilt') version = id.split(`-${profile.modLoader}`).at(-1) ?? ''
    else if (profile.modLoader === 'liteloader') version = id.split('-LiteLoader-').at(-1) ?? ''
    else {
      try {
        const json = JSON.parse(readFileSync(join(this.store.minecraftPath, 'versions', id, `${id}.json`), 'utf8')) as { libraries?: Array<{ name: string }> }
        const prefix = profile.modLoader === 'forge' ? 'net.minecraftforge:forge:' : 'net.neoforged:neoforge:'
        version = json.libraries?.find(item => item.name.startsWith(prefix))?.name.split(':')[2] ?? ''
        if (profile.modLoader === 'forge') version = version.replace(`${profile.versionId}-`, '')
      } catch { /* Recover the pinned release from the generated installation id. */ }
      if (!version) version = id.replace(new RegExp(`^${profile.versionId.replaceAll('.', '\\.')}[-_]${profile.modLoader}[-_]`), '')
      if (version === id) version = ''
    }
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(version)) throw new Error('Yükleyici sürümü okunamadı. Önce profili onarın.')
    return { type: profile.modLoader, version }
  }

  async clone(id: string): Promise<{ state: LauncherState; profileId: string }> {
    const owner = this.store.get().selectedAccountId, profile = this.profile(id), stage = this.stage()
    try {
      const files = await this.files(profile)
      for (const [index, file] of files.entries()) {
        this.emit({ kind: 'installing', label: 'Profil klonlanıyor', detail: file.path, progress: Math.round(index / Math.max(1, files.length) * 100) })
        const target = safePath(stage, file.path); mkdirSync(dirname(target), { recursive: true }); await copyFile(file.source, target)
      }
      if (owner !== this.store.get().selectedAccountId) throw new Error('Hesap değişti. İşlemi yeniden başlatın.')
      return await this.commit({ ...profile, name: this.name(`${profile.name} kopyası`), gameDirectory: '' }, stage, profile.modLoaderVersion)
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  private async commit(input: Omit<LauncherProfile, 'id' | 'createdAt'>, stage: string, installedLoader?: string): Promise<{ state: LauncherState; profileId: string }> {
    const previous = this.store.get().selectedProfileId
    const saved = this.store.saveProfile({ ...input, id: undefined, gameDirectory: '' })
    const profileId = saved.selectedProfileId!, destination = this.store.profilePath(profileId)
    try {
      rmdirSync(destination) // The newly generated profile directory is empty.
      renameSync(stage, destination)
      if (input.modLoader && installedLoader) this.store.setModLoader(profileId, input.versionId, input.modLoader, installedLoader)
      if (input.modpack) this.store.setModpack(profileId, input.modpack)
      return { state: this.store.get(), profileId }
    } catch (error) {
      this.store.deleteProfile(profileId)
      if (previous) this.store.selectProfile(previous)
      await rm(destination, { recursive: true, force: true })
      throw error
    }
  }

  async export(id: string, destination: string): Promise<string> {
    const profile = this.profile(id), files = await this.files(profile), loader = this.loader(profile)
    const manifest: PackageManifest = { format: 'green-launcher-profile', formatVersion: 1, profile: { name: profile.name, versionId: profile.versionId, memoryMb: profile.memoryMb, minMemoryMb: profile.minMemoryMb, width: profile.width, height: profile.height, fullscreen: profile.fullscreen, serverAddress: profile.serverAddress, cover: profile.cover, icon: profile.icon }, loader, modpack: profile.modpack, files: [] }
    const archive = new ZipFile(), temporary = `${destination}.green-part`
    archive.on('error', error => archive.outputStream.emit('error', error))
    try {
      // Freeze a copy before hashing/archiving so the manifest describes exactly the exported bytes.
      const stage = this.stage()
      try {
        for (const [index, file] of files.entries()) {
          this.emit({ kind: 'installing', label: 'Profil dışa aktarılıyor', detail: file.path, progress: Math.round(index / Math.max(1, files.length) * 70) })
          const copy = safePath(stage, file.path); mkdirSync(dirname(copy), { recursive: true }); await copyFile(file.source, copy)
          manifest.files.push({ path: file.path, bytes: (await lstat(copy)).size, sha256: await fileHash(copy) })
        }
        const writing = pipeline(archive.outputStream, createWriteStream(temporary))
        for (const file of files) archive.addFile(safePath(stage, file.path), `files/${file.path}`)
        archive.addBuffer(Buffer.from(JSON.stringify(manifest)), 'green-profile.json')
        archive.end()
        await writing
        renameSync(temporary, destination)
      } finally { await rm(stage, { recursive: true, force: true }) }
      return destination
    } finally {
      try { await rm(temporary, { force: true }) }
      finally { this.emit({ kind: 'idle', label: 'Hazır' }) }
    }
  }

  async import(archive: string): Promise<{ state: LauncherState; profileId: string }> {
    if (!this.store.get().selectedAccountId) throw new Error('Önce bir hesap seçin.')
    if (!packageExtensions.has(extname(archive).toLowerCase())) throw new Error('Green Launcher (.glprofile) veya Modrinth (.mrpack) paketi seçin.')
    const owner = this.store.get().selectedAccountId
    let manifest: PackageManifest | undefined
    await walkArchive(archive, async (entry, zip) => {
      if (entry.fileName !== 'green-profile.json') return
      if (manifest || entry.uncompressedSize > 2 * 1024 ** 2) throw new Error('Profil paketinin bilgisi geçersiz.')
      const chunks: Buffer[] = []
      for await (const chunk of await streamEntry(zip, entry)) chunks.push(Buffer.from(chunk))
      manifest = JSON.parse(Buffer.concat(chunks).toString('utf8')) as PackageManifest
    })
    if (!manifest || manifest.format !== 'green-launcher-profile' || manifest.formatVersion !== 1 || !manifest.profile || typeof manifest.profile.name !== 'string' || !/^[a-zA-Z0-9._-]{1,90}$/.test(manifest.profile.versionId) || !Array.isArray(manifest.files) || manifest.files.length > maxFiles) throw new Error('Desteklenmeyen profil paketi. .glprofile veya .mrpack dosyası seçin.')
    const metadata = manifest, stage = this.stage()
    try {
      const wanted = new Map<string, PackageManifest['files'][number]>()
      for (const file of metadata.files) {
        if (!file || typeof file.path !== 'string') throw new Error('Profil paketinde geçersiz dosya var.')
        safePath(stage, file.path)
        const key = file.path.toLowerCase()
        if (wanted.has(key) || !/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > maxFileBytes) throw new Error('Profil paketinde geçersiz veya yinelenen dosya var.')
        if (metadataFiles.includes(file.path) && file.bytes > 2 * 1024 ** 2) throw new Error('Profil kurulum bilgisi çok büyük.')
        wanted.set(key, file)
      }
      let completed = 0
      await walkArchive(archive, async (entry, zip) => {
        if (entry.fileName === 'green-profile.json' || entry.fileName.endsWith('/')) return
        if (!entry.fileName.startsWith('files/')) throw new Error('Profil paketinde beklenmeyen dosya var.')
        const path = entry.fileName.slice(6), file = wanted.get(path.toLowerCase())
        if (!file || file.path !== path || entry.uncompressedSize !== file.bytes) throw new Error('Profil dosyaları paket bilgisiyle uyuşmuyor.')
        const target = safePath(stage, path)
        mkdirSync(dirname(target), { recursive: true })
        await pipeline(await streamEntry(zip, entry), createWriteStream(target, { flags: 'wx' }))
        if (await fileHash(target) !== file.sha256.toLowerCase()) throw new Error(`Paket dosyasının bütünlüğü doğrulanamadı: ${path}`)
        wanted.delete(path.toLowerCase())
        this.emit({ kind: 'installing', label: 'Profil içe aktarılıyor', detail: path, progress: Math.round(++completed / Math.max(1, metadata.files.length) * 65) })
      })
      if (wanted.size) throw new Error('Profil paketinde eksik dosyalar var.')
      if (metadata.profile.cover) metadata.profile.cover = normalizeProfileCover(metadata.profile.cover)
      if (metadata.profile.icon) metadata.profile.icon = normalizeProfileIcon(metadata.profile.icon)
      const input: Omit<LauncherProfile, 'id' | 'createdAt'> = { name: this.name(metadata.profile.name), versionId: metadata.profile.versionId, javaPath: '', gameDirectory: '', memoryMb: metadata.profile.memoryMb, minMemoryMb: metadata.profile.minMemoryMb, width: metadata.profile.width, height: metadata.profile.height, fullscreen: metadata.profile.fullscreen, serverAddress: metadata.profile.serverAddress, cover: metadata.profile.cover, icon: metadata.profile.icon }
      if (metadata.loader && (!['fabric', 'quilt', 'forge', 'neoforge', 'liteloader'].includes(metadata.loader.type) || !/^[a-zA-Z0-9._-]{1,90}$/.test(metadata.loader.version))) throw new Error('Paketin yükleyici bilgisi geçersiz.')
      let installedLoader: string | undefined
      if (metadata.loader) { input.modLoader = metadata.loader.type; installedLoader = await this.game.installModLoader(input.versionId, metadata.loader.type, { ...input, id: '', createdAt: new Date().toISOString() }, metadata.loader.version) }
      else await this.game.install(input.versionId)
      if (metadata.modpack && typeof metadata.modpack.projectId === 'string' && typeof metadata.modpack.versionId === 'string' && typeof metadata.modpack.title === 'string' && Number.isSafeInteger(metadata.modpack.fileCount)) input.modpack = metadata.modpack
      if (owner !== this.store.get().selectedAccountId) throw new Error('Hesap değişti. İşlemi yeniden başlatın.')
      return await this.commit(input, stage, installedLoader)
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  async repair(id: string): Promise<LauncherState> {
    const profile = this.profile(id), release = this.loader(profile)
    // Managed downloads verify official checksums before deciding to reuse a file.
    await this.game.install(profile.versionId)
    if (release) {
      const installed = await this.game.installModLoader(profile.versionId, release.type, profile, release.version)
      this.store.setModLoader(profile.id, profile.versionId, release.type, installed)
    }
    return this.store.get()
  }
}
