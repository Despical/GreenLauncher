const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-server-launch-'))
function load(file) {
  const mod = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const localRequire = name => name === 'electron' ? {app: {getPath: () => root}, screen: {getPrimaryDisplay: () => ({bounds:{width:1920,height:1080}})}} : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)
  vm.runInNewContext(source, {module:mod,exports:mod.exports,require:localRequire,structuredClone,Buffer,URL,console})
  return mod.exports
}
const {serverLaunchMode, normalizeServerAddress, serverLaunchOptions} = load('src/shared/server-launch.ts')
const json = value => JSON.parse(JSON.stringify(value))
for (const id of ['1.20','1.20.1','1.21.1','26.3','26.3-snapshot-2','1.20.4-fabric0.16','26.2-OptiFine_HD_U_K2','green-forge-1.20.1-47.2','23w14a','24w02a']) assert.equal(serverLaunchMode(id), 'quick-play', id)
for (const id of ['1.6.4','1.12.2','1.19.4','1.19.4-pre1','1.12.2-OptiFine_HD_U_G5','22w46a','23w13a']) assert.equal(serverLaunchMode(id), 'legacy', id)
for (const id of ['1.5.2','1.0','b1.7.3','a1.2.6','12w50a','unknown']) assert.equal(serverLaunchMode(id), null, id)
assert.deepEqual(json(serverLaunchOptions('1.12.2','play.example.org:25567')), {server:{ip:'play.example.org',port:25567}})
assert.deepEqual(json(serverLaunchOptions('1.19.4','localhost')), {server:{ip:'localhost'}})
assert.deepEqual(json(serverLaunchOptions('1.20','play.example.org:25567')), {quickPlayMultiplayer:'play.example.org:25567'})
assert.deepEqual(json(serverLaunchOptions('23w14a','[::1]:25565')), {quickPlayMultiplayer:'[::1]:25565'})
assert.deepEqual(json(serverLaunchOptions('1.12.2','[::1]:25565')), {server:{ip:'::1',port:25565}})
for (const address of ['', undefined]) assert.deepEqual(json(serverLaunchOptions('26.3',address)), {})
assert.deepEqual(json(serverLaunchOptions('b1.7.3','play.example.org')), {})
assert.equal(normalizeServerAddress('  play.example.org:25565 '), 'play.example.org:25565')
for (const address of ['https://example.org','host:0','host:65536','host:abc','host --server other','bad..host','[invalid]:25565',123,{},'x'.repeat(261)]) assert.throws(() => normalizeServerAddress(address), /sunucu/)
const {LauncherStore} = load('src/main/store.ts')
let store = new LauncherStore(); store.createOfflineAccount('ServerQA')
const input = {name:'Server profile',versionId:'1.21.1',javaPath:'',memoryMb:4096,width:1920,height:1080,serverAddress:' play.example.org:25567 '}
store.saveProfile(input)
const saved = store.get().profiles[0]
assert.equal(saved.serverAddress,'play.example.org:25567')
store = new LauncherStore()
assert.equal(store.get().profiles[0].serverAddress,'play.example.org:25567')
assert.throws(() => store.saveProfile({...saved,serverAddress:'host:0'}), /sunucu/)
assert.equal(store.get().profiles[0].serverAddress,'play.example.org:25567')
store.saveProfile({...saved,serverAddress:''})
assert.equal(store.get().profiles[0].serverAddress,undefined)
console.log('Server launch: legacy/Quick Play boundaries, loader IDs, IPv6, invalid addresses, persistence and clearing passed.')
