const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
process.env.TZ = 'Europe/Istanbul'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'green-playtime-'))
const electron = { app: { getPath: () => directory }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) } }
function load(file) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: mod, exports: mod.exports, require: name => name === 'electron' ? electron : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name), structuredClone, Buffer, console, setInterval, clearInterval })
  return mod.exports
}
const { LauncherStore } = load('src/main/store.ts'), { PlaytimeTracker } = load('src/main/playtime.ts'), { playtimeSummary } = load('src/shared/playtime.ts')
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('PASS', name) }
const create = name => ({ name, versionId: '26.3', javaPath: '', memoryMb: 2048, width: 1280, height: 720 })
let store = new LauncherStore()
const owner = store.createOfflineAccount('PlayerOne').selectedAccountId, profile = store.saveProfile(create('World')).selectedProfileId
let clock = 0
const tracker = new PlaytimeTracker(session => store.recordPlaySession(session), () => clock)
const instance = (id, profileId = profile) => ({ id, profileId, profileName: 'World', versionId: '26.3', startedAt: '2026-10-02T10:00:00Z' })
try {
  tracker.start(instance('a')); clock = 65_000; tracker.checkpoint('a')
  check('checkpoint saves one real measured session', () => { assert.equal(store.get().playSessions.length, 1); assert.equal(store.get().playSessions[0].durationMs, 65_000) })
  store = new LauncherStore()
  check('restart preserves only the last checkpoint without counting downtime', () => assert.equal(store.get().playSessions[0].durationMs, 65_000))
  tracker.start(instance('b')); clock = 100_000; tracker.finish('a'); tracker.finish('a')
  check('concurrent sessions are independent and duplicate exits do not double count', () => { assert.equal(store.get().playSessions.length, 2); assert.equal(store.get().playSessions.find(s => s.id === 'a').durationMs, 100_000) })
  const foreign = store.createOfflineAccount('PlayerTwo').selectedAccountId
  store.saveProfile(create('Other world')); clock = 120_000; tracker.finish('b')
  check('account changes hide foreign history while the original process still saves', () => assert.equal(store.get().playSessions.length, 0))
  store.selectAccount(owner)
  check('original account history retains its own process duration', () => assert.equal(store.get().playSessions.find(s => s.id === 'b').durationMs, 55_000))
  store.updateSettings({ savePlaytime: false })
  check('opting out removes persisted durations but keeps in-memory history', () => { assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'launcher.json'))).playSessions.length, 0); assert.equal(store.get().playSessions.length, 2) })
  tracker.start(instance('c')); clock = 140_000; tracker.finish('c')
  check('new sessions remain memory-only while opted out', () => { assert.equal(store.get().playSessions.length, 3); assert.equal(new LauncherStore().get().playSessions.length, 0) })
  store.updateSettings({ savePlaytime: true })
  check('opting back in persists available in-memory history', () => assert.equal(new LauncherStore().get().playSessions.length, 3))
  const session = (id, start, end) => ({ id, profileId: profile, profileName: 'World', versionId: '26.3', startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(), durationMs: Date.parse(end) - Date.parse(start) })
  const acrossMidnight = session('midnight', '2026-10-01T23:30:00+03:00', '2026-10-02T00:30:00+03:00')
  check('a midnight session splits daily duration at the local boundary', () => { const result = playtimeSummary([acrossMidnight], profile, new Date('2026-10-02T12:00:00+03:00')); assert.equal(result.daily, 30 * 60_000); assert.equal(result.weekly, 60 * 60_000) })
  const acrossWeek = session('week', '2026-09-27T23:30:00+03:00', '2026-09-28T00:30:00+03:00')
  check('weeks start Monday and split a Sunday-to-Monday session', () => assert.equal(playtimeSummary([acrossWeek], profile, new Date('2026-09-28T12:00:00+03:00')).weekly, 30 * 60_000))
  check('summaries exclude other profiles without losing lifetime totals', () => { const result = playtimeSummary([acrossMidnight, { ...acrossWeek, profileId: 'other' }], profile, new Date('2026-10-09T12:00:00+03:00')); assert.equal(result.total, 60 * 60_000); assert.equal(result.weekly, 0) })
  process.env.TZ = 'Europe/Berlin'
  const daylight = session('dst', '2026-03-29T00:00:00+01:00', '2026-03-30T00:00:00+02:00')
  check('a 23-hour daylight-saving day uses real elapsed time', () => assert.equal(playtimeSummary([daylight], profile, new Date('2026-03-29T23:59:59+02:00')).daily, 23 * 3600_000 - 1000))
  tracker.start(instance('shutdown')); clock = 150_000; tracker.dispose()
  check('orderly launcher exit flushes the final partial checkpoint', () => assert.equal(store.get().playSessions.find(s => s.id === 'shutdown').durationMs, 10_000))
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'launcher.json'))); saved.playSessions = [{ id: 'bad', durationMs: -1 }, { ...saved.playSessions[0], durationMs: 'NaN' }]; fs.writeFileSync(path.join(directory, 'launcher.json'), JSON.stringify(saved))
  check('damaged old duration data is ignored without breaking profiles', () => { const state = new LauncherStore().get(); assert.equal(state.playSessions.length, 0); assert.equal(state.profiles.length, 1) })
  store.selectAccount(foreign)
  console.log(`${checks} isolated playtime checks passed; no user data or network used.`)
} finally { tracker.dispose(); fs.rmSync(directory, { recursive: true, force: true }) }
