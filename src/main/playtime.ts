import { performance } from 'node:perf_hooks'
import type { PlaySession, RunningInstance } from '../shared/types'

export class PlaytimeTracker {
  private sessions = new Map<string, { session: PlaySession; started: number }>()
  private timer: ReturnType<typeof setInterval> | undefined
  constructor(private readonly record: (session: PlaySession) => void, private readonly clock = () => performance.now()) {}

  start(instance: RunningInstance): void {
    this.sessions.set(instance.id, { started: this.clock(), session: { id: instance.id, profileId: instance.profileId, profileName: instance.profileName, versionId: instance.versionId, startedAt: instance.startedAt, endedAt: instance.startedAt, durationMs: 0 } })
    this.checkpoint(instance.id)
    this.timer ??= setInterval(() => { for (const id of this.sessions.keys()) this.checkpoint(id) }, 30_000)
    this.timer.unref?.()
  }
  checkpoint(id: string): void {
    const tracked = this.sessions.get(id)
    if (!tracked) return
    tracked.session.durationMs = Math.max(0, Math.round(this.clock() - tracked.started))
    // A monotonic timeline protects totals from system-clock adjustments.
    tracked.session.endedAt = new Date(Date.parse(tracked.session.startedAt) + tracked.session.durationMs).toISOString()
    this.record({ ...tracked.session })
  }
  finish(id: string): void {
    if (!this.sessions.has(id)) return
    this.checkpoint(id)
    this.sessions.delete(id)
    if (!this.sessions.size) { clearInterval(this.timer); this.timer = undefined }
  }
  dispose(): void { for (const id of [...this.sessions.keys()]) this.finish(id) }
}
