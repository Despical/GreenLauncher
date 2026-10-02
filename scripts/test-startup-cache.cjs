const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const { createHash } = require('node:crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-cache-test-'))
let checks = 0
let now = Date.now()
class Clock extends Date { static now() { return now } }
function load(file, mocks = {}, extras = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(output, { exports: mod.exports, module: mod, require: name => name in mocks ? mocks[name] : name === './download-manager' ? { getDownloadManager: () => undefined } : (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), name + '.ts')) ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)), structuredClone, Buffer, URL, AbortSignal, console, Date: Clock, ...extras })
  return mod.exports
}
function check(name, fn) { fn(); checks++; console.log('PASS', name) }
function texture(marker = 1, size = 25) {
  const png = Buffer.alloc(size)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png)
  png.writeUInt32BE(64, 16); png.writeUInt32BE(64, 20); png[24] = marker
  return png
}
const account = { id: 'a'.repeat(32), name: 'PlayerOne', kind: 'microsoft', homeAccountId: 'a'.repeat(32), skinUrl: 'https://textures.minecraft.net/texture/abc' }
const key = a => createHash('sha256').update(`${a.kind ?? 'microsoft'}:${a.id}:${a.name.toLowerCase()}:${a.skinUrl ?? ''}`).digest('hex')
const response = bytes => ({ ok: true, arrayBuffer: async () => bytes })
async function finishRefresh(service) { await Promise.all([...service.refreshing.values()]) }

