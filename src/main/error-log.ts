import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { diagnoseError } from '../shared/errors'
import type { LauncherErrorEntry } from '../shared/types'

// Game preparation reports through both activity events and the IPC request.
const logSource = (source: string) => /^(?:Oyun|play|play-version)$/i.test(source) ? 'Oyun' : source
const sameFailure = (entry: LauncherErrorEntry, candidate: LauncherErrorEntry) =>
  logSource(entry.source) === logSource(candidate.source) && entry.code === candidate.code && entry.message === candidate.message &&
  Math.abs(Date.parse(entry.at) - Date.parse(candidate.at)) < 5000

export class ErrorLog {
  readonly path: string
  private entries: LauncherErrorEntry[] = []
  private recent = new Map<string, { source: string; at: number }>()

  constructor(dataPath: string, private readonly changed: (entries: LauncherErrorEntry[]) => void) {
    this.path = join(dataPath, 'error-log.json')
    if (existsSync(this.path)) {
      try {
        const saved: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
        if (Array.isArray(saved)) {
          for (const item of saved) {
            if (!item || typeof item.message !== 'string' || typeof item.code !== 'string' || typeof item.source !== 'string' || typeof item.at !== 'string') continue
            const entry = { ...item, source: logSource(item.source) } as LauncherErrorEntry
            const previous = this.entries.find(old => old.source === entry.source && old.code === entry.code && old.message === entry.message)
            if (previous) { if (!sameFailure(previous, entry)) { previous.count = (previous.count ?? 1) + (entry.count ?? 1); previous.firstAt = [previous.firstAt ?? previous.at, entry.firstAt ?? entry.at].sort()[0]; previous.lastAt = [previous.lastAt ?? previous.at, entry.lastAt ?? entry.at].sort().at(-1); previous.at = previous.lastAt! } }
            else this.entries.push({ ...entry, count: Math.max(1, Math.floor(Number(entry.count) || 1)), firstAt: entry.firstAt ?? entry.at, lastAt: entry.lastAt ?? entry.at })
            if (this.entries.length === 100) break
          }
        }
      } catch { /* A damaged log should not stop the launcher. */ }
    }
    this.persist()
  }

  get(): LauncherErrorEntry[] { return structuredClone(this.entries) }

  clear(): LauncherErrorEntry[] {
    writeFileSync(this.path, '[]', 'utf8')
    this.entries = []
    this.recent.clear()
    this.changed([])
    return []
  }

  record(source: string, error: unknown): void {
    const diagnosis = source === 'Launcher güncellemesi' ? {
      code: String((error as { code?: unknown })?.code ?? '').slice(0, 80) || 'UPDATE_ERROR',
      message: (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/gi, '[URL]').replace(/(authorization|token|password)\s*[:=]\s*\S+/gi, '$1=[redacted]').slice(0, 600),
    } : diagnoseError(error)
    const entry = { id: randomUUID(), at: new Date().toISOString(), source: logSource(source), ...diagnosis }
    const key = JSON.stringify([entry.source, entry.code, entry.message]), recent = this.recent.get(key)
    if (recent && Date.now() - recent.at < 5000 && source !== recent.source && /^(?:Oyun|play|play-version)$/i.test(source) && /^(?:Oyun|play|play-version)$/i.test(recent.source)) return
    this.recent.set(key, { source, at: Date.now() })
    if (this.recent.size > 200) this.recent.delete(this.recent.keys().next().value!)
    const previous = this.entries.find(item => item.source === entry.source && item.code === entry.code && item.message === entry.message && item.level !== 'info')
    if (previous) {
      previous.count = (previous.count ?? 1) + 1; previous.firstAt ??= previous.at; previous.at = entry.at; previous.lastAt = entry.at
      this.entries = [previous, ...this.entries.filter(item => item !== previous)]
    } else this.entries.unshift({ ...entry, count: 1, firstAt: entry.at, lastAt: entry.at, level: 'error' })
    this.entries = this.entries.slice(0, 100)
    this.persist()
    this.changed(this.get())
  }

  info(source: string, message: string, code = 'UPDATE_SUCCESS'): void {
    const at = new Date().toISOString()
    this.entries.unshift({ id: randomUUID(), at, firstAt: at, lastAt: at, count: 1, source, message: message.slice(0, 600), code, level: 'info' })
    this.entries = this.entries.slice(0, 100); this.persist(); this.changed(this.get())
  }

  private persist(): void {
    try { writeFileSync(this.path, JSON.stringify(this.entries, null, 2), 'utf8') } catch { /* Logging must never break game launch. */ }
  }
}
