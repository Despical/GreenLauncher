// Downloads only Fabric's small loader libraries into an isolated temporary directory.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const { Version, MinecraftFolder } = require('@xmcl/core')
const { resolveLibraryInstallFiles } = require('@xmcl/installer')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-fabric-fix-'))
const requested = []
const trackedFetch = async (url, options) => { requested.push(String(url)); return fetch(url, options) }
const modules = new Map()
function load(file) {
  const mod = { exports: {} }
  const mocks = file.endsWith('game.ts') ? { electron: {}, './auth': {}, './store': {}, './download-manager': modules.get('downloads') } : {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: mod.exports, module: mod, require: name => mocks[name] ?? (name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), name + '.ts')) ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)), process, structuredClone, Buffer, URL, AbortController, AbortSignal, fetch: trackedFetch, console, setInterval, clearInterval, setTimeout, clearTimeout })
  return mod.exports
}
const downloads = load('src/main/download-manager.ts'); modules.set('downloads', downloads)
const { GameService } = load('src/main/game.ts')
const store = { dataPath: root, minecraftPath: path.join(root, 'minecraft'), get: () => ({ settings: { language: 'tr', javaPath: '', downloadSpeedLimitKiB: 0 } }) }
const manager = new downloads.DownloadManager(store.get().settings, () => {})
const game = new GameService(store, {}, () => null, () => {})
async function main() {
  const base = '26.1.2', directory = path.join(store.minecraftPath, 'versions', base)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, `${base}.json`), JSON.stringify({ id: base, type: 'release', time: '2026-01-01T00:00:00Z', releaseTime: '2026-01-01T00:00:00Z', mainClass: 'net.minecraft.client.main.Main', minecraftArguments: '', libraries: [] }))
  fs.writeFileSync(path.join(directory, `${base}.jar`), 'isolated base fixture')
  const profile = { id: '', name: 'Fabric regression', versionId: base, javaPath: '', memoryMb: 4096, width: 1280, height: 720, createdAt: new Date().toISOString() }
  const installed = await manager.enqueue('Live Fabric regression', () => game.installModLoader(base, 'fabric', profile))
  const version = await Version.parse(store.minecraftPath, installed), files = resolveLibraryInstallFiles(version.libraries, new MinecraftFolder(store.minecraftPath))
  assert.ok(files.length >= 3)
  for (const file of files) assert.ok(fs.existsSync(file.path), file.path)
  assert.ok(files.some(file => file.size === -1), 'Official loader metadata still contains unknown sizes')
  assert.ok(files.some(file => file.checksum), 'Official SHA-1 metadata is retained')
  const count = requested.length
  const release = installed.split('-fabric')[1]
  await manager.enqueue('Cached Fabric regression', () => game.installModLoader(base, 'fabric', profile, release))
  assert.equal(requested.length, count, 'A second installation reuses valid cached libraries')
  const first = files.find(file => file.checksum), second = files.find(file => file.path !== first.path && file.checksum)
  fs.writeFileSync(first.path, 'corrupt'); fs.unlinkSync(second.path)
  await manager.enqueue('Repair Fabric regression', () => game.installModLoader(base, 'fabric', profile, release))
  assert.equal(requested.length, count + 2, 'Only the corrupt and missing libraries are downloaded')
  const snapshot = manager.snapshot()
  assert.ok(snapshot.jobs.every(job => job.phase === 'completed' && job.totalBytes >= 0))
  console.log(JSON.stringify({ installed, libraries: files.length, passed: ['Official Fabric metadata installs all libraries with unknown sizes', 'Provided SHA-1 metadata is preserved', 'Valid files are reused without downloading', 'Only two damaged/missing files are fetched during repair'] }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { manager.dispose(); fs.rmSync(root, { recursive: true, force: true }) })
