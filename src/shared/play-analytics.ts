import type { LauncherProfile, PlaySession } from './types'

export type AnalyticsPeriod = '7d' | '30d' | '90d' | '365d' | 'all'
export interface AnalyticsDay { key: string; date: number; durationMs: number; sessions: number }
export interface AnalyticsBucket { from: number; to: number; durationMs: number }
export interface AnalyticsSession extends PlaySession { playedMs: number }

export const localDayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const midnight = (value: number) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day }
const shift = (value: Date, days: number) => { const result = new Date(value); result.setDate(result.getDate() + days); return result }
const overlap = (start: number, end: number, from: number, to: number, duration: number) => duration * Math.max(0, Math.min(end, to) - Math.max(start, from)) / (end - start)

// Recorded process time is split by local calendar days. It is never inferred
// from launch history, and concurrent games retain their independent durations.
export function playAnalytics(profiles: LauncherProfile[], sessions: PlaySession[], period: AnalyticsPeriod, profileId = '', now = new Date()) {
  const ids = new Set(profiles.map(profile => profile.id))
  const unique = new Map<string, PlaySession>()
  for (const session of sessions) {
    if (!ids.has(session.profileId) || profileId && session.profileId !== profileId) continue
    const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= now.getTime() || !Number.isFinite(session.durationMs) || session.durationMs <= 0) continue
    if (!unique.has(session.id) || unique.get(session.id)!.durationMs < session.durationMs) unique.set(session.id, session)
  }
  const history = [...unique.values()]
  const today = midnight(now.getTime())
  const days = period === 'all' ? null : Number(period.slice(0, -1))
  const from = days === null ? midnight(history.length ? history.reduce((earliest, session) => Math.min(earliest, Date.parse(session.startedAt)), now.getTime()) : shift(today, -29).getTime()) : shift(today, 1 - days)
  const daily = new Map<string, AnalyticsDay>()
  const profileTotals = new Map<string, { durationMs: number; sessions: number }>()
  const selected: AnalyticsSession[] = []
  for (const session of history) {
    const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt)
    const playedMs = overlap(start, end, from.getTime(), now.getTime(), session.durationMs)
    if (playedMs <= 0) continue
    selected.push({ ...session, playedMs })
    const total = profileTotals.get(session.profileId) ?? { durationMs: 0, sessions: 0 }
    total.durationMs += playedMs; total.sessions++
    profileTotals.set(session.profileId, total)
    let cursor = midnight(Math.max(start, from.getTime()))
    const until = Math.min(end, now.getTime())
    while (cursor.getTime() < until) {
      const next = shift(cursor, 1), key = localDayKey(cursor)
      const value = daily.get(key) ?? { key, date: cursor.getTime(), durationMs: 0, sessions: 0 }
      value.durationMs += overlap(start, end, cursor.getTime(), Math.min(next.getTime(), until), session.durationMs)
      value.sessions++
      daily.set(key, value)
      cursor = next
    }
  }
  selected.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || a.id.localeCompare(b.id))
  const activeDays = [...daily.values()].sort((a, b) => a.date - b.date)
  const weekdays = Array.from({ length: 7 }, (_, index) => ({ index, durationMs: 0 }))
  let longestStreak = 0, streak = 0, previous: number | undefined
  for (const day of activeDays) {
    weekdays[(new Date(day.date).getDay() + 6) % 7].durationMs += day.durationMs
    streak = previous !== undefined && shift(new Date(previous), 1).getTime() === day.date ? streak + 1 : 1
    longestStreak = Math.max(longestStreak, streak); previous = day.date
  }
  let currentStreak = 0, cursor = daily.has(localDayKey(today)) ? today : shift(today, -1)
  while (daily.has(localDayKey(cursor))) { currentStreak++; cursor = shift(cursor, -1) }
  const span = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000) + 1
  const unit = span <= 90 ? 'day' : span <= 366 ? 'week' : span <= 1827 ? 'month' : 'year'
  const buckets: AnalyticsBucket[] = []
  cursor = new Date(from)
  while (cursor <= today) {
    const next = unit === 'day' ? shift(cursor, 1) : unit === 'week' ? shift(cursor, 7) : unit === 'month' ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) : new Date(cursor.getFullYear() + 1, 0, 1)
    buckets.push({ from: cursor.getTime(), to: Math.min(next.getTime(), now.getTime()), durationMs: 0 })
    cursor = next
  }
  let index = 0
  for (const day of activeDays) {
    while (index < buckets.length - 1 && day.date >= buckets[index].to) index++
    if (buckets[index]) buckets[index].durationMs += day.durationMs
  }
  const heatFrom = days === null ? new Date(Math.max(from.getTime(), shift(today, -90).getTime())) : from
  const calendar: Array<AnalyticsDay & { inRange: boolean }> = []
  cursor = shift(heatFrom, -(heatFrom.getDay() + 6) % 7)
  const calendarEnd = shift(today, 6 - (today.getDay() + 6) % 7)
  while (cursor <= calendarEnd) {
    const key = localDayKey(cursor)
    calendar.push({ ...(daily.get(key) ?? { key, date: cursor.getTime(), durationMs: 0, sessions: 0 }), inRange: cursor >= heatFrom && cursor <= today })
    cursor = shift(cursor, 1)
  }
  const total = selected.reduce((sum, session) => sum + session.playedMs, 0)
  const ranking = profiles.flatMap(profile => { const value = profileTotals.get(profile.id); return value ? [{ profile, ...value }] : [] }).sort((a, b) => b.durationMs - a.durationMs || a.profile.name.localeCompare(b.profile.name))
  const bestDay = activeDays.reduce<AnalyticsDay | undefined>((best, day) => !best || day.durationMs > best.durationMs ? day : best, undefined)
  const favoriteWeekday = weekdays.reduce((best, day) => day.durationMs > best.durationMs ? day : best)
  const longestSession = selected.reduce<AnalyticsSession | undefined>((best, session) => !best || session.playedMs > best.playedMs ? session : best, undefined)
  return { from: from.getTime(), to: now.getTime(), total, sessions: selected, activeDays: activeDays.length, average: selected.length ? total / selected.length : 0, daily, buckets, unit, weekdays, calendar, ranking, bestDay, favoriteWeekday, longestSession, longestStreak, currentStreak }
}
