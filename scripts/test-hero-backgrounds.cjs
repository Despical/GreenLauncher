const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
if (!process.argv.includes('--hero-service-qa')) {
  const { spawnSync } = require('node:child_process')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'green-hero-test-'))
  try {
    const result = spawnSync(require('electron'), [__filename, '--hero-service-qa', `--qa-root=${directory}`], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
    process.exitCode = result.status ?? 1
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
} else {
const { app, nativeImage } = require('electron')
const root = process.argv.find(value => value.startsWith('--qa-root=')).slice('--qa-root='.length)
assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
assert.match(path.basename(root), /^green-hero-test-[a-zA-Z0-9]+$/)
app.setPath('userData', path.join(root, 'chromium')); app.disableHardwareAcceleration()
const modules = new Map()
function load(file) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file)
  const mod = { exports: {} }; modules.set(file, mod.exports)
  const localRequire = name => {
    if (name === 'electron') return { nativeImage, app: { getPath: key => key === 'userData' ? path.join(root, 'data') : path.join(root, key) }, screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1040 } }) } }
    if (name.startsWith('.')) { const target = path.resolve(path.dirname(file), name + '.ts'); if (fs.existsSync(target)) return load(target) }
    return require(name)
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports: mod.exports, module: mod, require: localRequire, structuredClone, Buffer, URL, console, setTimeout, clearTimeout }, { filename: file })
  return mod.exports
}
app.whenReady().then(async () => {
    const { HeroBackgrounds } = load('src/main/hero-backgrounds.ts')
    const { LauncherStore } = load('src/main/store.ts')
    const { normalizeHeroSettings } = load('src/shared/hero-backgrounds.ts')
    const service = new HeroBackgrounds(path.join(root, 'data')), store = new LauncherStore()
    const file = path.join(root, 'My Landscape.png'), second = path.join(root, 'Second.jpg')
    fs.copyFileSync('src/renderer/assets/green-landscape.png', file)
    fs.writeFileSync(second, nativeImage.createFromPath(file).toJPEG(90))
    const added = await service.add([file, second])
    assert.equal(added.length, 2); assert.notEqual(added[0].id, added[1].id)
    assert.equal(added[0].name, 'My Landscape')
    fs.unlinkSync(file)
    const full = await service.read(added[0].id), thumbnail = await service.read(added[0].id, true)
    assert.ok(full.startsWith('data:image/jpeg;base64,'))
    assert.ok(nativeImage.createFromDataURL(thumbnail).getSize().width <= 280)
    store.updateSettings({ heroBackgrounds: added, disabledHeroBackgrounds: ['overworld','nether','end'], animateHero: false })
    const restored = new LauncherStore().get().settings
    assert.equal(restored.animateHero, false); assert.equal(restored.heroBackgrounds.length, 2)
    const legacy = normalizeHeroSettings({ ...restored, heroPanorama: true, heroBackgrounds: added.map(item => ({ ...item, panorama: true })) })
    assert.equal(JSON.stringify(legacy.heroBackgrounds), JSON.stringify(restored.heroBackgrounds))
    assert.equal('heroPanorama' in legacy, false)
    assert.equal(restored.disabledHeroBackgrounds.length, 3)
    const fallback = normalizeHeroSettings({ ...restored, heroBackgrounds: added.map(item => ({ ...item, enabled: false })) })
    assert.equal(fallback.disabledHeroBackgrounds.includes('overworld'), false)
    const malformed = normalizeHeroSettings({ heroBackgrounds: [{ id: '../account', name: 'bad' }, added[0], added[0]], disabledHeroBackgrounds: ['unknown'] })
    assert.equal(malformed.heroBackgrounds.length, 1); assert.equal(malformed.disabledHeroBackgrounds.length, 0)
    await assert.rejects(service.read('../launcher.json'))
    const invalid = path.join(root, 'invalid.png'); fs.writeFileSync(invalid, 'not an image')
    const before = fs.readdirSync(path.join(root, 'data', 'backgrounds'))
    await assert.rejects(service.add([second, invalid]))
    assert.deepEqual(fs.readdirSync(path.join(root, 'data', 'backgrounds')), before)
    await service.remove(added[0].id); assert.equal(await service.read(added[0].id), null)
    assert.equal(fs.existsSync(second), true); assert.ok(await service.read(added[1].id))
    console.log('PASS multi-image import, thumbnails, original-file independence, persistent selection/motion, empty-list recovery, ID validation, atomic invalid-batch rejection and owned-file removal')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
}
