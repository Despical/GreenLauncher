const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/renderer/src/installed-content-cache.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports })
const { InstalledContentCache, installedContentScope } = mod.exports
;(async () => {
  const cache = new InstalledContentCache(), key = installedContentScope({ id: 'a', versionId: '1.21.1' }, 'mod')
  const pack = { filename: 'mod.jar', title: 'Mod', modifiedAt: '1', projectId: 'project', versionId: 'v1', enabled: true }, update = { filename: 'mod.jar', status: 'update' }
  cache.remember(key, { packs: [pack], updates: [update], selected: pack.filename })
  let finish, calls = 0
  const load = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const first = cache.load(key, load), second = cache.load(key, load)
  assert.equal(calls, 1); assert.equal(first, second); assert.equal(cache.peek(key).packs[0].title, 'Mod', 'last view available while refreshing')
  finish([{ ...pack, filename: 'mod.jar.disabled', enabled: false }]); await first
  assert.equal(cache.peek(key).updates[0].filename, 'mod.jar.disabled', 'toggle preserves update result')
  const old = cache.load(key, load); cache.invalidate(key)
  cache.remember(key, { packs: [{ ...pack, versionId: 'v2' }], updates: [], selected: 'mod.jar' })
  finish([pack]); assert.equal(await old, undefined); assert.equal(cache.peek(key).packs[0].versionId, 'v2', 'older request cannot undo mutation')
  await cache.load(key, () => Promise.resolve([{ ...pack, versionId: 'v3' }]))
  assert.equal(cache.peek(key).updates.length, 0, 'changed artifact loses old update result')
  assert.notEqual(key, installedContentScope({ id: 'a', versionId: '1.21.1', gameDirectory: 'other' }, 'mod'))
  assert.notEqual(key, installedContentScope({ id: 'b', versionId: '1.21.1' }, 'mod'))
  assert.notEqual(key, installedContentScope({ id: 'a', versionId: '1.21.1' }, 'shader'))
  for (let i = 0; i < 25; i++) cache.remember(String(i), { packs: [], updates: [], selected: '' })
  assert.equal(cache.peek(key), undefined, 'bounded cache evicts old profile snapshots')
  console.log('PASS installed content cache: synchronous stale view, request coalescing, mutation ordering, update retention and scoped bounded entries')
})().catch(error => { console.error(error); process.exitCode = 1 })
