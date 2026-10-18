const assert = require('node:assert/strict')
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), yazl = require('yazl'), { createHash } = require('node:crypto')

if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { windowsHide: true, env, stdio: 'inherit', timeout: 60000 })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const { app, nativeImage } = require('electron')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-client-icons-'))
app.setPath('userData', path.join(root, 'user-data'))
const yauzl = require('yauzl'); let opens = 0
const archiveReader = { ...yauzl, open: (...args) => { opens++; return yauzl.open(...args) } }
const modules = new Map()
function load(file) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file).exports
  const mod = { exports: {} }, source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText
  modules.set(file, mod)
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => {
    if (/\.(svg|png)$/.test(name)) return name
    if (name.endsWith('.css')) return {}
    if (name === 'yauzl') return archiveReader
    if (!name.startsWith('.')) return require(name)
    const target = path.resolve(path.dirname(file), name)
    return load(fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx')
  }, Buffer, console })
  return mod.exports
}
async function jar(file, entries) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const zip = new yazl.ZipFile()
  for (const [name, bytes] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), name)
  await new Promise((resolve, reject) => { const stream = fs.createWriteStream(file); stream.on('close', resolve); stream.on('error', reject); zip.outputStream.pipe(stream); zip.end() })
}
async function version(id, entries, fields = {}) {
  const directory = path.join(root, 'minecraft', 'versions', id)
  await fsp.mkdir(directory, { recursive: true })
  await fsp.writeFile(path.join(directory, id + '.json'), JSON.stringify({ id, greenLauncherCustom: true, ...fields }))
  await jar(path.join(directory, id + '.jar'), entries)
  return directory
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
app.whenReady().then(async () => {
  try {
    const { CustomClientIcons } = load('src/main/custom-client-icons.ts')
    const icons = new CustomClientIcons(path.join(root, 'minecraft'))
    const source = nativeImage.createFromPath(path.resolve('build/icon.png'))
    const image = size => source.resize({ width: size, height: size }).toPNG()
    const directory = await version('client', { 'assets/icons/icon_16x16.png': image(16), 'assets/icons/icon_32x32.png': image(32) })
    const jarPath = path.join(directory, 'client.jar'), before = hash(jarPath)
    const results = await Promise.all([icons.icon('client'), icons.icon('client'), icons.icon('client')])
    assert(results.every(result => result === results[0]))
    assert.deepEqual(nativeImage.createFromDataURL(results[0]).getSize(), { width: 32, height: 32 })
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
    const { ClientIconsProvider, ClientIcon } = load('src/renderer/src/ClientIcons.tsx')
    const { ProfileIcon } = load('src/renderer/src/ProfileIcon.tsx')
    const versions = [{ id: 'client', custom: true, icon: results[0] }, { id: 'missing', custom: true }]
    const render = (component, props) => renderToStaticMarkup(React.createElement(ClientIconsProvider, { versions }, React.createElement(component, props)))
    const profile = { versionId: 'client' }
    assert(render(ProfileIcon, { profile }).includes(results[0]), 'automatic profile icon uses the client artwork')
    assert(render(ClientIcon, { versionId: 'client' }).includes(results[0]), 'version catalog uses the same artwork')
    const chosen = nativeImage.createFromBuffer(image(64)).toDataURL()
    assert(render(ProfileIcon, { profile: { ...profile, icon: { enabled: true, type: 'custom', image: chosen } } }).includes(chosen), 'manual artwork has priority')
    assert(render(ProfileIcon, { profile: { ...profile, icon: { enabled: false, type: 'custom', image: chosen } } }).includes(results[0]), 'disabled customization restores the client artwork')
    assert(!render(ProfileIcon, { profile: { ...profile, icon: { enabled: true, type: 'forge' } } }).includes(results[0]), 'explicit loader artwork has priority')
    assert(render(ClientIcon, { versionId: 'missing' }).includes('cracked-stone-bricks.svg'), 'missing client artwork keeps the fallback')
    const cachedOpens = opens
    await icons.icon('client'); assert.equal(opens, cachedOpens, 'unchanged JAR is read from the cache')
    assert.equal(hash(jarPath), before, 'client JAR is never changed')
    await fsp.writeFile(path.join(directory, 'icon.png'), image(64))
    assert.deepEqual(nativeImage.createFromDataURL(await icons.icon('client')).getSize(), { width: 64, height: 64 }, 'folder artwork overrides archive artwork and invalidates the cache')
    await version('metadata', { 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id: 'metadata', name: 'Client', icon: 'assets/client/brand.png' }), 'assets/client/brand.png': image(512), 'assets/icons/icon_32x32.png': image(32) })
    assert.deepEqual(nativeImage.createFromDataURL(await icons.icon('metadata')).getSize(), { width: 128, height: 128 }, 'declared client icon is preferred and bounded to 128px')
    await version('fallback', { 'icon.png': Buffer.from('broken'), 'assets/icons/icon_32x32.png': image(32), 'assets/minecraft/textures/gui/icons.png': image(64) })
    assert.deepEqual(nativeImage.createFromDataURL(await icons.icon('fallback')).getSize(), { width: 32, height: 32 }, 'broken image falls back without choosing GUI texture sheets')
    await version('oversized', { 'icon.png': Buffer.alloc(2 * 1024 * 1024 + 1), 'logo.png': image(32) })
    assert(await icons.icon('oversized'), 'oversized icon is skipped')
    const broken = await version('broken', {}); await fsp.writeFile(path.join(broken, 'broken.jar'), 'not a JAR')
    assert.equal(await icons.icon('broken'), undefined)
    await version('missing', { 'assets/minecraft/textures/gui/icons.png': image(32) })
    assert.equal(await icons.icon('missing'), undefined)
    await version('vanilla', { 'icon.png': image(32) }, { greenLauncherCustom: false })
    assert.equal(await icons.icon('vanilla'), undefined)
    await version('traversal', {}, { icon: '../../outside.png' })
    assert.equal(await icons.icon('traversal'), undefined)
    for (const id of ['../client', '..', '.', '/client', 'C:\\client']) assert.equal(await icons.icon(id), undefined)
    const changed = path.join(directory, 'icon.png'); await fsp.writeFile(changed, image(96))
    assert.deepEqual(nativeImage.createFromDataURL(await icons.icon('client')).getSize(), { width: 96, height: 96 })
    console.log('PASS real image decoding, JAR/folder/metadata icon selection, resolution priority, 128px thumbnails, shared cache/invalidation, malformed/oversized/missing icon fallback, path validation and unchanged source JARs; isolated data')
  } finally {
    const resolved = path.resolve(root)
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('green-client-icons-')) await fsp.rm(root, { recursive: true, force: true })
  }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
