const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { createServer } = require('node:http')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-october-'))
const electron = { app: { getPath: () => root }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 2560, height: 1440 } }) } }
function load(file) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, require: name => name === 'electron' ? electron : (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), name + '.ts')) ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)), structuredClone, Buffer, URL, AbortController, AbortSignal, fetch, console, setTimeout, clearTimeout, setInterval, clearInterval })
  return module.exports
}
async function main() {
  const { LauncherStore } = load('src/main/store.ts')
  const { profileVersionLabel } = load('src/shared/profile-version.ts')
  let store = new LauncherStore()
  store.createOfflineAccount('OctoberQA')
  assert.equal(store.get().settings.width, 1280)
  assert.equal(store.updateSettings({ width: 640, height: 480 }).settings.height, 720)
  const profile = { name: 'Locked pack', versionId: '1.20.4', javaPath: '', memoryMb: 4096, width: 2560, height: 1440 }
  const id = store.saveProfile(profile).selectedProfileId
  store.setModLoader(id, '1.20.4', 'fabric', '1.20.4-fabric-0.16.0')
  store.setModpack(id, { projectId: 'fixture', versionId: 'v1', title: 'Pack', fileCount: 1 })
  assert.equal(store.get().selectedVersionId, '1.20.4-fabric-0.16.0')
  assert.throws(() => store.selectVersion('1.21.1'))
  assert.throws(() => store.saveProfile({ ...profile, id, versionId: '1.21.1' }))
  assert.throws(() => store.setModLoader(id, '1.20.4', 'forge', '1.20.4-forge'))
  store.saveProfile({ ...profile, id, memoryMb: 8192 })
  assert.ok(store.get().profiles[0].modpack)
  store = new LauncherStore()
  assert.equal(store.get().selectedVersionId, '1.20.4-fabric-0.16.0')
  assert.equal(profileVersionLabel(store.get().profiles[0]), 'Minecraft 1.20.4 · Fabric')
  assert.equal(profileVersionLabel({ ...profile, versionId: '1.12.2-OptiFine_HD_U_G5' }), 'Minecraft 1.12.2 · OptiFine')
  const other = store.saveProfile({ ...profile, name: 'Free profile' }).selectedProfileId
  assert.throws(() => store.selectVersion('1.21.1'))
  store.saveProfile({ ...profile, id: other, versionId: '1.21.1', modLoader: 'forge', modLoaderVersion: '1.21.1-forge-test' })
  assert.equal(store.get().selectedVersionId, '1.21.1-forge-test')
  store.saveProfile({ ...profile, id: other, versionId: '1.20.4' })
  assert.equal(store.get().profiles.find(p => p.id === other).modLoaderVersion, undefined)
  assert.equal(store.get().selectedVersionId, '1.20.4')
  assert.throws(() => store.saveProfile({ ...profile, id, modLoaderVersion: '1.20.4-forge-test' }))
  store.selectProfile(id)
  assert.equal(store.get().selectedVersionId, '1.20.4-fabric-0.16.0')
  store.selectProfile(other); assert.throws(() => store.selectVersion('1.21.1'))
  console.log('PASS windowed defaults, pack version/loader locks, restart, profile switching and runtime labels')

  const { DownloadManager } = load('src/main/download-manager.ts')
  const history = path.join(root, 'download-history.json')
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Length': 32 }); res.end(Buffer.alloc(32)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const settings = { language: 'tr' }
  let manager = new DownloadManager(settings, () => {}, history)
  try {
    const download = (name, target = name) => manager.enqueue(name, () => manager.download({ urls: [`http://127.0.0.1:${server.address().port}/file`], destination: path.join(root, target) }))
    for (let i = 0; i < 7; i++) await download(`Download ${i}`)
    await manager.enqueue('Open game', async () => {})
    await manager.enqueue('Repair files', async () => {})
    await download('Cached file', 'Download 6')
    await assert.rejects(manager.enqueue('No network failure', async () => { throw Error('fixture') }))
    const jobs = manager.snapshot().jobs
    assert.equal(jobs.length, 5)
    assert.equal(jobs[0].title, 'Download 6')
    assert.equal(jobs[4].title, 'Download 2')
    assert.ok(jobs.every(job => job.finishedAt && job.downloadedBytes === 32))
    manager.dispose(); manager = new DownloadManager(settings, () => {}, history)
    assert.deepEqual(manager.snapshot().jobs.map(job => job.title), jobs.map(job => job.title))
    manager.control('clear'); manager.dispose(); manager = new DownloadManager(settings, () => {}, history)
    assert.equal(manager.snapshot().jobs.length, 0)
    fs.writeFileSync(history, 'damaged json'); manager.dispose(); manager = new DownloadManager(settings, () => {}, history)
    assert.equal(manager.snapshot().jobs.length, 0)
    console.log('PASS last five real downloads persist; game/repair/cache-only tasks excluded; clear and damaged-history recovery')
  } finally { manager.dispose(); server.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
