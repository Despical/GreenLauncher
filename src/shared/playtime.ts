import type { PlaySession } from './types'

// Split sessions at local calendar boundaries, including daylight-saving changes.
export function playtimeSummary(sessions: PlaySession[], profileId: string, now = new Date()) {
  const history = sessions.filter(session => session.profileId === profileId && session.durationMs > 0).sort((a, b) => b.endedAt.localeCompare(a.endedAt))
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const week = new Date(day)
  week.setDate(week.getDate() - (week.getDay() + 6) % 7)
  const overlap = (session: PlaySession, from: number, to: number) => {
    const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
    return session.durationMs * Math.max(0, Math.min(end, to) - Math.max(start, from)) / (end - start)
  }
  return { history, total: history.reduce((sum, session) => sum + session.durationMs, 0),
    daily: history.reduce((sum, session) => sum + overlap(session, day.getTime(), now.getTime()), 0),
    weekly: history.reduce((sum, session) => sum + overlap(session, week.getTime(), now.getTime()), 0) }
}
