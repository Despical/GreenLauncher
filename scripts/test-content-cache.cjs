const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-content-cache-'))
function load(name, globals = {}) {
  const mod = { exports: {} }, file = path.resolve('src/main', name + '.ts')
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require, Buffer, URL, structuredClone, AbortSignal, ...globals })
  return mod.exports
}
;(async () => {
  let now = Date.now(), calls = 0, offline = false, active = 0, maximum = 0, malformed = false, oversized = false
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZFYAAAAASUVORK5CYII=', 'base64')
  const fetch = async () => {
    calls++; active++; maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 10)); active--
    if (offline) throw Error('Offline')
    return { ok: true, headers: { get: () => oversized ? String(3 * 1024 * 1024) : null }, body: (async function* () { yield malformed ? Buffer.from('not an image') : png })() }
  }
  const { ContentIconCache } = load('content-icon-cache', { fetch }), directory = path.join(root, 'icons'), url = 'https://cdn.modrinth.com/icon.png'
  const icons = new ContentIconCache(directory, () => now)
  assert.equal(await icons.peek(url), undefined); assert.equal(calls, 0, 'local peek never waits for network')
  const results = await Promise.all(Array.from({ length: 12 }, () => icons.get(url)))
  assert.equal(calls, 1); assert.ok(results.every(result => result === 'data:image/png;base64,' + png.toString('base64')))
  await icons.get(url); assert.equal(calls, 1, 'memory reuse')
  const restarted = new ContentIconCache(directory, () => now)
  assert.equal(await restarted.peek(url), results[0]); assert.equal(calls, 1, 'local peek loads persisted icons')
  await Promise.all(Array.from({ length: 5 }, (_, i) => restarted.get(i === 0 ? url : 'https://cdn.modrinth.com/icon-' + i + '.png')))
  assert.equal(calls, 5, 'disk reuse on restart, new URLs use separate entries'); assert.ok(maximum <= 3, 'bounded downloads')
  offline = true; now += 25 * 60 * 60_000
  assert.equal(await restarted.get(url), results[0], 'expired icons remain usable offline'); const attempts = calls
  await restarted.get(url); assert.equal(calls, attempts, 'failed fetch backoff')
  assert.equal(await restarted.get('https://evil.example/icon.png'), undefined); assert.equal(await restarted.get('http://cdn.modrinth.com/icon.png'), undefined); assert.equal(await restarted.get('https://secret@cdn.modrinth.com/icon.png'), undefined); assert.equal(calls, attempts)
  offline = false; malformed = true; assert.equal(await restarted.get('https://cdn.modrinth.com/bad.png'), undefined)
  malformed = false; oversized = true; assert.equal(await restarted.get('https://cdn.modrinth.com/oversize.png'), undefined)
  const { ProfileUpdateCache } = load('profile-update-cache'), updatesDir = path.join(root, 'updates'), updates = new ProfileUpdateCache(updatesDir, () => now)
  let checks = 0, status = 'current'
  const check = async () => { checks++; await new Promise(resolve => setTimeout(resolve, 10)); return [{ filename: 'fixture.jar', status }] }
  const cached = await Promise.all(Array.from({ length: 8 }, () => updates.get('owned:mod', 'MC-loader-file-A', false, check)))
  assert.equal(checks, 1); cached[0][0].status = 'unknown'
  assert.equal((await updates.get('owned:mod', 'MC-loader-file-A', false, check))[0].status, 'current', 'caller mutation cannot poison cache')
  await new ProfileUpdateCache(updatesDir, () => now).get('owned:mod', 'MC-loader-file-A', false, check); assert.equal(checks, 1, 'persistent update cache')
  await updates.get('owned:mod', 'MC-loader-file-A', true, check); assert.equal(checks, 2, 'manual check bypasses cached results')
  await updates.get('owned:mod', 'MC-loader-file-B', false, check); assert.equal(checks, 3, 'changed fingerprint invalidates results')
  now += 31 * 60_000; await updates.get('owned:mod', 'MC-loader-file-B', false, check); assert.equal(checks, 4, 'periodic expiration')
  status = 'error'; await updates.get('owned:mod', 'MC-loader-file-B', true, check); const errors = checks
  now += 60_000; await updates.get('owned:mod', 'MC-loader-file-B', false, check); assert.equal(checks, errors)
  now += 61_000; await updates.get('owned:mod', 'MC-loader-file-B', false, check); assert.equal(checks, errors + 1, 'failed checks retry after two minutes')
  const cachePath = path.join(updatesDir, fs.readdirSync(updatesDir)[0]); fs.writeFileSync(cachePath, JSON.stringify({ fingerprint: 'MC-loader-file-B', until: now + 1000, results: [{ filename: 'fixture.jar', status: 'update', latest: {} }] }))
  await new ProfileUpdateCache(updatesDir, () => now).get('owned:mod', 'MC-loader-file-B', false, check); assert.equal(checks, errors + 2, 'malformed persisted candidates are ignored')
  console.log('PASS bounded icon downloads, memory/disk reuse, coalescing, changed addresses, offline stale fallback, backoff and URL/size/content validation; update persistence, TTL, manual refresh, fingerprint invalidation, mutation isolation and corrupt-cache rejection')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(root, { recursive: true, force: true }))
