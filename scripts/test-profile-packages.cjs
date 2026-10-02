const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const { pipeline } = require('node:stream/promises')
const { ZipFile } = require('yazl')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-profile-test-'))
const modules = new Map(), results = []
function load(file) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file)
  const mod = { exports: {} }; modules.set(file, mod.exports)
  const localRequire = name => {
    if (name === 'electron') return { app: { getPath: key => key === 'userData' ? root : path.join(root, 'roaming') }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) } }
    if (name.endsWith('/game')) return { message: error => error.message }
    if (name.startsWith('.')) { const target = path.resolve(path.dirname(file), name + '.ts'); if (fs.existsSync(target)) return load(target) }
    return require(name)
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports: mod.exports, module: mod, require: localRequire, structuredClone, Buffer, URL, AbortController, AbortSignal, fetch, console, setInterval, clearInterval, setTimeout, clearTimeout }, { filename: file })
  return mod.exports
}
const { LauncherStore } = load('src/main/store.ts')
const { ProfilePackages } = load('src/main/profile-packages.ts')
const { ModpackService, walkArchive, streamEntry } = load('src/main/modpack.ts')
const store = new LauncherStore(), calls = []
let running = []
const game = { hasModLoaderInstallation: async () => true, getRunningInstances: () => running, install: async id => calls.push(['vanilla', id]), installModLoader: async (id, loader, _profile, release) => { calls.push(['loader', id, loader, release]); return `${id}-${loader}${release}` } }
const service = new ProfilePackages(store, game, () => {})
const write = (root, file, content) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content) }
async function readPackage(file) {
  const entries = new Map()
  await walkArchive(file, async (entry, zip) => { const chunks = []; for await (const chunk of await streamEntry(zip, entry)) chunks.push(Buffer.from(chunk)); entries.set(entry.fileName, Buffer.concat(chunks)) })
  return entries
}
async function writePackage(file, entries) {
  const zip = new ZipFile(); zip.on('error', error => zip.outputStream.destroy(error))
  const writing = pipeline(zip.outputStream, fs.createWriteStream(file))
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name)
  zip.end(); await writing
}
async function main() {
  store.createOfflineAccount('PackageQA')
  store.saveProfile({ name: 'Dünyam', versionId: '1.21.1', javaPath: '', memoryMb: 6144, minMemoryMb: 1536, width: 1600, height: 900, fullscreen: true, serverAddress: 'play.example.org:25567' })
  const source = store.get().profiles[0], directory = store.gamePath(source)
  store.setModLoader(source.id, '1.21.1', 'fabric', '1.21.1-fabric0.16.10')
  store.setProfileCover(source.id, { color: '#9172a8', description: 'Arkadaşlarla macera' })
  write(directory, 'saves/Adventure/level.dat', Buffer.alloc(512, 33))
  write(directory, 'mods/example.jar', 'jar fixture'); write(directory, 'options.txt', 'renderDistance:12')
  write(directory, 'logs/latest.log', 'private log'); write(directory, 'launcher_accounts.json', 'do not share')
  write(directory, 'saves/Adventure/session.lock', 'lock'); write(directory, 'cache/unused.bin', 'cache')
  const cloned = await service.clone(source.id)
  const clone = cloned.state.profiles.find(item => item.id === cloned.profileId)
  assert.equal(clone.serverAddress, source.serverAddress); assert.notEqual(clone.id, source.id); assert.equal(clone.minMemoryMb, 1536); assert.equal(clone.modLoaderVersion, '1.21.1-fabric0.16.10')
  assert.equal(clone.cover.description, 'Arkadaşlarla macera'); assert.equal(clone.gameDirectory, '')
  assert.ok(fs.readFileSync(path.join(store.profilePath(clone.id), 'saves/Adventure/level.dat')).equals(Buffer.alloc(512, 33)))
  write(store.profilePath(clone.id), 'options.txt', 'changed')
  assert.equal(fs.readFileSync(path.join(directory, 'options.txt'), 'utf8'), 'renderDistance:12')
  results.push('Cloning preserves settings, loader, covers and worlds in an independent owned directory')
  const archive = path.join(root, 'friend.glprofile')
  await service.export(source.id, archive)
  const entries = await readPackage(archive), manifest = JSON.parse(entries.get('green-profile.json').toString())
  assert.equal(manifest.profile.serverAddress, source.serverAddress); assert.equal(manifest.format, 'green-launcher-profile')
  assert.ok(!JSON.stringify(manifest).includes(source.accountId)); assert.ok(!('javaPath' in manifest.profile)); assert.ok(!('gameDirectory' in manifest.profile))
  for (const excluded of ['files/logs/latest.log', 'files/launcher_accounts.json', 'files/cache/unused.bin', 'files/saves/Adventure/session.lock']) assert.ok(!entries.has(excluded), excluded)
  assert.equal(manifest.files.length, 3)
  results.push('Portable exports have checksummed files and exclude account identifiers, locks, logs and caches')
  store.createOfflineAccount('FriendQA')
  const imported = await service.import(archive), importedProfile = imported.state.profiles[0]
  assert.equal(importedProfile.accountId, store.get().selectedAccountId); assert.notEqual(importedProfile.accountId, source.accountId)
  assert.equal(importedProfile.serverAddress, source.serverAddress); assert.equal(importedProfile.name, 'Dünyam'); assert.equal(importedProfile.javaPath, '')
  assert.equal(importedProfile.modLoaderVersion, '1.21.1-fabric0.16.10'); assert.equal(importedProfile.cover.color, '#9172a8')
  assert.ok(fs.readFileSync(path.join(store.profilePath(imported.profileId), 'mods/example.jar')).equals(Buffer.from('jar fixture')))
  const importedAgain = await service.import(archive)
  assert.equal(importedAgain.state.profiles.find(item => item.id === importedAgain.profileId).name, 'Dünyam (2)')
  results.push('Imports install the pinned loader, assign the receiving account and avoid name collisions')
  const before = store.get(), failures = [
    ['bad-hash', entries => entries.set('files/mods/example.jar', Buffer.from('bad fixture'))],
    ['missing-file', entries => entries.delete('files/mods/example.jar')],
    ['unexpected-file', entries => entries.set('unlisted.txt', Buffer.from('bad'))],
    ['case-collision', entries => { const manifest = JSON.parse(entries.get('green-profile.json')); manifest.files.push({ ...manifest.files[0], path: manifest.files[0].path.toUpperCase() }); entries.set('green-profile.json', Buffer.from(JSON.stringify(manifest))) }],
    ['traversal', entries => { const manifest = JSON.parse(entries.get('green-profile.json')); manifest.files[0].path = '../outside.txt'; entries.set('green-profile.json', Buffer.from(JSON.stringify(manifest))) }],
    ['bad-server', entries => { const manifest = JSON.parse(entries.get('green-profile.json')); manifest.profile.serverAddress = 'https://example.org'; entries.set('green-profile.json', Buffer.from(JSON.stringify(manifest))) }],
    ['bad-cover', entries => { const manifest = JSON.parse(entries.get('green-profile.json')); manifest.profile.cover.image = 'file:///private'; entries.set('green-profile.json', Buffer.from(JSON.stringify(manifest))) }]
  ]
  for (const [name, change] of failures) {
    const changed = new Map(entries); change(changed)
    const malformed = path.join(root, `${name}.glprofile`); await writePackage(malformed, changed)
    await assert.rejects(service.import(malformed))
    assert.equal(store.get().profiles.length, before.profiles.length); assert.equal(store.get().selectedProfileId, before.selectedProfileId)
    results.push(`${name}: rejected without publishing a partial profile`)
  }
  running = [{ profileId: imported.profileId }]
  await assert.rejects(service.clone(imported.profileId), /oyununu kapat/)
  await assert.rejects(service.export(imported.profileId, path.join(root, 'busy.glprofile')), /oyununu kapat/)
  running = []
  const priorCalls = calls.length; await service.repair(imported.profileId)
  assert.deepEqual(calls.slice(priorCalls), [['vanilla', '1.21.1'], ['loader', '1.21.1', 'fabric', '0.16.10']])
  results.push('Running profiles are protected; repair retains the exact loader release')
  // A custom game directory is copied into a new owned directory; bookkeeping remains included.
  const custom = path.join(root, 'external-game'); write(custom, 'config/settings.toml', 'enabled=true')
  store.saveProfile({ ...store.get().profiles[0], gameDirectory: custom })
  const customProfile = store.get().profiles.find(item => item.id === imported.profileId)
  write(store.profilePath(customProfile.id), 'green-launcher-mods.json', '[]')
  const customClone = await service.clone(customProfile.id)
  assert.ok(fs.existsSync(path.join(store.profilePath(customClone.profileId), 'green-launcher-mods.json')))
  assert.equal(fs.readFileSync(path.join(store.profilePath(customClone.profileId), 'config/settings.toml'), 'utf8'), 'enabled=true')
  results.push('Custom game directories clone independently with launcher bookkeeping')
  store.saveProfile({ ...customProfile, gameDirectory: root })
  await assert.rejects(service.clone(customProfile.id), /launcher verilerini/)
  await assert.rejects(service.export(customProfile.id, path.join(root,'unsafe.glprofile')), /launcher verilerini/)
  store.saveProfile({ ...customProfile, gameDirectory: path.join(root,'profiles') })
  await assert.rejects(service.clone(customProfile.id), /launcher verilerini/)
  store.saveProfile({ ...customProfile, gameDirectory: custom })
  results.push('Misconfigured launcher-data and shared profile-parent directories cannot enter an exported package')
  const outsider = path.join(root, 'outsider'); fs.mkdirSync(outsider)
  try {
    fs.symlinkSync(outsider, path.join(custom, 'unsafe-link'), 'junction')
    await assert.rejects(service.clone(customProfile.id), /bağlantı/)
    results.push('Filesystem links are rejected during cloning/export')
  } catch (error) { if (error.code !== 'EPERM') throw error }
  const localPack = path.join(root, 'local.mrpack')
  await writePackage(localPack, new Map([
    ['modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'Local Adventure', versionId: '1', files: [], dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.10' } }))],
    ['overrides/config/local.toml', Buffer.from('local=true')]
  ]))
  const modpacks = new ModpackService(store, game)
  const localResult = await modpacks.importArchive(localPack)
  assert.equal(localResult.state.profiles.find(item => item.id === localResult.profileId).name, 'Local Adventure')
  assert.equal(fs.readFileSync(path.join(store.profilePath(localResult.profileId), 'config/local.toml'), 'utf8'), 'local=true')
  assert.equal(JSON.parse(fs.readFileSync(path.join(store.profilePath(localResult.profileId), 'green-launcher-pack.json'))).projectId, 'local')
  results.push('Local Modrinth .mrpack import reads its own Minecraft/loader metadata and extracts overrides')
  console.log(JSON.stringify({ passed: results.length, checks: results }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(root, { recursive: true, force: true }))