;(async () => {
  let calls = 0, mode = 'ok', release
  const events = []
  const mockedFetch = async (_url, options) => {
    calls++
    assert.equal(options.redirect, 'error')
    if (mode === 'gate') return new Promise(resolve => { release = () => resolve(response(texture(2))) })
    if (mode === 'fail') throw Error('offline')
    if (mode === 'bad') return response(Buffer.from('bad image'))
    if (mode === 'large') return { ok: true, headers: { get: () => '2000001' }, arrayBuffer: () => { throw Error('Oversized payload was read') } }
    return response(texture())
  }
  const { AccountSkins } = load('src/main/account-skins.ts', {}, { fetch: mockedFetch })
  const directory = path.join(root, 'skins')
  const service = new AccountSkins(directory)
  const values = await Promise.all([service.get(account), service.get(account), service.get(account)])
  check('simultaneous cold skin requests share a single download', () => { assert.equal(calls, 1); assert.equal(values[0], values[2]) })
  await new AccountSkins(directory).get(account)
  check('fresh persistent skin needs no network after restart', () => assert.equal(calls, 1))
  const file = path.join(directory, key(account) + '.png')
  fs.utimesSync(file, new Date(0), new Date(0))
  mode = 'gate'
  const stale = new AccountSkins(directory, (who, skin) => events.push({ who, skin }))
  const immediate = await stale.get(account)
  check('stale skin returns while network request is still unresolved', () => { assert.equal(immediate, values[0]); assert.equal(calls, 2); assert.equal(events.length, 0); assert.ok(release) })
  assert.equal(await stale.get(account), immediate)
  check('stale callers do not duplicate background refreshes', () => assert.equal(calls, 2))
  release()
  await finishRefresh(stale)
  check('background skin change is persisted and published once', () => { assert.equal(events.length, 1); assert.notEqual(events[0].skin, immediate); assert.equal(fs.readFileSync(file)[24], 2) })
  const fresh = await stale.get(account)
  now += 61 * 60_000
  mode = 'fail'
  assert.equal(await stale.get(account), fresh)
  await finishRefresh(stale)
  const failedCalls = calls
  assert.equal(await stale.get(account), fresh)
  check('offline refresh retains the skin and backs off repeated failures', () => assert.equal(calls, failedCalls))
  now += 61_000
  assert.equal(await stale.get(account), fresh)
  await finishRefresh(stale)
  check('retry becomes eligible after the cooldown', () => assert.equal(calls, failedCalls + 1))
  mode = 'ok'
  await service.get({ ...account, skinUrl: account.skinUrl + 'd' })
  check('a changed account texture URL invalidates the old cache key', () => assert.equal(calls, failedCalls + 2))

  const missing = { ...account, id: 'b'.repeat(32), skinUrl: undefined }
  const beforeMissing = calls
  assert.equal(await service.get(missing), null)
  assert.equal(await service.get(missing), null)
  check('missing textures are negatively cached without a request', () => assert.equal(calls, beforeMissing))
  const unsafe = { ...account, id: 'c'.repeat(32), skinUrl: 'https://example.org/texture/abc' }
  assert.equal(await service.get(unsafe), null)
  check('untrusted texture hosts are rejected before fetching', () => assert.equal(calls, beforeMissing))
  mode = 'bad'
  assert.equal(await service.get({ ...account, id: 'd'.repeat(32) }), null)
  check('invalid texture bytes never enter the persistent cache', () => assert.equal(fs.existsSync(path.join(directory, key({ ...account, id: 'd'.repeat(32) }) + '.png')), false))
  mode = 'large'
  assert.equal(await service.get({ ...account, id: 'e'.repeat(32) }), null)
  check('oversized declared textures are rejected before their body is read', () => assert.equal(service.results.get(key({ ...account, id: 'e'.repeat(32) })).value, null))

  mode = 'ok'
  const bounded = path.join(root, 'bounded')
  fs.mkdirSync(bounded)
  for (let i = 0; i < 130; i++) fs.writeFileSync(path.join(bounded, i.toString(16).padStart(64, '0') + '.png'), texture())
  fs.writeFileSync(path.join(bounded, 'keep-unrelated.txt'), 'preserve me')
  const capped = new AccountSkins(bounded)
  await capped.get(account)
  check('persistent cache is bounded and leaves unrelated files intact', () => { assert.ok(fs.readdirSync(bounded).filter(name => name.endsWith('.png')).length <= 128); assert.equal(fs.readFileSync(path.join(bounded, 'keep-unrelated.txt'), 'utf8'), 'preserve me') })
  for (let i = 0; i < 140; i++) await capped.get({ ...missing, id: i.toString(16).padStart(32, '0') })
  check('in-memory entries have a fixed upper bound', () => assert.equal(capped.results.size, 128))

  const bytesDirectory = path.join(root, 'byte-cap')
  fs.mkdirSync(bytesDirectory)
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(bytesDirectory, i.toString(16).padStart(64, '0') + '.png'), texture(1, 2_000_000))
  await new AccountSkins(bytesDirectory).get(account)
  check('persistent skin byte budget is enforced', () => assert.ok(fs.readdirSync(bytesDirectory).reduce((sum, name) => sum + fs.statSync(path.join(bytesDirectory, name)).size, 0) <= 16 * 1024 * 1024))

  now = Date.now()
  let manifests = 0, optifine = 0, catalogMode = 'ok', openManifest
  const version = { id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00Z', url: 'https://piston-meta.mojang.com/version.json' }
  const { GameService } = load('src/main/game.ts', {
    electron: { app: { getPath: () => root } },
    '@xmcl/installer': { getVersionList: async () => { manifests++; if (catalogMode === 'fail') throw Error('offline'); if (catalogMode === 'gate') await new Promise(resolve => { openManifest = resolve }); return { versions: [version] } } }
  }, { fetch: async () => { optifine++; if (catalogMode === 'fail') throw Error('offline'); return { ok: true, text: async () => '<h2>Minecraft 1.21.1</h2><td class="colMirror"><a href="adloadx?f=OptiFine.jar">Mirror</a>' } } })
  const catalogRoot = path.join(root, 'catalog')
  fs.mkdirSync(catalogRoot)
  const store = { dataPath: catalogRoot, minecraftPath: path.join(catalogRoot, 'minecraft') }
  const game = () => new GameService(store, {}, () => null, () => {})
  const firstGame = game()
  await firstGame.versions('if-stale')
  check('cold catalogs refresh both sources', () => { assert.equal(manifests, 1); assert.equal(optifine, 1) })
  const restarted = game()
  const cachedVersions = await restarted.versions('if-stale')
  check('catalog TTL survives restart including OptiFine availability', () => { assert.equal(manifests, 1); assert.equal(optifine, 1); assert.equal(cachedVersions[0].optifineAvailable, true) })
  await restarted.versions(true)
  check('explicit manual catalog refresh bypasses freshness', () => { assert.equal(manifests, 2); assert.equal(optifine, 2) })
  now += 16 * 60_000
  catalogMode = 'gate'
  const refreshA = restarted.versions('if-stale')
  const refreshB = restarted.versions('if-stale')
  let secondResolved = false
  void refreshB.then(() => { secondResolved = true })
  await Promise.resolve()
  check('concurrent stale catalog requests wait on the same refresh', () => { assert.equal(manifests, 3); assert.equal(optifine, 3); assert.equal(secondResolved, false) })
  openManifest()
  await Promise.all([refreshA, refreshB])
  now += 16 * 60_000
  catalogMode = 'fail'
  const offline = await restarted.versions('if-stale')
  await restarted.versions('if-stale')
  check('failed catalog refresh preserves cached lists with retry cooldown', () => { assert.equal(manifests, 4); assert.equal(optifine, 4); assert.equal(offline[0].id, version.id); assert.equal(offline[0].optifineAvailable, true) })
  await restarted.versions(true)
  check('manual refresh still retries inside a failed automatic cooldown', () => assert.equal(manifests, 5))

  let decodes = 0
  class FakeImage {
    width = 64; height = 64
    set src(value) { decodes++; Promise.resolve().then(() => value === 'invalid' ? this.onerror() : this.onload()) }
  }
  const { skinHead } = load('src/renderer/src/skin-head.ts', {}, {
    Image: FakeImage,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;head' }) }
  })
  const [headA, headB] = await Promise.all([skinHead('same'), skinHead('same')])
  check('avatar head cropping shares one decode for matching skin data', () => { assert.equal(decodes, 1); assert.equal(headA, headB) })
  await skinHead('invalid').catch(() => {})
  await skinHead('invalid').catch(() => {})
  check('failed head decoding does not poison future retries', () => assert.equal(decodes, 3))
  for (let i = 0; i < 130; i++) await skinHead('texture-' + i)
  const decodedBefore = decodes
  await skinHead('same')
  check('avatar head cache evicts old entries', () => assert.equal(decodes, decodedBefore + 1))

  let rpcImports = 0, presences = 0, disconnects = 0
  class RpcClient {
    isConnected = false
    user = { setActivity: async () => { presences++ }, clearActivity: async () => {} }
    on() {}
    async login() { this.isConnected = true }
    async destroy() { this.isConnected = false; disconnects++ }
  }
  const rpcMocks = { get '@xhayper/discord-rpc'() { rpcImports++; return { Client: RpcClient } } }
  const { DiscordPresence } = load('src/main/discord.ts', rpcMocks, { setInterval: () => ({ unref() {} }), clearInterval: () => {} })
  const presence = new DiscordPresence('test', true)
  async function settlePresence() {
    for (let i = 0; i < 40 && presence.syncing; i++) await Promise.resolve()
    assert.equal(presence.syncing, false)
  }
  presence.setEnabled(true)
  await settlePresence()
  check('Enabled Discord publishes launcher presence at startup', () => { assert.equal(rpcImports, 1); assert.equal(presences, 1) })
  presence.setPlaying('1.21.1')
  await settlePresence()
  check('Discord reuses the client and publishes game presence', () => { assert.equal(rpcImports, 1); assert.equal(presences, 2) })
  presence.shutdown()
  await settlePresence()
  check('lazy Discord client still disconnects on shutdown', () => assert.equal(disconnects, 1))
  console.log(`${checks} startup/cache checks passed. Test data: ${root}`)
})().catch(error => { console.error(error); process.exitCode = 1 })
