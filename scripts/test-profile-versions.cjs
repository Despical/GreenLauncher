const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-profile-versions-'))
const electron = { app: { getPath: () => root }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) } }
function load(file) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: n => n === 'electron' ? electron : n.startsWith('.') ? load(path.resolve(path.dirname(file), n + '.ts')) : require(n), structuredClone, Buffer, URL, process, setTimeout, clearTimeout })
  return mod.exports
}
;(async () => {
  const { LauncherStore } = load('src/main/store.ts'), { ProfileVersions } = load('src/main/profile-versions.ts'), store = new LauncherStore()
  store.createOfflineAccount('VersionQA')
  const create = name => store.saveProfile({ name, versionId: '1.21.1', javaPath: '', memoryMb: 4096, width: 1280, height: 720, jvmArgs: '-Dfixture=true', consoleEnabled: true }).selectedProfileId
  const target = create('Managed'), home = create('Home'), gameDir = store.profilePath(target)
  fs.mkdirSync(path.join(gameDir, 'saves', 'Fixture world'), { recursive: true }); fs.writeFileSync(path.join(gameDir, 'saves', 'Fixture world', 'level.dat'), 'world fixture')
  fs.mkdirSync(path.join(gameDir, 'mods')); fs.writeFileSync(path.join(gameDir, 'mods', 'fixture.jar'), 'mod fixture'); fs.writeFileSync(path.join(gameDir, 'servers.dat'), 'server fixture')
  const version = (id, custom = false) => ({ id, installed: false, custom, type: 'release', url: custom ? '' : 'https://piston-meta.mojang.com/fixture', releaseTime: '2026-10-03', optifineVersions: [], optifineAvailable: true })
  const catalog = [version('1.21.1'), version('1.20.4'), version('1.12.2'), version('custom-client', true), version('fabric-derived')], installed = new Set(['1.21.1']), calls = []
  let busy = false, mods = 1, fail = false, afterInstall = () => {}
  const runtime = { versions: async () => catalog, isInstalled: id => installed.has(id), profileVersion: id => id === 'fabric-derived' ? { versionId: '1.21.1', modLoader: 'fabric', modLoaderVersion: id } : { versionId: id }, install: async id => { calls.push(['minecraft', id]); if (fail) throw Error('Download failed'); installed.add(id); afterInstall() }, installOptifine: async base => { calls.push(['optifine', base]); if (fail) throw Error('Download failed'); installed.add(base + '-OptiFine_HD_U_TEST'); afterInstall(); return base + '-OptiFine_HD_U_TEST' }, installModLoader: async (base, loader, profile) => { calls.push(['loader', base, loader, profile.id]); if (fail) throw Error('Download failed'); const id = `${base}-${loader}-fixture`; installed.add(id); afterInstall(); return id } }
  const service = new ProfileVersions(store, runtime, () => busy, async id => { assert.equal(id, target); return mods })
  const before = structuredClone(store.get()), requested = await service.configure(target, '1.20.4')
  assert.equal(requested.status, 'confirmation-required'); assert.equal(requested.activeMods, 1); assert.equal(calls.length, 0); assert.deepEqual(store.get(), before)
  let result = await service.configure(target, '1.20.4', undefined, true); assert.equal(result.status, 'configured'); assert.equal(result.state.profiles.find(p => p.id === target).versionId, '1.20.4'); assert.equal(result.state.selectedProfileId, home); assert.equal(result.state.selectedVersionId, '1.21.1')
  assert.equal(store.get().profiles.find(p => p.id === target).jvmArgs, '-Dfixture=true'); assert.equal(store.get().profiles.find(p => p.id === target).memoryMb, 4096)
  result = await service.configure(target, '1.20.4', 'fabric'); assert.equal(result.status, 'confirmation-required'); result = await service.configure(target, '1.20.4', 'fabric', true); assert.equal(result.state.profiles.find(p => p.id === target).modLoader, 'fabric'); assert.deepEqual(calls.at(-1), ['loader', '1.20.4', 'fabric', target])
  result = await service.configure(target, '1.20.4', 'forge', true); assert.equal(result.state.profiles.find(p => p.id === target).modLoader, 'forge')
  result = await service.configure(target, '1.20.4', 'none', true); assert.equal(result.state.profiles.find(p => p.id === target).modLoader, undefined); assert.equal(result.state.profiles.find(p => p.id === target).modLoaderVersion, undefined)
  result = await service.configure(target, '1.20.4', 'optifine', true); assert.equal(result.state.profiles.find(p => p.id === target).versionId, '1.20.4-OptiFine_HD_U_TEST'); assert.deepEqual(calls.at(-1), ['optifine', '1.20.4'])
  result = await service.configure(target, '1.20.4', undefined); assert.equal(result.state.profiles.find(p => p.id === target).versionId, '1.20.4-OptiFine_HD_U_TEST', 'Minecraft installation keeps an unchanged loader')
  result = await service.configure(target, '1.12.2', undefined, true); assert.equal(result.state.profiles.find(p => p.id === target).modLoader, undefined, 'changing Minecraft clears the old loader selection')
  fail = true; const snapshot = structuredClone(store.get()); await assert.rejects(() => service.configure(target, '1.12.2', 'quilt', true), /Download failed/); assert.deepEqual(store.get(), snapshot); fail = false
  for (const file of ['mods/fixture.jar', 'servers.dat', 'saves/Fixture world/level.dat']) assert.equal(fs.readFileSync(path.join(gameDir, file), 'utf8'), file.startsWith('mods') ? 'mod fixture' : file.startsWith('saves') ? 'world fixture' : 'server fixture')
  await assert.rejects(() => service.configure(target, '../worlds', undefined, true), /Geçersiz/); await assert.rejects(() => service.configure(target, 'missing-version', undefined, true), /bulunamadı/); await assert.rejects(() => service.configure(target, 'fabric-derived', undefined, true), /bulunamadı/); await assert.rejects(() => service.configure(target, '1.12.2', 'unknown', true), /yükleyicisi/); await assert.rejects(() => service.configure(target, 'custom-client', 'fabric', true), /Özel/)
  catalog[2].optifineAvailable = false; await assert.rejects(() => service.configure(target, '1.12.2', 'optifine', true), /OptiFine/)
  busy = true; await assert.rejects(() => service.configure(target, '1.12.2', 'fabric', true), /oyunu/); busy = false
  afterInstall = () => store.setProfileVersion(target, { versionId: '1.21.1' }); await assert.rejects(() => service.configure(target, '1.12.2', 'neoforge', true), /ayarları değişti/); assert.equal(store.get().profiles.find(p => p.id === target).versionId, '1.21.1'); afterInstall = () => {}
  mods = 0; store.selectProfile(target); result = await service.configure(target, '1.20.4'); assert.equal(result.state.selectedVersionId, '1.20.4'); assert.equal(result.state.selectedProfileId, target)
  store.setModpack(target, { projectId: 'fixture', versionId: 'fixture', title: 'Fixture pack', fileCount: 1 }); await assert.rejects(() => service.configure(target, '1.21.1'), /paket tarafından/); assert.throws(() => store.setProfileVersion(target, { versionId: '1.21.1' }), /paket tarafından/)
  store.createOfflineAccount('OtherQA'); await assert.rejects(() => service.configure(target, '1.21.1'), /Profil/); assert.throws(() => store.setProfileVersion(home, { versionId: '1.20.4' }), /profil/i)
  console.log('PASS real owned profile version binding, Minecraft/loader/OptiFine/Vanilla routing, active-mod confirmation, home selection and data preservation, failed installs, busy/foreign/custom/modpack guards and asynchronous profile changes; isolated fixtures, no downloads')
})().catch(error => { console.error(error); process.exitCode = 1 })
