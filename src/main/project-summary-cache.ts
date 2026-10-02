import type { ModSearchHit } from '../shared/types'

export type ProjectSummary = Pick<ModSearchHit, 'projectId' | 'slug' | 'title' | 'description' | 'iconUrl' | 'downloads' | 'updated' | 'categories'>
export class ProjectSummaryCache {
  private values = new Map<string, { value: ProjectSummary; expires: number }>()
  private pending = new Map<string, Promise<void>>()
  constructor(private ttl = 120_000, private now = Date.now) {}
  remember(value: ProjectSummary) {
    if (!value || typeof value.projectId !== 'string' || typeof value.title !== 'string' || typeof value.description !== 'string' || typeof value.slug !== 'string' || !Number.isFinite(value.downloads) || value.downloads < 0 || !Array.isArray(value.categories)) return
    this.values.delete(value.projectId)
    this.values.set(value.projectId, { value: structuredClone(value), expires: this.now() + this.ttl })
    while (this.values.size > 1000) this.values.delete(this.values.keys().next().value!)
  }
  async hydrate<T extends ModSearchHit>(hits: T[], fetchBatch: (ids: string[]) => Promise<ProjectSummary[]>): Promise<T[]> {
    const stale = [...new Set(hits.map(hit => hit.projectId))].filter(id => (this.values.get(id)?.expires ?? 0) <= this.now())
    const requests: Promise<void>[] = []
    const missing = stale.filter(id => { const existing = this.pending.get(id); if (existing) requests.push(existing); return !existing })
    for (let i = 0; i < missing.length; i += 100) {
      const ids = missing.slice(i, i + 100)
      const task = Promise.resolve().then(() => fetchBatch(ids)).then(values => { for (const value of values) if (ids.includes(value.projectId)) this.remember(value) }).catch(() => {
        // Keep saved/cached information offline and avoid retry storms.
        for (const id of ids) { const item = this.values.get(id); if (item) item.expires = this.now() + 30_000 }
      }).finally(() => { for (const id of ids) if (this.pending.get(id) === task) this.pending.delete(id) })
      for (const id of ids) this.pending.set(id, task)
      requests.push(task)
    }
    await Promise.all(requests)
    return hits.map(hit => ({ ...hit, ...structuredClone(this.values.get(hit.projectId)?.value) }))
  }
}
