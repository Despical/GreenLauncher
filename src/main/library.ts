import { app, clipboard, ClipboardItem, nativeImage, shell } from 'electron'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { screenshotPageSize, type CleanupItem, type CleanupPreview, type DiskUsage, type ScreenshotItem, type ScreenshotSort } from '../shared/types'
import { LauncherStore } from './store'

const imageExtensions = new Set(['.png', '.jpg', '.jpeg'])
const olderThan = Date.now() - 14 * 24 * 60 * 60 * 1000

async function filesIn(path: string): Promise<string[]> {
  try { return (await readdir(path, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => join(path, entry.name)) }
  catch { return [] }
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0
  const pending = [path]
  while (pending.length) {
    const current = pending.pop()!
    let entries: import('node:fs').Dirent[]
    try { entries = await readdir(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) { try { total += (await stat(full)).size } catch { /* File changed during scan. */ } }
    }
  }
  return total
}

export class LibraryService {
  private readonly thumbnailCache = new Map<string, string>()
  private readonly previewCache = new Map<string, string>()
  constructor(private readonly store: LauncherStore) {}

  private screenshotFolders(): Array<{ profileId: string | null; path: string }> {
    return [
      ...this.store.get().profiles.map(profile => ({ profileId: profile.id, path: join(this.store.gamePath(profile), 'screenshots') })),
      { profileId: null, path: join(app.getPath('appData'), '.minecraft', 'screenshots') }
    ]
  }

  private screenshotPath(id: string): string {
    let descriptor: { profileId: string | null; name: string }
    try { descriptor = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as typeof descriptor } catch { throw new Error('Geçersiz ekran görüntüsü.') }
    if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.name !== 'string' || basename(descriptor.name) !== descriptor.name || !imageExtensions.has(extname(descriptor.name).toLowerCase())) throw new Error('Geçersiz ekran görüntüsü.')
    const folder = this.screenshotFolders().find(item => item.profileId === descriptor.profileId)
    if (!folder) throw new Error('Ekran görüntüsü bulunamadı.')
    return join(folder.path, descriptor.name)
  }

  async screenshots(scope = 'all', offset = 0, sort: ScreenshotSort = 'newest'): Promise<ScreenshotItem[]> {
    if (scope !== 'all' && scope !== 'standard' && !this.store.get().profiles.some(profile => profile.id === scope)) throw new Error('Profil bulunamadı.')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Geçersiz galeri sayfası.')
    if (sort !== 'newest' && sort !== 'oldest') throw new Error('Geçersiz galeri sıralaması.')
    const results: Array<{ id: string; profileId: string | null; name: string; modifiedAt: string; path: string }> = []
    const folders = this.screenshotFolders().filter(folder => scope === 'all' || (scope === 'standard' ? folder.profileId === null : folder.profileId === scope))
    for (const folder of folders) {
      for (const path of await filesIn(folder.path)) {
        const name = basename(path)
        if (!imageExtensions.has(extname(name).toLowerCase())) continue
        try {
          const info = await lstat(path)
          if (!info.isFile()) continue
          results.push({ id: Buffer.from(JSON.stringify({ profileId: folder.profileId, name })).toString('base64url'), profileId: folder.profileId, name, modifiedAt: info.mtime.toISOString(), path })
        } catch { /* File changed during scan. */ }
      }
    }
    results.sort((a, b) => (sort === 'newest' ? b.modifiedAt.localeCompare(a.modifiedAt) : a.modifiedAt.localeCompare(b.modifiedAt)) || a.id.localeCompare(b.id))
    const page = results.slice(offset, offset + screenshotPageSize)
    const thumbnails: Array<ScreenshotItem | null> = Array(page.length).fill(null)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(2, page.length) }, async () => {
      while (next < page.length) {
        const index = next++
        const item = page[index]
        const key = `${item.path}\0${item.modifiedAt}`
        try {
          let thumbnail = this.thumbnailCache.get(key)
          if (!thumbnail) {
            const image = await nativeImage.createThumbnailFromPath(item.path, { width: 640, height: 360 })
            if (image.isEmpty()) continue
            thumbnail = `data:image/jpeg;base64,${image.toJPEG(90).toString('base64')}`
            this.thumbnailCache.set(key, thumbnail)
            if (this.thumbnailCache.size > 240) this.thumbnailCache.delete(this.thumbnailCache.keys().next().value!)
          }
          thumbnails[index] = { id: item.id, profileId: item.profileId, name: item.name, modifiedAt: item.modifiedAt, thumbnail }
        } catch { /* Damaged image or file removed during scan. */ }
      }
    }))
    return thumbnails.filter((item): item is ScreenshotItem => item !== null)
  }

  async screenshot(id: string): Promise<string> {
    const path = this.screenshotPath(id)
    const info = await lstat(path)
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Ekran görüntüsü açılamadı.')
    const mime = extname(path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
    return `data:${mime};base64,${(await readFile(path)).toString('base64')}`
  }

  async screenshotPreview(id: string): Promise<string> {
    const path = this.screenshotPath(id)
    const info = await lstat(path)
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Ekran görüntüsü açılamadı.')
    const key = `${path}\0${info.mtimeMs}`
    const cached = this.previewCache.get(key)
    if (cached) return cached
    const image = await nativeImage.createThumbnailFromPath(path, { width: 960, height: 540 })
    if (image.isEmpty()) throw new Error('Ekran görüntüsü açılamadı.')
    const value = `data:image/jpeg;base64,${image.toJPEG(90).toString('base64')}`
    this.previewCache.set(key, value)
    if (this.previewCache.size > 48) this.previewCache.delete(this.previewCache.keys().next().value!)
    return value
  }

  async copyScreenshot(id: string): Promise<void> {
    const path = this.screenshotPath(id)
    if (!(await lstat(path)).isFile()) throw new Error('Ekran görüntüsü bulunamadı.')
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) throw new Error('Ekran görüntüsü kopyalanamadı.')
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
  }

  async openScreenshotLocation(id: string): Promise<void> {
    const path = this.screenshotPath(id)
    if (!(await lstat(path)).isFile()) throw new Error('Ekran görüntüsü bulunamadı.')
    shell.showItemInFolder(path)
  }

  async deleteScreenshot(id: string): Promise<void> {
    const path = this.screenshotPath(id)
    if (!(await lstat(path)).isFile()) throw new Error('Ekran görüntüsü bulunamadı.')
    await shell.trashItem(path)
  }

  async diskUsage(): Promise<DiskUsage> {
    const profiles = await Promise.all(this.store.get().profiles.map(async profile => ({
      id: profile.id, name: profile.name, bytes: await directoryBytes(this.store.gamePath(profile))
    })))
    const sharedBytes = await directoryBytes(this.store.minecraftPath)
    return { profiles, sharedBytes, totalBytes: profiles.reduce((sum, item) => sum + item.bytes, sharedBytes) }
  }

  private async cleanupCandidates(): Promise<CleanupItem[]> {
    const candidates: CleanupItem[] = []
    const roots = [...new Set(this.store.get().profiles.map(item => this.store.gamePath(item)))]
    for (const root of roots) {
      for (const [folder, kind] of [['logs', 'logs'], ['crash-reports', 'crashReports']] as const) {
        for (const path of await filesIn(join(root, folder))) {
          try {
            const info = await lstat(path)
            if (info.isFile() && info.mtimeMs < olderThan) candidates.push({ path, kind, bytes: info.size })
          } catch { /* File changed during scan. */ }
        }
      }
    }
    const versionsRoot = join(this.store.minecraftPath, 'versions')
    const used = new Set([this.store.get().selectedVersionId, ...this.store.allProfiles().flatMap(item => [item.versionId, item.modLoaderVersion])].filter(Boolean))
    try {
      for (const entry of await readdir(versionsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-zA-Z0-9._-]{1,90}$/.test(entry.name)) continue
        if (used.has(entry.name) || [...used].some(id => id?.startsWith(`${entry.name}-OptiFine_`))) continue
        const path = join(versionsRoot, entry.name)
        candidates.push({ path, kind: 'versions', bytes: await directoryBytes(path) })
      }
    } catch { /* No launcher-owned versions directory yet. */ }
    return candidates
  }

  async cleanupPreview(): Promise<CleanupPreview> {
    const candidates = await this.cleanupCandidates()
    return { logs: candidates.filter(item => item.kind === 'logs').length, crashReports: candidates.filter(item => item.kind === 'crashReports').length, versions: candidates.filter(item => item.kind === 'versions').length, bytes: candidates.reduce((sum, item) => sum + item.bytes, 0), items: candidates }
  }

  async cleanUnusedFiles(approvedPaths: string[]): Promise<CleanupPreview> {
    if (!Array.isArray(approvedPaths) || approvedPaths.some(path => typeof path !== 'string')) throw new Error('Temizleme listesi geçersiz.')
    const approved = new Set(approvedPaths)
    const candidates = (await this.cleanupCandidates()).filter(item => approved.has(item.path))
    const removed: CleanupPreview = { logs: 0, crashReports: 0, versions: 0, bytes: 0, items: [] }
    for (const item of candidates) {
      await shell.trashItem(item.path)
      removed[item.kind]++
      removed.bytes += item.bytes
      removed.items.push(item)
    }
    return removed
  }
}
