import { diskSpace } from './disk-space'
import { WorldService } from './worlds'
import { BrowserWindow, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { LibraryInfo, MinecraftFolder, Version, launch, type ResolvedVersion } from '@xmcl/core'
import { normalizeServerAddress, serverLaunchMode, serverLaunchOptions } from '../shared/server-launch'
import { customRuntime, customJavaVersion, customResolvedVersion } from './custom-runtime'
import { saveMinecraftServerPreference } from './server-preference'
import { offlineAccount } from './offline-account'
import type { ServerJoinPreference } from '../shared/types'
import {
  DEFAULT_RUNTIME_ALL_URL,
  createDefaultNodeInstallRuntime,
  createModernForgeInstallWorkflow,
  createJavaRuntimeInstallWorkflow,
  executeInstallWorkflow,
  executeInstallManifest,
  getPotentialJavaLocations,
  getVersionList,
  getForgeVersionList,
  getLoaderArtifactListFor,
  getQuiltLoaderVersionsByMinecraft,
  resolveAssetMetadataInstallFiles,
  resolveAssetObjectInstallFiles,
  resolveJava,
  resolveLibraryInstallFiles,
  resolveMinecraftJarInstallFile,
  resolveMinecraftVersionJsonInstallFile,
  resolveOptifineInstallManifest,
  resolveFabricInstallManifest,
  resolveQuiltInstallManifest,
  resolveForgeArtifactVersion,
  resolveForgeInstallerFile,
  resolveNeoForgedInstallerFile,
  ProgressTrackerMultiple,
  type InstallFile,
  type JavaRuntimeTarget,
  type MinecraftVersion
} from '@xmcl/installer'
import type { GameVersion, JavaRuntimeInfo, LauncherActivity, LauncherProfile, ModLoader, RunningInstance, LaunchResult } from '../shared/types'
import { AccountService } from './auth'
import { LauncherStore } from './store'
import { PlaytimeTracker } from './playtime'
import { getDownloadManager } from './download-manager'

const versionIdPattern = /^[a-zA-Z0-9._-]{1,90}$/
const automaticOptifineSuffix = '-OptiFine_auto'
const catalogFreshFor = 15 * 60_000

export class GameService {
  private versionCache: MinecraftVersion[] = []
  private optifineCatalog = new Set<string>()
  private refreshInFlight: Promise<void> | null = null
  private readonly manifestPath: string
  private readonly optifineCachePath: string
  private manifestUpdatedAt = 0
  private optifineUpdatedAt = 0
  private catalogAttemptAt = 0
  private readonly folder: MinecraftFolder
  private busy = false
  private sessions = new Map<string, RunningInstance>()
  private readonly playtime: PlaytimeTracker
  private get running(): boolean { return this.sessions.size > 0 }

  constructor(
    private readonly store: LauncherStore,
    private readonly accounts: AccountService,
    private readonly window: () => BrowserWindow | null,
    private readonly emit: (activity: LauncherActivity) => void,
    private readonly emitInstances: (instances: RunningInstance[]) => void = () => {},
    onPlaytimeChanged: () => void = () => {}
  ) {
    this.playtime = new PlaytimeTracker(session => {
      try { store.recordPlaySession(session); onPlaytimeChanged() }
      catch (error) { console.warn('Could not save local playtime:', message(error)) }
    })
    this.manifestPath = join(store.dataPath, 'versions-cache.json')
    this.optifineCachePath = join(store.dataPath, 'optifine-cache.json')
    this.folder = new MinecraftFolder(store.minecraftPath)
    if (existsSync(this.manifestPath)) {
      try {
        const cached = JSON.parse(readFileSync(this.manifestPath, 'utf8')) as unknown
        if (Array.isArray(cached)) {
          this.versionCache = cached.filter(version => version && typeof version.id === 'string' && versionIdPattern.test(version.id) && typeof version.url === 'string' && typeof version.releaseTime === 'string') as MinecraftVersion[]
          this.manifestUpdatedAt = Math.min(Date.now(), statSync(this.manifestPath).mtimeMs)
        }
      } catch { /* A damaged cache will be replaced on refresh. */ }
    }
    try {
      const cached = JSON.parse(readFileSync(this.optifineCachePath, 'utf8')) as { versions?: unknown; updatedAt?: unknown }
      if (Array.isArray(cached.versions) && typeof cached.updatedAt === 'number' && Number.isFinite(cached.updatedAt)) {
        this.optifineCatalog = new Set(cached.versions.filter((id): id is string => typeof id === 'string' && versionIdPattern.test(id)))
        this.optifineUpdatedAt = Math.min(Date.now(), cached.updatedAt)
      }
    } catch { /* OptiFine availability is optional and refreshes independently. */ }
  }

  private status(activity: LauncherActivity): void { getDownloadManager()?.activity(activity); this.emit(activity) }

  getLaunchState(): { busy: boolean; preparing: boolean; session: RunningInstance | null } {
    return { busy: this.busy || this.running, preparing: this.busy, session: this.getRunningInstances()[0] ?? null }
  }

  getRunningInstances(): RunningInstance[] { return structuredClone([...this.sessions.values()]) }
  flushPlaytime(): void { this.playtime.dispose() }

  private localVersions(): {
    vanilla: Map<string, { folder: MinecraftFolder; source: 'launcher'; releaseTime: string; type: GameVersion['type']; custom?: boolean }>
    optifine: Map<string, Array<{ id: string; source: 'launcher'; folder: MinecraftFolder }>>
  } {
    const vanilla = new Map<string, { folder: MinecraftFolder; source: 'launcher'; releaseTime: string; type: GameVersion['type']; custom?: boolean }>()
    const optifine = new Map<string, Array<{ id: string; source: 'launcher'; folder: MinecraftFolder }>>()
    for (const [source, folder] of [['launcher', this.folder]] as const) {
      if (!existsSync(folder.versions)) continue
      for (const entry of readdirSync(folder.versions, { withFileTypes: true })) {
        if (!entry.isDirectory() || !versionIdPattern.test(entry.name)) continue
        const jsonPath = folder.getVersionJson(entry.name)
        if (!existsSync(jsonPath)) continue
        try {
          const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as { inheritsFrom?: string; releaseTime?: string; time?: string; type?: string; greenLauncherCustom?: boolean }
          if (/optifine/i.test(entry.name) && !parsed.greenLauncherCustom) {
            const base = parsed.inheritsFrom ?? entry.name.split(/-OptiFine_/i)[0]
            if (!versionIdPattern.test(base)) continue
            const variants = optifine.get(base) ?? []
            if (!variants.some(item => item.id === entry.name)) variants.push({ id: entry.name, source, folder })
            optifine.set(base, variants)
          } else if ((existsSync(folder.getVersionJar(entry.name)) || (parsed.inheritsFrom && existsSync(folder.getVersionJson(parsed.inheritsFrom)))) && !vanilla.has(entry.name)) {
            const type = ['release', 'snapshot', 'old_beta', 'old_alpha'].includes(parsed.type ?? '') ? parsed.type as GameVersion['type'] : 'release'
            vanilla.set(entry.name, { folder, source, releaseTime: parsed.releaseTime ?? parsed.time ?? new Date(0).toISOString(), type, custom: parsed.greenLauncherCustom === true })
          }
        } catch { /* Ignore a damaged local version descriptor. */ }
      }
    }
    return { vanilla, optifine }
  }

  private installedVersion(id: string): { folder: MinecraftFolder; source: 'launcher' } | undefined {
    if (!versionIdPattern.test(id)) return undefined
    const local = this.localVersions()
    const vanilla = local.vanilla.get(id)
    if (vanilla) return vanilla
    for (const variants of local.optifine.values()) {
      const found = variants.find(item => item.id === id)
      if (found) return found
    }
    return undefined
  }

  isInstalled(id: string): boolean { return !!this.installedVersion(id) }

  private isCustom(id: string): boolean {
    try { return JSON.parse(readFileSync(this.folder.getVersionJson(id), 'utf8')).greenLauncherCustom === true } catch { return false }
  }

  profileVersion(id: string): Pick<LauncherProfile, 'versionId' | 'modLoader' | 'modLoaderVersion'> {
    if (!versionIdPattern.test(id)) throw new Error('Geçersiz sürüm kimliği.')
    if (!existsSync(this.folder.getVersionJson(id)) || /optifine/i.test(id)) return { versionId: id }
    const parsed = JSON.parse(readFileSync(this.folder.getVersionJson(id), 'utf8')) as { inheritsFrom?: string; libraries?: { name: string }[]; greenLauncherCustom?: boolean }
    if (parsed.greenLauncherCustom) return { versionId: id }
    const signature = `${id} ${parsed.libraries?.map(lib => lib.name).join(' ')}`.toLowerCase()
    const loader = signature.includes('neoforge') ? 'neoforge' : signature.includes('forge') ? 'forge' : signature.includes('fabric') ? 'fabric' : signature.includes('quilt') ? 'quilt' : signature.includes('liteloader') ? 'liteloader' : undefined
    return loader && parsed.inheritsFrom && versionIdPattern.test(parsed.inheritsFrom) ? { versionId: parsed.inheritsFrom, modLoader: loader, modLoaderVersion: id } : { versionId: id }
  }

  async hasModLoaderInstallation(id: string): Promise<boolean> {
    if (!versionIdPattern.test(id) || !existsSync(this.folder.getVersionJson(id))) return false
    try { await Version.parse(this.folder, id); return true } catch { return false }
  }

  versionLocation(id: string): string {
    const installed = this.installedVersion(id)
    if (!installed) throw new Error('Bu sürüm henüz yüklü değil.')
    return installed.folder.getVersionRoot(id)
  }

  async versions(refresh: boolean | 'if-stale' = false): Promise<GameVersion[]> {
    const stale = !this.versionCache.length || Date.now() - this.manifestUpdatedAt >= catalogFreshFor || Date.now() - this.optifineUpdatedAt >= catalogFreshFor
    if (refresh === true || (refresh === 'if-stale' && (this.refreshInFlight || (stale && Date.now() - this.catalogAttemptAt >= 60_000)))) {
      if (!this.refreshInFlight) this.refreshInFlight = this.refreshCatalogs(refresh === true).finally(() => { this.refreshInFlight = null })
      await this.refreshInFlight
    }
    const local = this.localVersions()
    const official = this.versionCache.map(version => ({
      id: version.id,
      type: version.type as GameVersion['type'],
      releaseTime: version.releaseTime,
      url: version.url,
      installed: local.vanilla.has(version.id),
      custom: local.vanilla.get(version.id)?.custom === true,
      installedFrom: local.vanilla.get(version.id)?.source,
      optifineAvailable: this.optifineCatalog.has(version.id),
      optifineVersions: (local.optifine.get(version.id) ?? []).map(({ id, source }) => ({ id, source }))
    }))
    const known = new Set(official.map(item => item.id))
    const extraIds = new Set([...local.vanilla.keys(), ...local.optifine.keys()])
    const extras: GameVersion[] = [...extraIds].filter(id => !known.has(id)).map(id => ({
      id, custom: local.vanilla.get(id)?.custom === true, type: local.vanilla.get(id)?.type ?? 'release', releaseTime: local.vanilla.get(id)?.releaseTime ?? new Date(0).toISOString(), url: '', installed: local.vanilla.has(id), installedFrom: local.vanilla.get(id)?.source, optifineAvailable: this.optifineCatalog.has(id),
      optifineVersions: (local.optifine.get(id) ?? []).map(({ id: optifineId, source }) => ({ id: optifineId, source }))
    })).sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime))
    return [...official, ...extras]
  }

  private async refreshCatalogs(force = true): Promise<void> {
    this.catalogAttemptAt = Date.now()
    const results = await Promise.allSettled([
        (async () => {
          if (!force && this.versionCache.length && Date.now() - this.manifestUpdatedAt < catalogFreshFor) return
          const manifest = await getVersionList({ signal: AbortSignal.timeout(8000) })
          this.versionCache = manifest.versions
          this.manifestUpdatedAt = Date.now()
          try { writeFileSync(this.manifestPath, JSON.stringify(manifest.versions), 'utf8') } catch { /* A cache write must not discard a successful refresh. */ }
        })(),
        (async () => {
          if (!force && Date.now() - this.optifineUpdatedAt < catalogFreshFor) return
          const response = await fetch('https://optifine.net/downloads?lang=en', { signal: AbortSignal.timeout(8000) })
          if (!response.ok) throw new Error('OptiFine listesi alınamadı.')
          const html = await response.text()
          const available = new Set<string>()
          for (const heading of html.matchAll(/<h2>\s*Minecraft ([a-zA-Z0-9._-]+)\s*<\/h2>/gi)) {
            const section = html.slice(heading.index + heading[0].length).split(/<h2>/i)[0]
            if (/class=['"]colMirror['"][^>]*>\s*<a[^>]+href=['"][^'"]*adloadx\?f=/i.test(section)) available.add(heading[1])
          }
          this.optifineCatalog = available
          this.optifineUpdatedAt = Date.now()
          try { writeFileSync(this.optifineCachePath, JSON.stringify({ versions: [...available], updatedAt: this.optifineUpdatedAt }), 'utf8') } catch { /* Keep the current in-memory catalog usable. */ }
        })()
    ])
    if (results[0].status === 'rejected' && !this.versionCache.length && this.localVersions().vanilla.size === 0) throw results[0].reason
  }

  private async metadata(id: string): Promise<MinecraftVersion> {
    if (!versionIdPattern.test(id)) throw new Error('Geçersiz sürüm kimliği.')
    let version = this.versionCache.find(item => item.id === id)
    if (!version) { await this.versions(true); version = this.versionCache.find(item => item.id === id) }
    if (!version) throw new Error('Sürüm resmi Minecraft listesinde bulunamadı.')
    return version
  }

  private async installVersion(id: string, forLaunch = false): Promise<ResolvedVersion> {
    const meta = await this.metadata(id)
    const downloadStage = async (files: InstallFile[], detail: string, start: number, end: number) => {
      const managed = getDownloadManager()
      if (managed) {
        this.status({ kind: 'installing', label: `${id} indiriliyor`, detail, progress: start })
        await managed.runtime().download(files)
        this.status({ kind: 'installing', label: `${id} indiriliyor`, detail, progress: end })
        return
      }
      const tracker = new ProgressTrackerMultiple()
      const runtime = getDownloadManager()?.runtime() ?? createDefaultNodeInstallRuntime({ maxConcurrency: 12, tracker })
      let lastBytes = 0
      let lastAt = Date.now()
      const update = () => {
        const now = Date.now()
        const bytes = tracker.progress
        const total = tracker.total
        const speed = (bytes - lastBytes) * 1000 / Math.max(1, now - lastAt)
        lastBytes = bytes
        lastAt = now
        this.status({ kind: 'installing', label: `${id} indiriliyor`, detail, progress: total > 0 ? Math.round(start + (end - start) * bytes / total) : start, downloadedBytes: bytes, totalBytes: total, bytesPerSecond: Math.max(0, speed) })
      }
      update()
      const timer = setInterval(update, 400)
      try { await runtime.download(files); update() } finally { clearInterval(timer) }
    }
    this.status({ kind: 'installing', label: `${id} hazırlanıyor`, detail: 'Sürüm dosyaları alınıyor', progress: 8 })
    mkdirSync(this.folder.getVersionRoot(id), { recursive: true })
    await downloadStage([resolveMinecraftVersionJsonInstallFile(meta, this.folder)], 'Sürüm bilgileri', 8, 22)
    const version = await Version.parse(this.folder, id)
    const jar = resolveMinecraftJarInstallFile(version)
    if (!jar) throw new Error('Bu sürüm için oyun dosyası bulunamadı.')
    const libraries = resolveLibraryInstallFiles(version.libraries, this.folder)
    await downloadStage([jar, ...libraries], 'Oyun ve kütüphaneler', 25, 58)
    await downloadStage(resolveAssetMetadataInstallFiles(version, this.folder), 'Varlık dizini', 58, 72)
    const assets = await resolveAssetObjectInstallFiles(version, this.folder)
    await downloadStage(assets, 'Sesler ve dokular', 72, forLaunch ? 82 : 100)
    this.status({ kind: 'installing', label: `${id} hazır`, detail: 'İndirme tamamlandı', progress: forLaunch ? 82 : 100 })
    return version
  }

  async install(id: string): Promise<void> {
    if (this.busy) throw new Error('Başka bir işlem devam ediyor.')
    this.busy = true
    try { await this.installVersion(id); this.status({ kind: 'idle', label: 'Hazır' }) }
    catch (error) { this.status({ kind: 'error', label: 'Yükleme başarısız', detail: message(error) }); throw error }
    finally { this.busy = false }
  }

  async installModLoader(gameVersion: string, loader: ModLoader, profile: LauncherProfile, requestedVersion?: string): Promise<string> {
    if (this.busy) throw new Error('Başka bir oyun veya indirme işlemi devam ediyor.')
    if (!versionIdPattern.test(gameVersion)) throw new Error('Geçersiz Minecraft sürümü.')
    if (requestedVersion && !versionIdPattern.test(requestedVersion)) throw new Error('Geçersiz yükleyici sürümü.')
    this.busy = true
    try {
      this.status({ kind: 'installing', label: `${loader} hazırlanıyor`, detail: `Minecraft ${gameVersion}`, progress: 5 })
      const localBase = this.installedVersion(gameVersion)
      const base = localBase?.source === 'launcher'
        ? await Version.parse(this.folder, gameVersion)
        : await this.installVersion(gameVersion, true)
      let installedId: string
      const runtime = (getDownloadManager()?.runtime() ?? createDefaultNodeInstallRuntime({ maxConcurrency: 8 }))
      if (loader === 'liteloader') {
        const response = await fetch('https://dl.liteloader.com/versions/versions.json', { signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('LiteLoader sürüm listesi alınamadı.')
        const metadata = await response.json() as { versions?: Record<string, { artefacts?: Record<string, { latest?: { version: string; file: string; md5: string; timestamp: string; tweakClass: string; libraries: Array<{ name: string; url?: string }> } }> }> }
        const release = metadata.versions?.[gameVersion]?.artefacts?.['com.mumfrey:liteloader']?.latest
        if (!release) throw new Error(`LiteLoader, Minecraft ${gameVersion} için doğrulanmış kararlı kurulum sunmuyor.`)
        if (requestedVersion && release.version !== requestedVersion) throw new Error(`LiteLoader ${requestedVersion} bulunamadı.`)
        if (!/^[a-zA-Z0-9._-]+$/.test(release.version) || !/^liteloader-[a-zA-Z0-9._-]+\.jar$/.test(release.file) || !/^[0-9a-f]{32}$/i.test(release.md5)) throw new Error('LiteLoader sürüm bilgisi geçersiz.')
        const baseJson = JSON.parse(readFileSync(this.folder.getVersionJson(gameVersion), 'utf8')) as { id: string; minecraftArguments?: string; arguments?: unknown }
        if (!baseJson.minecraftArguments || baseJson.arguments) throw new Error('LiteLoader yalnızca eski Minecraft sürümlerini destekler.')
        const coordinate = `com.mumfrey:liteloader:${release.version}`
        const libraryPath = `com/mumfrey/liteloader/${release.version}/liteloader-${release.version}.jar`
        const fileUrl = `https://dl.liteloader.com/repo/com/mumfrey/liteloader/${release.version}/${release.file}`
        const loaderId = `${gameVersion}-LiteLoader-${release.version}`
        const libraries = [
          { name: coordinate, downloads: { artifact: { path: libraryPath, url: fileUrl, sha1: '', size: -1 } } },
          ...release.libraries.map(library => ({ name: library.name, url: library.url?.replace(/^http:/, 'https:') ?? (library.name.startsWith('net.minecraft:') ? 'https://libraries.minecraft.net/' : library.name.startsWith('org.ow2.asm:') ? 'https://files.minecraftforge.net/maven/' : 'https://repo1.maven.org/maven2/') }))
        ]
        const jsonPath = this.folder.getVersionJson(loaderId)
        mkdirSync(this.folder.getVersionRoot(loaderId), { recursive: true })
        writeFileSync(jsonPath, JSON.stringify({ id: loaderId, time: new Date(Number(release.timestamp) * 1000).toISOString(), releaseTime: new Date(Number(release.timestamp) * 1000).toISOString(), type: 'release', libraries, mainClass: 'net.minecraft.launchwrapper.Launch', inheritsFrom: gameVersion, jar: gameVersion, minecraftArguments: `--tweakClass ${release.tweakClass} ${baseJson.minecraftArguments}` }, null, 2))
        this.status({ kind: 'installing', label: 'LiteLoader kuruluyor', detail: release.version, progress: 60 })
        await runtime.download([{ path: this.folder.getLibraryByPath(libraryPath), urls: [fileUrl], checksum: { algorithm: 'md5', value: release.md5 }, validator: 'zip' }])
        const installed = await Version.parse(this.folder, loaderId)
        await runtime.download(resolveLibraryInstallFiles(installed.libraries, this.folder))
        installedId = loaderId
      } else if (loader === 'fabric') {
        const artifacts = await getLoaderArtifactListFor(gameVersion)
        const chosen = requestedVersion ? artifacts.find(item => item.loader.version === requestedVersion) : artifacts.find(item => item.loader.stable) ?? artifacts[0]
        if (!chosen) throw new Error(`Fabric, Minecraft ${gameVersion} için bulunamadı.`)
        const { version, plan } = await resolveFabricInstallManifest({ minecraftVersion: gameVersion, version: chosen.loader.version, minecraft: this.folder })
        this.status({ kind: 'installing', label: 'Fabric kuruluyor', detail: chosen.loader.version, progress: 60 })
        await executeInstallManifest(plan, runtime)
        installedId = version
        this.preserveMavenChecksums(installedId)
        const installed = await Version.parse(this.folder, installedId)
        await runtime.download(resolveLibraryInstallFiles(installed.libraries, this.folder))
      } else if (loader === 'quilt') {
        const artifacts = await getQuiltLoaderVersionsByMinecraft({ minecraftVersion: gameVersion })
        const chosen = requestedVersion ? artifacts.find(item => item.loader.version === requestedVersion) : artifacts.find(item => item.loader.stable) ?? artifacts[0]
        if (!chosen) throw new Error(`Quilt, Minecraft ${gameVersion} için bulunamadı.`)
        const { version, plan } = await resolveQuiltInstallManifest({ minecraftVersion: gameVersion, version: chosen.loader.version, minecraft: this.folder })
        this.status({ kind: 'installing', label: 'Quilt kuruluyor', detail: chosen.loader.version, progress: 60 })
        await executeInstallManifest(plan, runtime)
        installedId = version
        this.preserveMavenChecksums(installedId)
        const installed = await Version.parse(this.folder, installedId)
        await runtime.download(resolveLibraryInstallFiles(installed.libraries, this.folder))
      } else {
        const java = await this.findJava(base, profile)
        let artifactVersion: string
        let installer: InstallFile
        if (loader === 'forge') {
          const list = await getForgeVersionList({ minecraft: gameVersion })
          const chosen = requestedVersion
            ? list.versions.find(item => item.installer?.path && resolveForgeArtifactVersion(gameVersion, item.version) === `${gameVersion}-${requestedVersion}`)
            : list.versions.find(item => item.type === 'recommended' && item.installer?.path) ?? list.versions.find(item => item.type === 'latest' && item.installer?.path) ?? list.versions.find(item => item.installer?.path)
          if (!chosen) throw new Error(`Forge, Minecraft ${gameVersion} için bulunamadı.`)
          artifactVersion = resolveForgeArtifactVersion(gameVersion, chosen.version)
          installer = resolveForgeInstallerFile(artifactVersion, chosen.installer, this.folder, {}).file
        } else {
          const response = await fetch(`https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml?refresh=${Date.now()}`, { signal: AbortSignal.timeout(15000) })
          if (!response.ok) throw new Error('NeoForge sürüm listesi alınamadı.')
          const xml = await response.text()
          const prefix = gameVersion.replace(/^1\./, '') + '.'
          const matches = [...xml.matchAll(/<version>([0-9][^<]+)<\/version>/g)].map(item => item[1]).filter(item => item.startsWith(prefix))
          artifactVersion = requestedVersion ? matches.find(item => item === requestedVersion) ?? '' : matches.at(-1) ?? ''
          if (!artifactVersion) throw new Error(`NeoForge, Minecraft ${gameVersion} için bulunamadı.`)
          installer = (await resolveNeoForgedInstallerFile('neoforge', artifactVersion, this.folder, {})).file
        }
        this.status({ kind: 'installing', label: `${loader} kuruluyor`, detail: artifactVersion, progress: 55 })
        const workflow = createModernForgeInstallWorkflow({
          id: `green-${loader}-${gameVersion}-${artifactVersion}`, minecraft: this.folder, minecraftVersion: gameVersion,
          installer, artifactVersion, java, installOptions: { inheritsFrom: gameVersion }
        })
        installedId = (await executeInstallWorkflow(workflow, runtime)).version
      }
      await Version.parse(this.folder, installedId)
      this.status({ kind: 'idle', label: 'Hazır' })
      return installedId
    } catch (error) {
      this.status({ kind: 'error', label: 'Mod yükleyicisi kurulamadı', detail: message(error) })
      throw error
    } finally { this.busy = false }
  }

  private preserveMavenChecksums(id: string): void {
    const path = this.folder.getVersionJson(id)
    const json = JSON.parse(readFileSync(path, 'utf8')) as { libraries?: Array<{ name: string; url?: string; sha1?: string; size?: number; downloads?: unknown }> }
    for (const library of json.libraries ?? []) {
      if (library.downloads || !library.url || !/^[0-9a-f]{40}$/i.test(library.sha1 ?? '')) continue
      const artifactPath = LibraryInfo.resolve(library.name).path
      library.downloads = { artifact: { path: artifactPath, url: `${library.url.replace(/\/$/, '')}/${artifactPath}`, sha1: library.sha1, size: library.size ?? -1 } }
    }
    writeFileSync(path, JSON.stringify(json, null, 2), 'utf8')
  }

  private async findJava(version: ResolvedVersion, profile?: LauncherProfile, strictRuntime = false): Promise<string> {
    const wanted = version.javaVersion?.majorVersion ?? 8
    const requested = profile?.javaPath || this.store.get().settings.javaPath
    if (requested) {
      const info = await resolveJava(requested)
      if (!info) throw new Error('Seçilen Java yolu çalışmıyor. Profil veya genel ayarlardan düzeltin.')
      if (info.majorVersion < wanted) throw new Error(`${version.id} için en az Java ${wanted} gerekiyor; seçilen Java ${info.majorVersion}.`)
      return info.path
    }
    const component = version.javaVersion?.component ?? (strictRuntime && wanted === 8 ? 'jre-legacy' : undefined)
    const bundled = join(this.store.dataPath, 'java', component ?? `java-${wanted}`, 'bin', 'javaw.exe')
    const paths = [bundled, ...(await this.javaRuntimes()).map(item => item.path)]
    let compatible: { path: string; majorVersion: number } | null = null
    for (const path of paths) {
      if (!existsSync(path)) continue
      const info = await resolveJava(path)
      if (info?.majorVersion === wanted) return info.path
      if (info && info.majorVersion > wanted && (!compatible || info.majorVersion < compatible.majorVersion)) compatible = info
    }
    if (compatible && !strictRuntime) return compatible.path
    if (!component) throw new Error(`Java ${wanted} bulunamadı. Ayarlar bölümünden Java yolunu seçin.`)
    this.status({ kind: 'installing', label: `Java ${wanted} kuruluyor`, detail: 'Resmi oyun çalışma ortamı indiriliyor', progress: 85 })
    const response = await fetch(DEFAULT_RUNTIME_ALL_URL)
    if (!response.ok) throw new Error('Java sürüm listesi alınamadı.')
    const all = await response.json() as Record<string, Record<string, JavaRuntimeTarget[]>>
    const runtime = all['windows-x64']?.[component]?.[0]
    if (!runtime) throw new Error(`Java ${wanted} otomatik kurulamadı. Ayarlardan Java yolunu seçin.`)
    const destination = join(this.store.dataPath, 'java', component)
    mkdirSync(destination, { recursive: true })
    const workflow = createJavaRuntimeInstallWorkflow({ target: runtime, destination })
    await executeInstallWorkflow(workflow, (getDownloadManager()?.runtime() ?? createDefaultNodeInstallRuntime({ maxConcurrency: 12 })))
    const installed = await resolveJava(bundled)
    if (!installed || installed.majorVersion !== wanted) throw new Error(`Java ${wanted} kurulumu doğrulanamadı.`)
    return installed.path
  }

  async javaRuntimes(): Promise<JavaRuntimeInfo[]> {
    const candidates = new Set<string>()
    const selected = this.store.get().settings.javaPath
    if (selected) candidates.add(selected)
    for (const profile of this.store.allProfiles()) if (profile.javaPath) candidates.add(profile.javaPath)
    for (const path of await getPotentialJavaLocations()) candidates.add(path)
    const javaRoot = join(this.store.dataPath, 'java')
    if (existsSync(javaRoot)) for (const entry of readdirSync(javaRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(javaRoot, entry.name, 'bin', 'javaw.exe')
      if (existsSync(path)) candidates.add(path)
    }
    const resolved = await Promise.all([...candidates].filter(path => !this.store.isStandardMinecraftPath(path)).map(async path => {
      try {
        const info = await resolveJava(path)
        return info ? { path: info.path, version: info.version, majorVersion: info.majorVersion, source: info.path.startsWith(javaRoot) ? 'Launcher tarafından kuruldu' : 'Bilgisayarda bulundu' } : null
      } catch { /* Ignore invalid Java locations. */ }
      return null
    }))
    const found = new Map<string, JavaRuntimeInfo>()
    for (const info of resolved) if (info) found.set(info.path.toLowerCase(), info)
    return [...found.values()].sort((a, b) => b.majorVersion - a.majorVersion)
  }

  async deleteJavaRuntime(path: string): Promise<void> {
    if (this.busy || this.running) throw new Error('Oyun veya indirme sürerken Java kaldırılamaz.')
    const javaRoot = join(this.store.dataPath, 'java')
    const root = dirname(dirname(path))
    const child = relative(javaRoot, root)
    if (!child || child.startsWith('..') || child.includes(sep) || path !== join(root, 'bin', 'javaw.exe')) throw new Error('Yalnızca launcher tarafından indirilen Java silinebilir.')
    if (!existsSync(path) || !existsSync(root)) throw new Error('Java kurulumu bulunamadı.')
    const selected = [this.store.get().settings.javaPath, ...this.store.allProfiles().map(item => item.javaPath)]
    if (selected.some(item => item.toLowerCase() === path.toLowerCase())) throw new Error('Bu Java bir profil veya genel ayarlarda seçili. Önce Java yolunu değiştirin.')
    await shell.trashItem(root)
  }

  private async officialOptifineInstaller(baseId: string): Promise<string> {
    if (!versionIdPattern.test(baseId)) throw new Error('Geçersiz sürüm kimliği.')
    const page = await fetch('https://optifine.net/downloads?lang=en', { signal: AbortSignal.timeout(20000) })
    if (!page.ok) throw new Error('OptiFine sürüm listesi alınamadı.')
    const html = await page.text()
    const heading = new RegExp(`<h2>\\s*Minecraft ${baseId.replaceAll('.', '\\.') }\\s*<\\/h2>`, 'i')
    const match = heading.exec(html)
    if (!match) throw new Error(`${baseId} için resmî OptiFine sürümü bulunamadı.`)
    const section = html.slice(match.index + match[0].length).split(/<h2>/i)[0]
    const file = /class=['"]colMirror['"][^>]*>\s*<a[^>]+href=['"][^'"]*adloadx\?f=([^'"&]+\.jar)/i.exec(section)?.[1]
    if (!file || !/^(preview_)?OptiFine_[a-zA-Z0-9._-]+\.jar$/.test(file) || !file.startsWith(`OptiFine_${baseId}_`) && !file.startsWith(`preview_OptiFine_${baseId}_`)) throw new Error(`${baseId} için resmî OptiFine indirmesi bulunamadı.`)
    const mirror = await fetch(`https://optifine.net/adloadx?f=${encodeURIComponent(file)}`, { signal: AbortSignal.timeout(20000) })
    if (!mirror.ok) throw new Error('OptiFine indirme bağlantısı alınamadı.')
    const link = /href=['"](downloadx\?f=([^'"&]+\.jar)&(?:amp;)?x=([a-fA-F0-9]+))['"]/i.exec(await mirror.text())
    if (!link || link[2] !== file) throw new Error('OptiFine indirme bağlantısı doğrulanamadı.')
    const destination = join(this.store.dataPath, 'optifine', file)
    const manager = getDownloadManager()
    if (manager) {
      const runtime = manager.runtime()
      await manager.download({ urls: [`https://optifine.net/${link[1].replaceAll('&amp;', '&')}`], destination, maxBytes: 50_000_000, replace: true, validate: async path => statSync(path).size >= 100_000 && await runtime.validate(path, 'zip'), request: async (url, headers, signal) => {
        const response = await fetch(url, { headers, signal })
        if (response.ok && !response.headers.get('content-type')?.includes('java-archive')) { await response.body?.cancel(); throw new Error('OptiFine dosyası indirilemedi.') }
        return response
      } })
    } else {
      const download = await fetch(`https://optifine.net/${link[1].replaceAll('&amp;', '&')}`, { signal: AbortSignal.timeout(120000) })
      if (!download.ok || !download.headers.get('content-type')?.includes('java-archive')) throw new Error('OptiFine dosyası indirilemedi.')
      const bytes = Buffer.from(await download.arrayBuffer())
      if (bytes.length < 100_000 || bytes.length > 50_000_000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('OptiFine dosyası doğrulanamadı.')
      diskSpace().check(destination, bytes.length)
      mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes)
    }
    return destination
  }

  async installOptifine(baseId: string): Promise<string> {
    this.status({ kind: 'installing', label: 'OptiFine indiriliyor', detail: `${baseId} resmî siteden alınıyor`, progress: 5 })
    const installer = await this.officialOptifineInstaller(baseId)
    try { return await this.installOptifineJar(baseId, installer) }
    finally { try { unlinkSync(installer) } catch { /* A failed cleanup must not hide the installation result. */ } }
  }

  private async installOptifineJar(baseId: string, installer: string): Promise<string> {
    if (!versionIdPattern.test(baseId) || !installer.toLowerCase().endsWith('.jar') || !existsSync(installer)) throw new Error('Geçerli bir OptiFine .jar dosyası seçin.')
    try {
      const inspected = await resolveOptifineInstallManifest(installer, this.folder)
      if (!inspected.version.toLowerCase().startsWith(`${baseId}-optifine_`.toLowerCase())) throw new Error(`Bu OptiFine dosyası ${baseId} sürümüne ait değil.`)
      this.status({ kind: 'installing', label: 'OptiFine hazırlanıyor', detail: `${baseId} temel sürümü kuruluyor`, progress: 12 })
      const base = await this.installVersion(baseId, true)
      const java = await this.findJava(base)
      const { version, plan } = await resolveOptifineInstallManifest(installer, this.folder, { java })
      for (const task of plan.tasks) if (task.type === 'java') {
        for (const output of task.outputs) mkdirSync(dirname(output.path), { recursive: true })
      }
      this.status({ kind: 'installing', label: 'OptiFine kuruluyor', detail: version, progress: 88 })
      await executeInstallManifest(plan, (getDownloadManager()?.runtime() ?? createDefaultNodeInstallRuntime({ maxConcurrency: 8 })))
      await Version.parse(this.folder, version)
      this.status({ kind: 'idle', label: 'Hazır' })
      return version
    } catch (error) {
      this.status({ kind: 'error', label: 'OptiFine kurulamadı', detail: message(error) })
      throw error
    }
  }

  async deleteVersion(id: string): Promise<void> {
    if (this.busy || this.running) throw new Error('Başka bir işlem devam ediyor.')
    const installed = this.installedVersion(id)
    if (!installed) throw new Error('Kurulu sürüm bulunamadı.')
    const local = this.localVersions()
    if (local.vanilla.has(id) && (local.optifine.get(id) ?? []).some(item => item.source === installed.source)) {
      throw new Error('Bu sürüme bağlı OptiFine kurulumu var. Önce OptiFine sürümünü kaldırın.')
    }
    this.busy = true
    try {
      await shell.trashItem(installed.folder.getVersionRoot(id))
      this.status({ kind: 'idle', label: 'Hazır' })
    } finally { this.busy = false }
  }

  async play(profileId: string | null, versionOverride?: string, allowAdditional = false, serverOverride?: string, serverPreference?: ServerJoinPreference, temporaryOfflineName?: string, worldId?: string): Promise<LaunchResult> {
    if (this.busy) throw new Error('Başka bir oyun veya indirme işlemi devam ediyor.')
    const serverAddress = normalizeServerAddress(serverOverride)
    const state = this.store.get()
    if (profileId === null && (!versionOverride || !versionIdPattern.test(versionOverride))) throw new Error('Geçersiz sürüm kimliği.')
    const profile = profileId === null ? {
      id: `standalone:${versionOverride}`, name: `Minecraft ${versionOverride}`, versionId: versionOverride!,
      javaPath: state.settings.javaPath, memoryMb: state.settings.memoryMb, minMemoryMb: Math.min(1024, state.settings.memoryMb),
      width: state.settings.width, height: state.settings.height, createdAt: new Date().toISOString()
    } as LauncherProfile : state.profiles.find(p => p.id === profileId)
    if (temporaryOfflineName !== undefined && (profileId !== null || !serverAddress)) throw new Error('Geçici hesap yalnızca profilsiz sunucu katılımında kullanılabilir.')
    const account = temporaryOfflineName !== undefined ? offlineAccount(temporaryOfflineName) : state.accounts.find(a => a.id === state.selectedAccountId)
    if (!profile) throw new Error('Profil bulunamadı.')
    if (!account) throw new Error('Oynamak için bir hesap seçin veya çevrimdışı hesap oluşturun.')
    if (profileId !== null && versionOverride && versionOverride !== (profile.modLoaderVersion ?? profile.versionId)) throw new Error('Bu profil yalnızca kendi Minecraft sürümüyle çalışır. Başka bir sürüm için profili değiştirin.')
    if (worldId !== undefined) {
      if (profileId === null || serverAddress) throw new Error('Dünya bulunamadı.')
      await new WorldService(this.store).path(profileId, worldId)
      if (this.sessions.size && this.getRunningInstances().some(item => item.profileId === profileId)) throw new Error('Dünya açıkken bu işlem yapılamaz.')
    }
    // World validation yields to the event loop; another launch may have reserved preparation meanwhile.
    if (this.busy) throw new Error('Başka bir oyun veya indirme işlemi devam ediyor.')
    if (this.running && allowAdditional !== true) return { status: 'confirmation-required', instances: this.getRunningInstances() }
    this.busy = true
    try {
      const offlineAccount = account.kind === 'offline'
      this.status({ kind: 'launching', label: offlineAccount ? 'Çevrimdışı hesap hazırlanıyor' : 'Hesap doğrulanıyor', detail: account.name, profileId: profile.id, progress: 5 })
      // Verify Microsoft accounts before a potentially lengthy installation.
      const accessToken = offlineAccount ? undefined : await this.accounts.getLaunchToken(account)
      let versionId = profile.modLoaderVersion ?? profile.versionId
      if (versionId.endsWith(automaticOptifineSuffix)) {
        versionId = await this.installOptifine(versionId.slice(0, -automaticOptifineSuffix.length))
        if (profileId !== null) this.store.bindInstalledVersion(profile.id, versionId)
      }
      const installed = this.installedVersion(versionId)
      const resourceFolder = installed?.folder ?? this.folder
      let version = installed || existsSync(this.folder.getVersionJson(versionId))
        ? await Version.parse(resourceFolder, versionId) : await this.installVersion(versionId, true)
      if (this.isCustom(versionId)) version = await customResolvedVersion(version, resourceFolder)
      if (serverAddress && !serverLaunchMode(version.minecraftVersion || profile.versionId)) throw new Error('Bu Minecraft sürümü doğrudan sunucuya katılmayı desteklemiyor.')
      if (worldId !== undefined && serverLaunchMode(version.minecraftVersion || profile.versionId) !== 'quick-play') throw new Error('Dünyaya doğrudan katılım Minecraft 1.20 ve sonrasında desteklenir.')
      const imported = this.isCustom(versionId) ? await customRuntime(version, resourceFolder) : undefined
      if (imported) {
        const runtime = getDownloadManager()?.runtime() ?? createDefaultNodeInstallRuntime({ maxConcurrency: 8 })
        const missing = (files: InstallFile[]) => files.filter(file => !existsSync(file.path))
        this.status({ kind: 'launching', label: 'İstemci hazırlanıyor', detail: versionId, profileId: profile.id, progress: 15 })
        await runtime.download(missing(resolveLibraryInstallFiles(version.libraries.filter(library => !imported.providedNatives.has(library.name)), resourceFolder)))
        await runtime.download(missing(resolveAssetMetadataInstallFiles(version, resourceFolder)))
        await runtime.download(missing(await resolveAssetObjectInstallFiles(version, resourceFolder)))
      }
      const javaPath = await this.findJava(imported ? await customJavaVersion(version, resourceFolder) : version, profile, !!imported)
      this.status({ kind: 'launching', label: 'Oyun başlatılıyor', detail: `${profile.name} · ${versionId}`, profileId: profile.id, progress: 95 })
      const gamePath = profileId === null ? join(this.store.dataPath, 'standalone', versionId) : this.store.gamePath(profile)
      mkdirSync(gamePath, { recursive: true })
      if (serverAddress && serverPreference) saveMinecraftServerPreference(gamePath, serverAddress, serverPreference)
      const process = await launch({
        version,
        javaPath,
        gamePath,
        resourcePath: resourceFolder.root,
        ...(imported ? { nativeRoot: imported.nativeRoot, prechecks: imported.prechecks } : {}),
        gameProfile: { id: account.id, name: account.name },
        accessToken,
        userType: offlineAccount ? 'legacy' : undefined,
        launcherName: 'Green Launcher',
        launcherBrand: 'GreenLauncher',
        minMemory: Math.min(profile.minMemoryMb ?? 1024, profile.memoryMb),
        maxMemory: profile.memoryMb,
        resolution: { width: profile.width, height: profile.height, fullscreen: profile.fullscreen === true },
        ...(worldId !== undefined ? { quickPlaySingleplayer: worldId } : serverLaunchOptions(version.minecraftVersion || profile.versionId, serverAddress ?? profile.serverAddress)),
        extraJVMArgs: profile.jvmArgs?.trim() ? parseJvmArgs(profile.jvmArgs) : undefined,
        extraExecOption: { detached: false, windowsHide: true }
      })
      // Unread output pipes can block Minecraft during verbose loader startup.
      process.stdout?.resume()
      process.stderr?.resume()
      if (!process.pid) throw new Error('Oyun işlemi başlatılamadı.')
      if (process.exitCode !== null || process.signalCode !== null) throw new Error(`Oyun başlatılırken kapandı (${process.exitCode ?? process.signalCode}).`)
      const id = randomUUID()
      this.sessions.set(id, { id, pid: process.pid, profileId: profile.id, profileName: profile.name, accountId: account.id, accountName: account.name, versionId, loader: /optifine/i.test(versionId) ? 'optifine' : versionId === profile.modLoaderVersion ? profile.modLoader : undefined, startedAt: new Date().toISOString() })
      if (profileId !== null) this.store.markPlayed(profile.id, versionId)
      if (profileId !== null) this.playtime.start(this.sessions.get(id)!)
      this.emitInstances(this.getRunningInstances())
      this.status({ kind: 'playing', label: 'Oyun çalışıyor', detail: `${profile.name} · ${versionId}`, profileId: profile.id, progress: 100 })
      if (state.settings.closeOnLaunch) this.window()?.minimize()
      const finish = (error?: string) => {
        if (!this.sessions.delete(id)) return
        this.playtime.finish(id)
        this.emitInstances(this.getRunningInstances())
        if (this.busy) return
        const remaining = this.getRunningInstances()[0]
        this.status(error ? { kind: 'error', label: 'Oyun kapandı', detail: error } : remaining
          ? { kind: 'playing', label: 'Oyun çalışıyor', profileId: remaining.profileId, detail: `${remaining.profileName} · ${remaining.versionId}` }
          : { kind: 'idle', label: 'Hazır' })
      }
      process.once('exit', code => finish(code === 0 ? undefined : `Çıkış kodu: ${code ?? 'bilinmiyor'}`))
      process.once('error', error => finish(message(error)))
      return { status: 'started' }

    } catch (error) {
      this.status({ kind: 'error', label: 'Başlatma başarısız', detail: message(error), profileId: profile.id })
      throw error
    } finally { this.busy = false }
  }
}

export function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function parseJvmArgs(value: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const char of value) {
    if (char === quote) quote = null
    else if (!quote && (char === '"' || char === "'")) quote = char
    else if (!quote && /\s/.test(char)) { if (current) { args.push(current); current = '' } }
    else current += char
  }
  if (quote) throw new Error('JVM argümanlarında kapanmamış tırnak var.')
  if (current) args.push(current)
  return args.slice(0, 64)
}
