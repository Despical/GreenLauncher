import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileContentUpdate } from '../shared/types'

type Entry = { fingerprint: string; until: number; results: ProfileContentUpdate[] }
export class ProfileUpdateCache {
  private memory = new Map<string, Entry>()
  private pending = new Map<string, { fingerprint: string; task: Promise<ProfileContentUpdate[]> }>()
  constructor(private directory: string, private now = Date.now) {}
  async get(key: string, fingerprint: string, force: boolean, check: () => Promise<ProfileContentUpdate[]>): Promise<ProfileContentUpdate[]> {
    const current = this.pending.get(key)
    if (current?.fingerprint === fingerprint) return structuredClone(await current.task)
    const cached = this.memory.get(key) ?? this.read(key)
    if (!force && cached?.fingerprint === fingerprint && cached.until > this.now()) return structuredClone(cached.results)
    const task = check().then(results => {
      const entry = { fingerprint, results, until: this.now() + (results.some(item => item.status === 'error') ? 2 : 30) * 60_000 }
      this.memory.set(key, entry)
      while (this.memory.size > 256) this.memory.delete(this.memory.keys().next().value!)
      try { mkdirSync(this.directory, { recursive: true }); const path = this.path(key), temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, JSON.stringify(entry)); renameSync(temp, path) } catch {}
      return results
    }).finally(() => { if (this.pending.get(key)?.task === task) this.pending.delete(key) })
    this.pending.set(key, { fingerprint, task })
    return structuredClone(await task)
  }
  private path(key: string) { return join(this.directory, createHash('sha256').update(key).digest('hex') + '.json') }
  private read(key: string): Entry | undefined {
    try {
      const path = this.path(key)
      if (statSync(path).size > 4 * 1024 * 1024) return undefined
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Entry
      if (typeof saved.fingerprint !== 'string' || !Number.isFinite(saved.until) || !Array.isArray(saved.results) || saved.results.some(item => !item || typeof item.filename !== 'string' || !['current', 'update', 'unknown', 'incompatible', 'error'].includes(item.status))) return undefined
      if (saved.until > this.now() + 30 * 60_000 || saved.results.some(item => item.status === 'update' && (!item.latest || typeof item.latest.id !== 'string' || typeof item.latest.versionNumber !== 'string' || !Array.isArray(item.latest.gameVersions) || !Array.isArray(item.latest.loaders) || !Number.isFinite(Date.parse(item.latest.published))))) return undefined
      this.memory.set(key, saved); return saved
    } catch { return undefined }
  }
}
