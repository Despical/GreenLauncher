import { existsSync, lstatSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { InstalledMod, InstalledResourcePack, ProfileContentKind, ProfileContentUpdate, ModVersion } from '../shared/types'
import type { LauncherStore } from './store'
import type { ModrinthService } from './modrinth'
import type { CurseForgeService } from './curseforge'
import type { ResourcePacks } from './resource-packs'
import { inspectMod, modFileHash, type ModMetadata } from './mod-metadata'
import { ContentIconCache } from './content-icon-cache'
import { ProfileUpdateCache } from './profile-update-cache'

const noLink = (path: string) => { if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Paket yolu doğrulanamadı.') }
const validName = (value: string) => typeof value === 'string' && !!value && basename(value) === value && !/[\\/:\x00-\x1f]/.test(value) && value !== '.' && value !== '..'
const modFilename = (value: string) => validName(value) && /\.(jar|litemod)(\.disabled)?$/i.test(value)
const canonical = (name: string) => name.replace(/\.disabled$/i, '')

export class ProfileContent {
  private metadata = new Map<string, { signature: string; value: Promise<{ info: ModMetadata; hash?: string }> }>()
  private identified = new Map<string, { retryAt: number; mod?: Omit<InstalledMod, 'filename'> }>()
  private listing = new Map<string, Promise<InstalledResourcePack[]>>()
  private icons: ContentIconCache
  private updateCache: ProfileUpdateCache
  private projectIcons = new Map<string, string | undefined>()
  private projectUrls = new Map<string, string | undefined>()
  constructor(private store: LauncherStore, private modrinth: ModrinthService, private curseforge: CurseForgeService, private resources: ResourcePacks, private shaders: ResourcePacks, private busy: (profileId: string) => boolean = () => false, icons?: ContentIconCache) {
    this.icons = icons ?? new ContentIconCache(join(store.dataPath, 'cache', 'content-icons'))
    this.updateCache = new ProfileUpdateCache(join(store.dataPath, 'cache', 'content-updates'))
  }
  private profile(profileId: string, kind: ProfileContentKind) {
    if (!['mod', 'resourcepack', 'shader'].includes(kind)) throw new Error('Geçersiz içerik türü.')
    const profile = this.store.get().profiles.find(item => item.id === profileId)
    if (!profile) throw new Error('Profil bulunamadı.')
    return profile
  }
  private directory(profileId: string) {
    const profile = this.profile(profileId, 'mod'), directory = join(this.store.gamePath(profile), 'mods')
    noLink(directory); noLink(join(this.store.profilePath(profileId), 'green-launcher-mods.json'))
    if (existsSync(directory)) for (const item of readdirSync(directory)) noLink(join(directory, item))
    return directory
  }
  private assertMutable(profileId: string) {
    if (this.busy(profileId)) throw new Error('Paketleri değiştirmek için oyunu kapat.')
  }
  async list(profileId: string, kind: ProfileContentKind): Promise<InstalledResourcePack[]> {
    this.profile(profileId, kind)
    if (kind !== 'mod') return (kind === 'shader' ? this.shaders : this.resources).list(profileId)
    const pending = this.listing.get(profileId)
    if (pending) return pending
    const task = this.listMods(profileId).finally(() => this.listing.delete(profileId))
    this.listing.set(profileId, task)
    return task
  }
  private async listMods(profileId: string): Promise<InstalledResourcePack[]> {
    const directory = this.directory(profileId)
    if (!existsSync(directory)) return []
    const known = new Map(this.modrinth.installed(profileId).map(mod => [mod.filename, mod]))
    const files = readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && modFilename(file.name))
    const inspected: Array<{ filename: string; signature: string; info: ModMetadata; hash?: string; mod?: InstalledMod; modifiedAt: string }> = []
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
      while (cursor < files.length) {
        const index = cursor++, file = files[index], path = join(directory, file.name), stats = statSync(path), signature = `${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
        let mod = known.get(canonical(file.name))
        let cached = this.metadata.get(path)
        if (!cached || cached.signature !== signature) {
          cached = { signature, value: Promise.all([inspectMod(path), (!mod || mod.fileHash) && stats.size <= 256 * 1024 * 1024 ? modFileHash(path).catch(() => undefined) : Promise.resolve(undefined)]).then(([info, hash]) => ({ info, hash })) }
          this.metadata.set(path, cached)
          if (this.metadata.size > 512) this.metadata.delete(this.metadata.keys().next().value!)
        }
        const { info, hash } = await cached.value
        if (mod?.fileHash && mod.fileHash !== hash) mod = undefined
        inspected[index] = { filename: file.name, signature, info, hash, mod, modifiedAt: stats.mtime.toISOString() }
      }
    }))
    const unknown = inspected.filter(item => !item.mod && item.hash)
    const hashes = unknown.map(item => item.hash!).filter(hash => (this.identified.get(hash)?.retryAt ?? 0) <= Date.now())
    if (hashes.length && this.modrinth.identify) {
      try {
        const matches = await this.modrinth.identify(hashes)
        for (const hash of hashes) this.identified.set(hash, { retryAt: Date.now() + 10 * 60 * 1000, mod: matches.get(hash) })
      } catch { for (const hash of hashes) this.identified.set(hash, { retryAt: Date.now() + 60 * 1000 }) }
      if (this.identified.size > 2000) this.identified.clear()
    }
    const withoutIcons = inspected.filter(item => item.mod && !item.info.icon && !item.mod.icon && (item.mod.provider ?? 'modrinth') === 'modrinth')
    if (withoutIcons.length && this.modrinth.hydrate) {
      const summaries = await this.modrinth.hydrate(withoutIcons.map(item => ({ projectId: item.mod!.projectId, slug: '', title: item.mod!.title, description: item.mod!.description ?? '', author: '', iconUrl: null, downloads: 0, updated: '', categories: [] })))
      for (const item of withoutIcons) {
        const summary = summaries.find(summary => summary.projectId === item.mod!.projectId)
        if (summary) item.mod = { ...item.mod!, icon: summary.iconUrl ?? undefined, description: item.mod!.description || summary.description }
      }
    }
    const recovered: InstalledMod[] = []
    const items = await Promise.all(inspected.map(async item => {
      let mod = item.mod
      const match = item.hash && this.identified.get(item.hash)?.mod
      // Discard matches if the file changed while the provider lookup was running.
      const path = join(directory, item.filename)
      if (!existsSync(path)) return undefined
      noLink(path)
      const current = statSync(path)
      if (`${current.size}:${current.mtimeMs}:${current.ctimeMs}` !== item.signature) return undefined
      if (!mod && match) mod = { ...match, filename: canonical(item.filename) }
      const provider = mod?.provider ?? (mod ? 'modrinth' : undefined)
      const projectKey = `${provider}:${mod?.projectId}`, source = this.projectIcons.has(projectKey) ? this.projectIcons.get(projectKey) : mod?.icon
      const icon = item.info.icon || await this.icons.peek(source)
      // Lists render from local data; CDN requests run independently of listing.
      if (!item.info.icon && source) void this.icons.get(source)
      // Cache reads can outlive an external file replacement or removal.
      if (!existsSync(path)) return undefined
      noLink(path)
      const after = statSync(path)
      if (`${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== item.signature) return undefined
      if (!item.mod && match && mod) recovered.push(mod)
      return { ...mod, provider: provider === 'modrinth' || provider === 'curseforge' ? provider : undefined, sourceUrl: this.projectUrls.get(projectKey) ?? mod?.sourceUrl ?? (provider === 'modrinth' ? `https://modrinth.com/mod/${encodeURIComponent(mod!.projectId)}` : undefined), filename: item.filename, title: mod?.title || item.info.title || canonical(item.filename).replace(/\.(jar|litemod)$/i, ''), versionNumber: item.info.versionNumber || mod?.versionNumber, description: item.info.description || mod?.description || '', icon: icon ?? source, modifiedAt: item.modifiedAt, enabled: !/\.disabled$/i.test(item.filename) } satisfies InstalledResourcePack
    }))
    if (recovered.length && this.modrinth.remember) { this.directory(profileId); this.modrinth.remember(profileId, recovered) }
    return items.filter((item): item is NonNullable<typeof item> => !!item).sort((a, b) => a.title.localeCompare(b.title))
  }
  filePath(profileId: string, kind: ProfileContentKind, filename: string): string {
    const profile = this.profile(profileId, kind)
    if (!validName(filename) || kind === 'mod' && !modFilename(filename)) throw new Error('Paket bulunamadı.')
    const directory = kind === 'mod' ? this.directory(profileId) : join(this.store.gamePath(profile), kind === 'shader' ? 'shaderpacks' : 'resourcepacks'), path = join(directory, filename)
    noLink(directory); noLink(path)
    if (!existsSync(path) || kind === 'mod' && !statSync(path).isFile()) throw new Error('Paket bulunamadı.')
    return path
  }
  async enable(profileId: string, kind: ProfileContentKind, filename: string, enabled: boolean) {
    this.profile(profileId, kind); this.assertMutable(profileId)
    if (kind !== 'mod') return (kind === 'shader' ? this.shaders : this.resources).enable(profileId, filename, enabled)
    await this.listing.get(profileId)
    this.assertMutable(profileId)
    const directory = this.directory(profileId)
    if (!modFilename(filename) || !existsSync(join(directory, filename)) || !statSync(join(directory, filename)).isFile()) throw new Error('Paket bulunamadı.')
    if (enabled !== !/\.disabled$/i.test(filename)) {
      const target = join(directory, enabled ? canonical(filename) : `${filename}.disabled`); noLink(target)
      if (existsSync(target)) throw new Error('Bu dosyanın etkin veya kapalı bir kopyası zaten var.')
      renameSync(join(directory, filename), target)
    }
    return this.list(profileId, kind)
  }
  async install(profileId: string, kind: ProfileContentKind, versionId: string, provider: 'modrinth' | 'curseforge') {
    this.profile(profileId, kind); this.assertMutable(profileId)
    if (!['modrinth', 'curseforge'].includes(provider)) throw new Error('Geçersiz mod kaynağı.')
    if (kind !== 'mod') return (kind === 'shader' ? this.shaders : this.resources).install(profileId, versionId, provider)
    const directory = this.directory(profileId), before = await this.list(profileId, kind)
    const disabled = before.filter(mod => !mod.enabled && mod.provider && mod.projectId)
    // Preserve disabled state for the requested mod and any updated dependencies, even on partial failure.
    try { await (provider === 'modrinth' ? this.modrinth : this.curseforge).install(profileId, versionId) }
    finally {
      this.directory(profileId)
      const after = this.modrinth.installed(profileId)
      for (const old of disabled) {
        const next = after.find(mod => (mod.provider ?? 'modrinth') === old.provider && mod.projectId === old.projectId)
        if (!next || !validName(next.filename)) continue
        const active = join(directory, next.filename), target = `${active}.disabled`
        if (next.filename !== canonical(old.filename) && existsSync(join(directory, old.filename))) renameSync(join(directory, old.filename), join(directory, `${old.filename}.${randomUUID()}.backup`))
        if (existsSync(active)) { if (existsSync(target)) renameSync(target, `${target}.${randomUUID()}.backup`); renameSync(active, target) }
      }
    }
    return this.list(profileId, kind)
  }
  private async check(profileId: string, kind: ProfileContentKind, item: InstalledResourcePack): Promise<ProfileContentUpdate> {
    const result = { filename: item.filename }, profile = this.profile(profileId, kind)
    if (!item.provider || !item.projectId || !item.versionId) return { ...result, status: 'unknown' }
    const gameVersion = profile.versionId.split(/-OptiFine_/i)[0], loader = profile.modLoader ?? 'fabric'
    if (kind === 'mod' && !profile.modLoader) return { ...result, status: 'incompatible', compatible: false }
    try {
      const service = item.provider === 'modrinth' ? this.modrinth : this.curseforge
      const [project, versions] = await Promise.all([service.project(item.projectId), service.versions(item.projectId, gameVersion, loader, false, kind)])
      if (project.id !== item.projectId || project.projectType !== kind) throw new Error('Paket dosyası doğrulanamadı.')
      this.projectIcons.set(`${item.provider}:${item.projectId}`, project.iconUrl ?? undefined)
      this.projectUrls.set(`${item.provider}:${item.projectId}`, project.sourceUrl ?? undefined)
      if (kind === 'mod' && this.modrinth.remember) {
        const known = this.modrinth.installed(profileId).find(mod => mod.filename === canonical(item.filename) && (mod.provider ?? 'modrinth') === item.provider && mod.projectId === item.projectId)
        if (known && (known.icon !== (project.iconUrl ?? undefined) || known.sourceUrl !== (project.sourceUrl ?? undefined))) {
          this.directory(profileId)
          this.modrinth.remember(profileId, [{ ...known, icon: project.iconUrl ?? undefined, sourceUrl: project.sourceUrl ?? undefined }])
        }
      }
      let current: ModVersion
      if (item.provider === 'modrinth') {
        const info = await this.modrinth.version(item.versionId)
        if (info.projectId !== item.projectId) throw new Error('Paket dosyası doğrulanamadı.')
        current = info
      } else {
        const file = await this.curseforge.file(item.versionId)
        if (String(file.modId) !== item.projectId) throw new Error('Paket dosyası doğrulanamadı.')
        current = { id: item.versionId, name: file.displayName, versionNumber: file.displayName, type: ({ 1: 'release', 2: 'beta', 3: 'alpha' } as Record<number, string>)[file.releaseType] ?? 'release', published: file.fileDate, downloads: file.downloadCount, gameVersions: file.gameVersions, loaders: [] }
      }
      const compatible = current.gameVersions.includes(gameVersion) && (kind !== 'mod' || (item.provider === 'modrinth' ? current.loaders.includes(loader) : current.gameVersions.some(value => value.toLowerCase() === loader) || versions.some(version => version.id === current.id)))
      // Provider IDs are opaque. Publication times prevent downgrade suggestions, including prereleases.
      if (!Number.isFinite(Date.parse(current.published))) throw new Error('Paket dosyası doğrulanamadı.')
      const latest = versions.filter(version => version.id !== current.id && version.gameVersions.includes(gameVersion) && (kind !== 'mod' || version.loaders.includes(loader)) && (version.type === 'release' || current.type !== 'release' && version.type === current.type) && Date.parse(version.published) > Date.parse(current.published)).sort((a, b) => Date.parse(b.published) - Date.parse(a.published))[0]
      return { ...result, compatible, status: latest ? 'update' : compatible ? 'current' : 'incompatible', latest }
    } catch (error) { return { ...result, status: 'error', error: String((error as Error).message ?? error) } }
  }
  async updates(profileId: string, kind: ProfileContentKind, force = true): Promise<ProfileContentUpdate[]> {
    const items = await this.list(profileId, kind), profile = this.profile(profileId, kind)
    const fingerprint = createHash('sha256').update(JSON.stringify([profile.versionId, profile.modLoader, profile.modLoaderVersion, this.curseforge.connected, items.map(item => [item.filename, item.provider, item.projectId, item.versionId, item.modifiedAt])])).digest('hex')
    return this.updateCache.get(`${profileId}:${kind}`, fingerprint, force, () => this.checkItems(profileId, kind, items))
  }
  private async checkItems(profileId: string, kind: ProfileContentKind, items: InstalledResourcePack[]): Promise<ProfileContentUpdate[]> {
    const results: ProfileContentUpdate[] = []
    // Three bounded workers keep large mod lists responsive without flooding providers.
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
      while (cursor < items.length) { const index = cursor++; results[index] = await this.check(profileId, kind, items[index]) }
    }))
    return results
  }
  async update(profileId: string, kind: ProfileContentKind, filename: string) {
    this.assertMutable(profileId)
    const item = (await this.list(profileId, kind)).find(item => item.filename === filename)
    if (!item) throw new Error('Paket bulunamadı.')
    const checked = await this.check(profileId, kind, item)
    if (checked.status !== 'update' || !checked.latest || !item.provider) throw new Error(checked.error ?? 'Uyumlu güncelleme bulunamadı.')
    // Recompute from the owned profile at apply time; the renderer cannot supply a forged candidate.
    return this.install(profileId, kind, checked.latest.id, item.provider)
  }
}
