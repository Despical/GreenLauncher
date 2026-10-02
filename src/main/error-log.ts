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

  constructor(dataPath: string, private readonly changed: (entries: LauncherErrorEntry[]) => void) {
    this.path = join(dataPath, 'error-log.json')
    if (existsSync(this.path)) {
      try {
        const saved: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
        if (Array.isArray(saved)) {
          for (const item of saved) {
            if (!item || typeof item.message !== 'string' || typeof item.code !== 'string' || typeof item.source !== 'string' || typeof item.at !== 'string') continue
            const entry = { ...item, source: logSource(item.source) } as LauncherErrorEntry
            if (!this.entries.some(previous => sameFailure(previous, entry))) this.entries.push(entry)
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
    this.changed([])
    return []
  }

  record(source: string, error: unknown): void {
    const diagnosis = diagnoseError(error)
    const entry = { id: randomUUID(), at: new Date().toISOString(), source: logSource(source), ...diagnosis }
    if (this.entries.some(previous => sameFailure(previous, entry))) return
    this.entries.unshift(entry)
    this.entries = this.entries.slice(0, 100)
    this.persist()
    this.changed(this.get())
  }

  private persist(): void {
    try { writeFileSync(this.path, JSON.stringify(this.entries, null, 2), 'utf8') } catch { /* Logging must never break game launch. */ }
  }
}
