import type { InstalledResourcePack, LauncherProfile, ProfileContentKind, ProfileContentUpdate } from '../../shared/types'

type Snapshot = { packs: InstalledResourcePack[]; updates: ProfileContentUpdate[]; selected: string }
export const installedContentScope = (profile: LauncherProfile, kind: ProfileContentKind) => JSON.stringify([profile.id, profile.gameDirectory ?? '', profile.versionId, profile.modLoader ?? '', profile.modLoaderVersion ?? '', kind])

export function retainContentUpdates(before: InstalledResourcePack[], after: InstalledResourcePack[], updates: ProfileContentUpdate[]) {
  return updates.flatMap(update => {
    const previous = before.find(item => item.filename === update.filename)
    const candidates = previous ? after.filter(item => item.filename.replace(/\.disabled$/i, '') === previous.filename.replace(/\.disabled$/i, '') && item.projectId === previous.projectId && item.versionId === previous.versionId && item.modifiedAt === previous.modifiedAt) : []
    const current = candidates.find(item => item.filename === update.filename) ?? (candidates.length === 1 ? candidates[0] : undefined)
    return current ? [{ ...update, filename: current.filename }] : []
  })
}

// Keep the last successful view across profile changes; refresh it without an empty flash.
export class InstalledContentCache {
  private entries = new Map<string, Snapshot>()
  private pending = new Map<string, Promise<Snapshot | undefined>>()
  peek(key: string) { return this.entries.get(key) }
  remember(key: string, snapshot: Snapshot) {
    this.entries.delete(key); this.entries.set(key, snapshot)
    while (this.entries.size > 24) this.entries.delete(this.entries.keys().next().value!)
  }
  invalidate(key: string) { this.pending.delete(key) }
  load(key: string, list: () => Promise<InstalledResourcePack[]>): Promise<Snapshot | undefined> {
    const pending = this.pending.get(key)
    if (pending) return pending
    const task = list().then(packs => {
      if (this.pending.get(key) !== task) return undefined
      const previous = this.peek(key)
      const snapshot = { packs, updates: retainContentUpdates(previous?.packs ?? [], packs, previous?.updates ?? []), selected: previous?.selected ?? '' }
      this.remember(key, snapshot)
      return snapshot
    }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key) })
    this.pending.set(key, task)
    return task
  }
}
export const installedContentCache = new InstalledContentCache()
