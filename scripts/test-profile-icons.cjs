const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-profile-icons-'))
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOScAAAAASUVORK5CYII='
const file = path.join(root, 'icon.png'); fs.writeFileSync(file, Buffer.from(image.split(',')[1], 'base64'))
let canceled = false, empty = false, resized, selected = file
const electron = {
  app: { getPath: () => root }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) },
  dialog: { showOpenDialog: async () => ({ canceled, filePaths: [selected] }) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => empty, getSize: () => ({ width: 512, height: 256 }), resize: options => { resized = options; return { toDataURL: () => image } } }) }
}
function load(file) {
  const mod = { exports: {} }, output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(output, { exports: mod.exports, module: mod, require: n => n === 'electron' ? electron : n.startsWith('.') ? load(path.resolve(path.dirname(file), n + '.ts')) : require(n), structuredClone, Buffer, console })
  return mod.exports
}
async function main() {
  const { LauncherStore } = load('src/main/store.ts'), { profileLoader } = load('src/shared/profile-icons.ts'), { chooseProfileIcon } = load('src/main/profile-icons.ts')
  const store = new LauncherStore(); store.createOfflineAccount('IconQA')
  store.saveProfile({ name: 'Icon profile', versionId: '1.21.1', javaPath: '', memoryMb: 2048, width: 1280, height: 720 })
  const original = store.get().profiles[0]
  assert.equal(original.icon, undefined); assert.equal(profileLoader(original), 'none')
  assert.equal(profileLoader({ ...original, modLoader: 'fabric' }), 'fabric')
  assert.equal(profileLoader({ ...original, versionId: '1.21.1-OptiFine_HD_U_TEST' }), 'optifine')
  const custom = { enabled: true, type: 'custom', image }
  store.saveProfile({ ...original, icon: custom }); assert.deepEqual(new LauncherStore().get().profiles[0].icon, custom)
  store.saveProfile({ ...store.get().profiles[0], icon: { ...custom, enabled: false } })
  const disabled = store.get().profiles[0]; assert.equal(disabled.icon.image, image)
  store.saveProfile({ ...disabled, icon: undefined }); assert.equal(store.get().profiles[0].icon.enabled, false)
  const before = store.get()
  for (const icon of [null, { enabled: true, type: 'invalid' }, { enabled: true, type: 'custom' }, { enabled: true, type: 'custom', image: 'https://example.org/icon.png' }, { enabled: true, type: 'custom', image: image + 'A'.repeat(100001) }]) {
    assert.throws(() => store.saveProfile({ ...original, icon })); assert.deepEqual(store.get(), before)
  }
  assert.equal(await chooseProfileIcon({}, 'Icon', 'Images'), image)
  assert.equal(resized.width, 128); assert.equal(resized.height, 64); assert.equal(resized.quality, 'best')
  canceled = true; assert.equal(await chooseProfileIcon({}, 'Icon', 'Images'), null); canceled = false
  empty = true; await assert.rejects(chooseProfileIcon({}, 'Icon', 'Images'), /açılamadı/); empty = false
  selected = path.join(root, 'oversized.png'); fs.writeFileSync(selected, ''); fs.truncateSync(selected, 20000001)
  await assert.rejects(chooseProfileIcon({}, 'Icon', 'Images'), /çok büyük/)
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'launcher.json'), 'utf8')); saved.profiles[0].icon = { enabled: true, type: 'custom', image: 'invalid' }; fs.writeFileSync(path.join(root, 'launcher.json'), JSON.stringify(saved))
  assert.equal(new LauncherStore().get().profiles[0].icon, undefined)
  console.log('PASS profile icon defaults/loader detection, restart persistence, disabled image preservation, partial updates, invalid input without state changes, bounded image selection/cancel/decode/size checks and damaged-icon fallback; isolated data')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
