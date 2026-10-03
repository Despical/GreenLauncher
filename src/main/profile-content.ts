import { existsSync, lstatSync, readdirSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { InstalledResourcePack, ProfileContentKind, ProfileContentUpdate, ModVersion } from '../shared/types'
import type { LauncherStore } from './store'
import type { ModrinthService } from './modrinth'
import type { CurseForgeService } from './curseforge'
import type { ResourcePacks } from './resource-packs'

const noLink = (path: string) => { if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Paket yolu doğrulanamadı.') }
const validName = (value: string) => typeof value === 'string' && !!value && basename(value) === value && !/[\\/:\x00-\x1f]/.test(value) && value !== '.' && value !== '..'
const modFilename = (value: string) => validName(value) && /\.(jar|litemod)(\.disabled)?$/i.test(value)
const canonical = (name: string) => name.replace(/\.disabled$/i, '')

export class ProfileContent {
  constructor(private store: LauncherStore, private modrinth: ModrinthService, private curseforge: CurseForgeService, private resources: ResourcePacks, private shaders: ResourcePacks, private busy: (profileId: string) => boolean = () => false) {}
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
    const directory = this.directory(profileId)
    if (!existsSync(directory)) return []
    const known = new Map(this.modrinth.installed(profileId).map(mod => [mod.filename, mod]))
    return readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && modFilename(file.name)).map(file => {
      const mod = known.get(canonical(file.name)), provider = mod?.provider ?? (mod ? 'modrinth' : undefined)
      return { ...mod, provider: provider === 'modrinth' || provider === 'curseforge' ? provider : undefined, filename: file.name, title: mod?.title ?? canonical(file.name).replace(/\.(jar|litemod)$/i, ''), description: '', modifiedAt: statSync(join(directory, file.name)).mtime.toISOString(), enabled: !/\.disabled$/i.test(file.name) }
    }).sort((a, b) => a.title.localeCompare(b.title))
  }
  async enable(profileId: string, kind: ProfileContentKind, filename: string, enabled: boolean) {
    this.profile(profileId, kind); this.assertMutable(profileId)
    if (kind !== 'mod') return (kind === 'shader' ? this.shaders : this.resources).enable(profileId, filename, enabled)
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
  async updates(profileId: string, kind: ProfileContentKind): Promise<ProfileContentUpdate[]> {
    const items = await this.list(profileId, kind), results: ProfileContentUpdate[] = []
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
