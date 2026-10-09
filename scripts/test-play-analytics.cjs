const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
process.env.TZ = 'Europe/Istanbul'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'green-analytics-'))
function load(file) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module: mod, exports: mod.exports, Date, structuredClone, Buffer,
    require: name => name === 'electron' ? { app: { getPath: () => directory }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) } } : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)
  })
  return mod.exports
}
const { playAnalytics } = load('src/shared/play-analytics.ts'), { LauncherStore } = load('src/main/store.ts')
const profiles = [{ id: 'a', name: 'Survival' }, { id: 'b', name: 'Fabric' }]
const now = new Date('2026-10-09T12:00:00+03:00'), hour = 3_600_000
const session = (id, start, end, profileId = 'a', durationMs = Date.parse(end) - Date.parse(start)) => ({ id, profileId, profileName: 'Historical name', versionId: '1.21.1', startedAt: start, endedAt: end, durationMs })
const midnight = session('midnight', '2026-10-08T23:30:00+03:00', '2026-10-09T00:30:00+03:00')
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('PASS', name) }
const close = (a, b) => assert.ok(Math.abs(a - b) < .01, `${a} != ${b}`)
try {
  check('midnight sessions conserve real duration and split into two local days', () => {
    const data = playAnalytics(profiles, [midnight], '7d', '', now)
    assert.equal(data.total, hour); assert.equal(data.activeDays, 2)
    assert.equal(data.daily.get('2026-10-08').durationMs, hour / 2); assert.equal(data.daily.get('2026-10-09').durationMs, hour / 2)
    close(data.buckets.reduce((sum, item) => sum + item.durationMs, 0), data.total)
    assert.equal(data.currentStreak, 2); assert.equal(data.longestStreak, 2)
  })
  check('range boundaries include exactly seven local dates and clip a crossing session', () => {
    const data = playAnalytics(profiles, [session('edge', '2026-10-02T23:00:00+03:00', '2026-10-03T01:00:00+03:00')], '7d', '', now)
    assert.equal(data.total, hour); assert.equal(data.buckets.length, 7); assert.equal(data.from, Date.parse('2026-10-03T00:00:00+03:00'))
    assert.equal(data.sessions[0].playedMs, hour); assert.equal(data.calendar.filter(day => day.inRange).length, 7)
  })
  check('annual calendar covers every one of 365 dates, including zero-play days and earlier sessions', () => {
    const old = session('old', '2026-02-01T10:00:00+03:00', '2026-02-01T12:00:00+03:00')
    const edge = session('year-edge', '2025-10-09T23:30:00+03:00', '2025-10-10T00:30:00+03:00')
    const excluded = session('outside-year', '2025-10-08T10:00:00+03:00', '2025-10-08T12:00:00+03:00')
    const annual = playAnalytics(profiles, [midnight, old, edge, excluded], '365d', '', now)
    const dates = annual.calendar.filter(day => day.inRange)
    assert.equal(dates.length, 365); assert.equal(annual.calendar.length, 371)
    assert.equal(dates[0].key, '2025-10-10'); assert.equal(dates.at(-1).key, '2026-10-09')
    assert.equal(new Set(dates.map(day => day.key)).size, 365)
    assert.equal(dates.find(day => day.key === '2026-02-02').durationMs, 0)
    assert.equal(dates.find(day => day.key === '2026-02-01').durationMs, 2 * hour)
    assert.equal(dates[0].durationMs, hour / 2)
    assert.equal(annual.total, 3.5 * hour)
    assert.equal(playAnalytics(profiles, [midnight, old, edge, excluded], '7d', '', now).total, hour)
  })
  check('annual profile calendar remains empty and complete without recording fake sessions', () => {
    const annual = playAnalytics(profiles, [midnight], '365d', 'b', now)
    assert.equal(annual.calendar.filter(day => day.inRange).length, 365)
    assert.equal(annual.sessions.length, 0); assert.ok(annual.calendar.every(day => day.durationMs === 0))
  })
  check('missing, deleted and other-account profiles never enter totals or ranking', () => {
    const data = playAnalytics(profiles, [midnight, { ...midnight, id: 'foreign', profileId: 'foreign' }, { ...midnight, id: 'deleted', profileId: 'deleted' }], 'all', '', now)
    assert.equal(data.total, hour); assert.equal(data.ranking.length, 1); assert.equal(data.ranking[0].profile.name, 'Survival')
  })
  check('profile filtering and ranking use profile ids and current names', () => {
    const data = playAnalytics(profiles, [midnight, session('b', '2026-10-05T10:00:00+03:00', '2026-10-05T12:00:00+03:00', 'b')], '30d', '', now)
    assert.equal(data.ranking[0].profile.id, 'b'); assert.equal(data.average, 1.5 * hour)
    assert.equal(playAnalytics(profiles, data.sessions, '30d', 'a', now).total, hour)
    assert.equal(playAnalytics(profiles, data.sessions, '30d', 'missing', now).total, 0)
  })
  check('duplicate checkpoints do not double count and concurrent games retain separate time', () => {
    const data = playAnalytics(profiles, [midnight, { ...midnight, durationMs: hour / 2 }, { ...midnight, id: 'concurrent', profileId: 'b' }], '30d', '', now)
    assert.equal(data.total, 2 * hour); assert.equal(data.sessions.length, 2); assert.equal(data.activeDays, 2)
  })
  check('invalid, zero, negative, reversed and future records are ignored', () => {
    const data = playAnalytics(profiles, [midnight, { ...midnight, id: 'invalid', startedAt: 'bad' }, { ...midnight, id: 'zero', durationMs: 0 }, { ...midnight, id: 'negative', durationMs: -1 }, { ...midnight, id: 'nan', durationMs: NaN }, { ...midnight, id: 'reversed', startedAt: midnight.endedAt, endedAt: midnight.startedAt }, session('future', '2026-10-10T10:00:00+03:00', '2026-10-10T11:00:00+03:00')], 'all', '', now)
    assert.equal(data.total, hour); assert.equal(data.sessions.length, 1)
  })
  check('future portions are clipped to now and scaled measured durations conserve totals', () => {
    const data = playAnalytics(profiles, [session('partial', '2026-10-09T11:00:00+03:00', '2026-10-09T13:00:00+03:00', 'a', hour)], '7d', '', now)
    assert.equal(data.total, hour / 2); assert.equal(data.daily.get('2026-10-09').durationMs, hour / 2)
  })
  check('streaks stop at gaps and an ongoing streak can end yesterday', () => {
    const items = [4, 5, 7, 8].map(day => session(String(day), `2026-10-0${day}T10:00:00+03:00`, `2026-10-0${day}T11:00:00+03:00`))
    const data = playAnalytics(profiles, items, '30d', '', now)
    assert.equal(data.longestStreak, 2); assert.equal(data.currentStreak, 2); assert.equal(data.weekdays[6].durationMs, hour)
    assert.equal(playAnalytics(profiles, items, '30d', '', new Date('2026-10-11T12:00:00+03:00')).currentStreak, 0)
  })
  check('empty history has finite zero metrics and a usable calendar', () => {
    const data = playAnalytics(profiles, [], 'all', '', now)
    assert.equal(data.total, 0); assert.equal(data.average, 0); assert.equal(data.activeDays, 0); assert.equal(data.ranking.length, 0); assert.equal(data.bestDay, undefined); assert.equal(data.calendar.length % 7, 0)
  })
  for (const [label, start, unit] of [['weekly', '2026-03-01T10:00:00+03:00', 'week'], ['monthly', '2024-01-01T10:00:00+03:00', 'month'], ['yearly', '2018-01-01T10:00:00+03:00', 'year']]) check(`${label} long-history chart preserves totals without thousands of daily bars`, () => {
    const end = new Date(Date.parse(start) + hour).toISOString(), data = playAnalytics(profiles, [session(label, start, end), midnight], 'all', '', now)
    assert.equal(data.unit, unit); assert.ok(data.buckets.length <= 61); close(data.buckets.reduce((sum, item) => sum + item.durationMs, 0), 2 * hour)
    assert.ok(data.calendar.length <= 98)
  })
  process.env.TZ = 'Europe/Berlin'
  for (const [label, start, end, elapsed] of [['spring', '2026-03-29T00:00:00+01:00', '2026-03-30T00:00:00+02:00', 23], ['autumn', '2026-10-25T00:00:00+02:00', '2026-10-26T00:00:00+01:00', 25]]) check(`${label} daylight-saving day uses ${elapsed} elapsed hours`, () => {
    const data = playAnalytics(profiles, [session(label, start, end)], '7d', '', new Date(end))
    assert.equal(data.total, elapsed * hour); assert.equal(data.activeDays, 1); assert.equal([...data.daily.values()][0].durationMs, elapsed * hour)
    close(data.weekdays.reduce((sum, day) => sum + day.durationMs, 0), data.total)
  })
  process.env.TZ = 'Europe/Istanbul'
  check('real store account switching and profile deletion keep analytics private', () => {
    const store = new LauncherStore(), create = name => ({ name, versionId: '1.21.1', javaPath: '', memoryMb: 2048, width: 1280, height: 720 })
    const owner = store.createOfflineAccount('AnalyticsOne').selectedAccountId, first = store.saveProfile(create('First')).selectedProfileId
    store.recordPlaySession({ ...midnight, profileId: first })
    store.createOfflineAccount('AnalyticsTwo'); const second = store.saveProfile(create('Second')).selectedProfileId
    store.recordPlaySession({ ...midnight, id: 'second', profileId: second, durationMs: 2 * hour })
    let state = store.get(); assert.equal(playAnalytics(state.profiles, state.playSessions, 'all', '', now).total, 2 * hour)
    store.selectAccount(owner); state = store.get(); assert.equal(playAnalytics(state.profiles, state.playSessions, 'all', '', now).total, hour)
    store.deleteProfile(first); state = store.get(); assert.equal(playAnalytics(state.profiles, state.playSessions, 'all', '', now).total, 0)
  })
  console.log(`${checks} isolated analytics checks passed; no user data or network used.`)
} finally { fs.rmSync(directory, { recursive: true, force: true }) }
