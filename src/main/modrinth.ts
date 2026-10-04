import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { InstalledMod, ModContentType, ModLoader, ModProject, ModSearchHit, ModSearchResult, ModSort, ModVersion } from '../shared/types'
import { LauncherStore } from './store'
import { downloadVerified } from './modrinth-download'
import { ProjectSummaryCache, type ProjectSummary } from './project-summary-cache'

const api = 'https://api.modrinth.com/v2'
const idPattern = /^[a-zA-Z0-9]{8,16}$/
const validLoaders: ModLoader[] = ['neoforge', 'forge', 'fabric', 'quilt', 'liteloader']
const validSorts: ModSort[] = ['relevance', 'downloads', 'follows', 'newest', 'updated']
const validCategories = ['all', 'adventure', 'cursed', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics', 'library', 'magic', 'management', 'minigame', 'mobs', 'optimization', 'social', 'storage', 'technology', 'transportation', 'utility', 'worldgen']
type ApiFile = { url: string; filename: string; primary: boolean; hashes: { sha512?: string; sha1?: string }; file_type?: string | null }
type ApiVersion = { id: string; project_id: string; name: string; version_number: string; version_type: string; date_published: string; downloads: number; game_versions: string[]; loaders: string[]; files: ApiFile[]; dependencies: Array<{ version_id: string | null; project_id: string | null; dependency_type: string }> }

function assertId(id: string): void { if (!idPattern.test(id)) throw new Error('Geçersiz Modrinth kimliği.') }
function assertGameVersion(version: string): void { if (!/^[a-zA-Z0-9._-]{1,90}$/.test(version)) throw new Error('Geçersiz Minecraft sürümü.') }
function assertLoader(loader: ModLoader): void { if (!validLoaders.includes(loader)) throw new Error('Geçersiz mod yükleyicisi.') }
async function request<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = `${api}${path}${params ? `?${params}` : ''}`
  const response = await fetch(url, { headers: { 'User-Agent': 'Despical/GreenLauncher/0.12.2', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(response.status === 429 ? 'Modrinth istek sınırına ulaşıldı. Biraz sonra tekrar deneyin.' : `Modrinth isteği başarısız (${response.status}).`)
  return await response.json() as T
}
function visibleVersion(version: ApiVersion): ModVersion {
  return { id: version.id, name: version.name, versionNumber: version.version_number, type: version.version_type, published: version.date_published, downloads: version.downloads, gameVersions: version.game_versions, loaders: version.loaders, filename: (version.files.find(file => file.primary) ?? version.files[0])?.filename }
}
function compatible(version: ApiVersion, gameVersion: string, loader: ModLoader): boolean {
  return version.game_versions.includes(gameVersion) && version.loaders.includes(loader)
}

export class ModrinthService {
  private summaries = new ProjectSummaryCache()
  constructor(private readonly store: LauncherStore) {}

  hydrate<T extends ModSearchHit>(hits: T[]): Promise<T[]> {
    return this.summaries.hydrate(hits, async ids => {
      for (const id of ids) assertId(id)
      const items = await request<Array<{ id: string; slug: string; title: string; description: string; icon_url: string | null; downloads: number; updated: string; categories: string[] }>>('/projects', new URLSearchParams({ ids: JSON.stringify(ids) }))
      return items.map((item): ProjectSummary => ({ projectId: item.id, slug: item.slug, title: item.title, description: item.description, iconUrl: item.icon_url, downloads: item.downloads, updated: item.updated, categories: item.categories }))
    })
  }

  async search(query: string, gameVersion: string, loader: ModLoader, sort: ModSort, offset: number, category: string, contentType: ModContentType = 'mod'): Promise<ModSearchResult> {
    assertGameVersion(gameVersion)
    assertLoader(loader)
    if (!validSorts.includes(sort)) throw new Error('Geçersiz sıralama.')
    if (!validCategories.includes(category)) throw new Error('Geçersiz kategori.')
    if (!['mod', 'modpack', 'resourcepack', 'shader'].includes(contentType)) throw new Error('Geçersiz içerik türü.')
    const facets = [[`project_type:${contentType}`], [`versions:${gameVersion}`]]
    if (contentType === 'mod' || contentType === 'modpack') facets.push([`categories:${loader}`])
    if (category !== 'all') facets.push([`categories:${category}`])
    const params = new URLSearchParams({ query: query.trim().slice(0, 100), facets: JSON.stringify(facets), index: sort, offset: String(Math.max(0, Math.min(10000, Math.floor(offset)))), limit: '9' })
    const result = await request<{ hits: Array<{ project_id: string; slug: string; title: string; description: string; author: string; icon_url: string | null; downloads: number; date_modified: string; categories: string[] }>; total_hits: number }>('/search', params)
    const hits = result.hits.map((hit): ModSearchHit => ({ projectId: hit.project_id, slug: hit.slug, title: hit.title, description: hit.description, author: hit.author, iconUrl: hit.icon_url, downloads: hit.downloads, updated: hit.date_modified, categories: hit.categories }))
    return { total: result.total_hits, hits: await this.hydrate(hits) }
  }

  async project(id: string): Promise<ModProject> {
    assertId(id)
    const item = await request<{ id: string; slug: string; title: string; description: string; body: string; icon_url: string | null; downloads: number; updated: string; categories: string[]; license?: { id?: string }; source_url: string | null; project_type: ModContentType }>(`/project/${id}`)
    this.summaries.remember({ projectId: item.id, slug: item.slug, title: item.title, description: item.description, iconUrl: item.icon_url, downloads: item.downloads, updated: item.updated, categories: item.categories })
    return { id: item.id, slug: item.slug, title: item.title, description: item.description, body: item.body, iconUrl: item.icon_url, downloads: item.downloads, license: item.license?.id ?? '—', sourceUrl: `https://modrinth.com/${item.project_type}/${encodeURIComponent(item.slug)}`, projectType: item.project_type }
  }

  async versions(id: string, gameVersion: string, loader: ModLoader, allGameVersions = false, contentType: ModContentType = 'mod'): Promise<ModVersion[]> {
    assertId(id)
    assertGameVersion(gameVersion)
    assertLoader(loader)
    const params = new URLSearchParams({ include_changelog: 'false' })
    if (contentType === 'mod' || contentType === 'modpack') params.set('loaders', JSON.stringify([loader]))
    if (!allGameVersions) params.set('game_versions', JSON.stringify([gameVersion]))
    const items = await request<ApiVersion[]>(`/project/${id}/version`, params)
    return items.map(visibleVersion)
  }

  async resourcePack(versionId: string, gameVersion: string, contentType: 'resourcepack' | 'shader' = 'resourcepack') {
    assertId(versionId)
    const version = await request<ApiVersion>(`/version/${versionId}`)
    const project = await this.project(version.project_id)
    if (version.id !== versionId || project.id !== version.project_id) throw new Error('Kaynak paketi dosyası doğrulanamadı.')
    if (project.projectType !== contentType || !version.game_versions.includes(gameVersion)) throw new Error('Kaynak paketi profilin Minecraft sürümüyle uyumlu değil.')
    const file = version.files.find(file => file.primary && /\.zip$/i.test(file.filename)) ?? version.files.find(file => /\.zip$/i.test(file.filename))
    if (!file || new URL(file.url).protocol !== 'https:' || new URL(file.url).hostname !== 'cdn.modrinth.com') throw new Error('Kaynak paketi dosyası doğrulanamadı.')
    return { project, version: visibleVersion(version), file }
  }

  async version(versionId: string) {
    assertId(versionId)
    const version = await request<ApiVersion>(`/version/${versionId}`)
    if (version.id !== versionId) throw new Error('Paket dosyası doğrulanamadı.')
    return { ...visibleVersion(version), projectId: version.project_id }
  }

  private manifestPath(profileId: string): string {
    return join(this.store.profilePath(profileId), 'green-launcher-mods.json')
  }

  async identify(hashes: string[]): Promise<Map<string, Omit<InstalledMod, 'filename'>>> {
    const matches = new Map<string, Omit<InstalledMod, 'filename'>>()
    const unique = [...new Set(hashes)]
    if (unique.some(hash => !/^[a-f0-9]{40}$/.test(hash))) throw new Error('Geçersiz dosya özeti.')
    for (let offset = 0; offset < unique.length; offset += 100) {
      const response = await fetch(`${api}/version_files`, { method: 'POST', headers: { 'User-Agent': 'Despical/GreenLauncher', 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: unique.slice(offset, offset + 100), algorithm: 'sha1' }), signal: AbortSignal.timeout(5000) })
      if (!response.ok) throw new Error(`Modrinth isteği başarısız (${response.status}).`)
      const versions = await response.json() as Record<string, ApiVersion>
      const valid = Object.entries(versions).filter(([hash, version]) => unique.includes(hash) && idPattern.test(version.id) && idPattern.test(version.project_id) && version.files?.some(file => file.hashes?.sha1 === hash && /\.(jar|litemod)$/i.test(file.filename)))
      const ids = [...new Set(valid.map(([, version]) => version.project_id))]
      if (!ids.length) continue
      const projects = await request<Array<{ id: string; slug: string; title: string; description: string; icon_url: string | null; project_type: string }>>('/projects', new URLSearchParams({ ids: JSON.stringify(ids) }))
      for (const [hash, version] of valid) {
        const project = projects.find(project => project.id === version.project_id && project.project_type === 'mod')
        if (project) matches.set(hash, { provider: 'modrinth', projectId: project.id, versionId: version.id, versionNumber: version.version_number, title: project.title, description: project.description, icon: project.icon_url ?? undefined, sourceUrl: `https://modrinth.com/mod/${encodeURIComponent(project.slug)}`, fileHash: hash })
      }
    }
    return matches
  }

  remember(profileId: string, mods: InstalledMod[]): void {
    const path = this.manifestPath(profileId)
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Paket yolu doğrulanamadı.')
    // Automatic discovery must not replace malformed or partially readable user metadata.
    if (existsSync(path)) {
      try {
        const saved = JSON.parse(readFileSync(path, 'utf8'))
        if (!Array.isArray(saved) || saved.some(item => !item || typeof item.projectId !== 'string' || typeof item.versionId !== 'string' || typeof item.filename !== 'string') || this.installed(profileId).length !== saved.length) return
      } catch { return }
    }
    const current = this.installed(profileId)
    // Re-read after network lookups so concurrent installs keep their new records.
    for (const mod of mods) {
      const same = current.findIndex(item => item.filename === mod.filename)
      if (same >= 0) { if (current[same].fileHash && current[same].fileHash !== mod.fileHash) current[same] = mod; continue }
      if (!current.some(item => (item.provider ?? 'modrinth') === mod.provider && item.projectId === mod.projectId)) current.push(mod)
    }
    mkdirSync(this.store.profilePath(profileId), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(current, null, 2), 'utf8'); renameSync(temporary, path)
  }

  installed(profileId: string): InstalledMod[] {
    const profile = this.store.get().profiles.find(item => item.id === profileId)
    if (!profile) throw new Error('Profil bulunamadı.')
    const path = this.manifestPath(profileId)
    if (!existsSync(path)) return []
    try {
      const items = JSON.parse(readFileSync(path, 'utf8')) as InstalledMod[]
      return Array.isArray(items) ? items.filter(item => item && typeof item.projectId === 'string' && typeof item.filename === 'string' && basename(item.filename) === item.filename && /^[a-zA-Z0-9._+() -]+\.(jar|litemod)$/i.test(item.filename) && typeof item.versionId === 'string') : []
    } catch { return [] }
  }

  async install(profileId: string, versionId: string, repairing = false): Promise<InstalledMod[]> {
    assertId(versionId)
    const profile = this.store.get().profiles.find(item => item.id === profileId)
    if (!profile) throw new Error('Profil bulunamadı.')
    if (!profile.modLoader || !profile.modLoaderVersion) throw new Error('Önce bu profile mod yükleyicisini kurun.')
    const gameVersion = profile.versionId
    const loader = profile.modLoader
    const installed = this.installed(profileId)
    const planned = new Map<string, ApiVersion>()
    const visit = async (id: string, depth: number): Promise<void> => {
      if (depth > 20 || planned.size > 30) throw new Error('Mod bağımlılık zinciri çok uzun.')
      assertId(id)
      const version = await request<ApiVersion>(`/version/${id}`)
      if (planned.has(version.project_id)) return
      if (!compatible(version, gameVersion, loader)) throw new Error(`${version.name} seçilen Minecraft sürümü ve yükleyiciyle uyumlu değil.`)
      planned.set(version.project_id, version)
      for (const dependency of version.dependencies ?? []) {
        if (dependency.dependency_type !== 'required') continue
        let dependencyId = dependency.version_id
        if (repairing && !dependencyId && dependency.project_id) dependencyId = installed.find(item => item.projectId === dependency.project_id && (item.provider ?? 'modrinth') === 'modrinth')?.versionId ?? null
        if (!dependencyId && dependency.project_id) {
          assertId(dependency.project_id)
          const params = new URLSearchParams({ game_versions: JSON.stringify([gameVersion]), loaders: JSON.stringify([loader]), include_changelog: 'false' })
          const versions = await request<ApiVersion[]>(`/project/${dependency.project_id}/version`, params)
          dependencyId = versions.find(item => item.version_type === 'release')?.id ?? versions[0]?.id ?? null
        }
        if (!dependencyId) throw new Error(`${version.name} için gerekli bir bağımlılığın uyumlu sürümü bulunamadı.`)
        await visit(dependencyId, depth + 1)
      }
    }
    await visit(versionId, 0)
    const modsDir = join(this.store.gamePath(profile), 'mods')
    mkdirSync(modsDir, { recursive: true })
    for (const version of planned.values()) {
      if (!repairing && installed.some(item => item.versionId === version.id && (item.provider ?? 'modrinth') === 'modrinth' && existsSync(join(modsDir, item.filename)))) continue
      const file = version.files.find(item => item.primary && isModFile(item, loader)) ?? version.files.find(item => isModFile(item, loader))
      if (!file) throw new Error(`${version.name} için kurulabilir mod dosyası yok.`)
      const fileUrl = new URL(file.url)
      if (fileUrl.protocol !== 'https:' || fileUrl.hostname !== 'cdn.modrinth.com') throw new Error('Mod dosyası güvenilir Modrinth adresinde değil.')
      const project = await this.project(version.project_id)
      const cleanName = basename(file.filename).replace(/[^a-zA-Z0-9._+() -]/g, '_').slice(0, 140)
      const filename = `${version.project_id}-${version.id}-${cleanName}`
      const path = join(modsDir, filename)
      await downloadVerified([file.url], file.hashes, path, join(this.store.dataPath, 'cache', 'modrinth-files'))
      const next: InstalledMod = { provider: 'modrinth', projectId: version.project_id, title: project.title, versionId: version.id, versionNumber: version.version_number, filename, sourceUrl: project.sourceUrl ?? undefined, icon: project.iconUrl ?? undefined, description: project.description }
      const previous = installed.find(item => item.projectId === version.project_id && (item.provider ?? 'modrinth') === 'modrinth')
      if (previous?.filename !== filename && previous && existsSync(join(modsDir, previous.filename))) {
        // Keep an older version as a disabled backup instead of deleting a user's file.
        const disabled = join(modsDir, `${previous.filename}.${randomUUID()}.disabled`)
        renameSync(join(modsDir, previous.filename), disabled)
      }
      const index = installed.findIndex(item => item.projectId === version.project_id && (item.provider ?? 'modrinth') === 'modrinth')
      if (index < 0) installed.push(next)
      else installed[index] = next
      const manifest = this.manifestPath(profileId)
      writeFileSync(`${manifest}.tmp`, JSON.stringify(installed, null, 2), 'utf8')
      renameSync(`${manifest}.tmp`, manifest)
    }
    return installed
  }
}

function isModFile(file: ApiFile, loader: ModLoader): boolean {
  const extension = extname(file.filename).toLowerCase()
  return (extension === '.jar' || (loader === 'liteloader' && extension === '.litemod')) && !['sources-jar', 'dev-jar', 'javadoc-jar', 'signature'].includes(file.file_type ?? '')
}
