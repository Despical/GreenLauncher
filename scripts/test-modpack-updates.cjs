const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
function load(file) { const mod = { exports: {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: mod, exports: mod.exports, Buffer, structuredClone }); return mod.exports }
;(async () => {
  const { newerModpackVersions } = load('src/shared/modpack-updates.ts')
  const version = (id, published, type = 'release') => ({ id, published, type })
  const items = [version('opaque-current', '2026-09-01'), version('older', '2026-08-01'), version('new', '2026-10-01'), version('newest', '2026-10-03'), version('beta', '2026-10-04', 'beta'), version('invalid-date', 'invalid')]
  assert.equal(newerModpackVersions(items, 'opaque-current').map(v => v.id).join(','), 'newest,new')
  assert.equal(newerModpackVersions(items, 'missing').length, 0)
  assert.equal(newerModpackVersions(items, 'invalid-date').length, 0)
  assert.equal(newerModpackVersions([version('current-beta', '2026-09-01', 'beta'), ...items], 'current-beta').map(v => v.id).join(','), 'beta,newest,new')
  const { MetadataCache } = load('src/main/metadata-cache.ts'), cache = new MetadataCache()
  let calls = 0
  const fetch = async () => ({ revision: ++calls })
  await cache.get('pack', fetch); await cache.get('other', fetch); await cache.get('pack', fetch)
  assert.equal(calls, 2)
  assert.equal((await cache.get('pack', fetch, true)).revision, 3)
  assert.equal((await cache.get('other', fetch)).revision, 2, 'manual refresh retains other catalog entries')
  assert.equal((await cache.get('pack', fetch)).revision, 3, 'fresh response replaces the previous cached result')
  console.log('PASS newer pack releases by publication date, prerelease policy, missing current version and targeted manual metadata refresh')
})().catch(error => { console.error(error); process.exitCode = 1 })
