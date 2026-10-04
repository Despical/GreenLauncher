const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const { ZipFile } = require('yazl'), { once } = require('node:events')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-mod-metadata-'))
function load(name, globals = {}, mocks = {}) {
  const mod = { exports: {} }, file = path.resolve('src/main', name + '.ts')
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module: mod, exports: mod.exports, require: n => mocks[n] ?? (n.startsWith('.') ? load(n.slice(2), globals, mocks) : require(n)), Buffer, URL, URLSearchParams, structuredClone, setTimeout, clearTimeout, AbortSignal, process: { env: {} }, fetch: () => { throw Error('Unexpected network') }, ...globals })
  return mod.exports
}
async function archive(file, entries) {
  const zip = new ZipFile(), chunks = []; zip.outputStream.on('data', chunk => chunks.push(chunk))
  for (const [name, bytes] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), name)
  zip.end(); await once(zip.outputStream, 'end'); fs.writeFileSync(file, Buffer.concat(chunks))
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZFYAAAAASUVORK5CYII=', 'base64')
;(async () => {
  const { inspectMod, modFileHash } = load('mod-metadata')
  const mod = path.join(root, 'fabric.jar')
  await archive(mod, { 'fabric.mod.json': JSON.stringify({ name: 'Animatica', version: '0.6.2+26.3', description: 'Animated textures', icon: { 16: 'small.png', 64: 'icon.png' } }), 'icon.png': png })
  const info = await inspectMod(mod); assert.equal(info.title, 'Animatica'); assert.equal(info.versionNumber, '0.6.2+26.3'); assert.equal(info.description, 'Animated textures'); assert.equal(info.icon, 'data:image/png;base64,' + png.toString('base64'))
  const quilt = path.join(root, 'quilt.jar'); await archive(quilt, { 'quilt.mod.json': JSON.stringify({ quilt_loader: { version: '2.4', metadata: { name: 'Quilt fixture', description: 'Quilt description', icon: 'logo.png' } } }), 'logo.png': png }); assert.equal((await inspectMod(quilt)).versionNumber, '2.4'); assert.ok((await inspectMod(quilt)).icon)
  for (const name of ['mods.toml', 'neoforge.mods.toml']) {
    const forge = path.join(root, name + '.jar'); await archive(forge, { ['META-INF/' + name]: 'modLoader="javafml"\nlogoFile="logo.png"\n[[mods]]\nmodId="fixture"\ndisplayName="Forge fixture"\nversion="${file.jarVersion}"\ndescription=\'\'\'Line one\nLine two\'\'\'\n[[dependencies.fixture]]\nmodId="minecraft"\nversionRange="[1.21,)"', 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\r\nImplementation-Version: 3.2.\r\n 1\r\n', 'logo.png': png })
    const info = await inspectMod(forge); assert.equal(info.title, 'Forge fixture'); assert.equal(info.versionNumber, '3.2.1'); assert.equal(info.description, 'Line one\nLine two'); assert.ok(info.icon)
  }
  const legacy = path.join(root, 'legacy.jar'); await archive(legacy, { 'mcmod.info': JSON.stringify([{ name: 'Legacy fixture', version: '1.2', logoFile: 'logo.png' }]), 'logo.png': png }); assert.equal((await inspectMod(legacy)).versionNumber, '1.2')
  const bad = path.join(root, 'bad.jar'); fs.writeFileSync(bad, 'not a ZIP'); assert.equal(Object.keys(await inspectMod(bad)).length, 0)
  const unsafe = path.join(root, 'unsafe.jar'); await archive(unsafe, { 'fabric.mod.json': JSON.stringify({ name: 'Safe metadata', version: '1.0', icon: '../outside.png' }) }); assert.equal((await inspectMod(unsafe)).icon, undefined)
  const oversized = path.join(root, 'oversized.jar'); await archive(oversized, { 'fabric.mod.json': JSON.stringify({ name: 'Safe metadata', version: '1.0', icon: 'logo.png' }), 'logo.png': Buffer.alloc(2 * 1024 * 1024 + 1) }); assert.equal((await inspectMod(oversized)).versionNumber, '1.0'); assert.equal((await inspectMod(oversized)).icon, undefined)
  const profileDir = path.join(root, 'profile'), game = path.join(root, 'game'), mods = path.join(game, 'mods'); fs.mkdirSync(mods, { recursive: true }); fs.mkdirSync(profileDir)
  fs.copyFileSync(mod, path.join(mods, 'animatica.jar.disabled')); fs.copyFileSync(bad, path.join(mods, 'local.jar'))
  const hash = await modFileHash(mod), profile = { id: 'owned', versionId: '26.3', modLoader: 'fabric' }
  const store = { dataPath: root, get: () => ({ profiles: [profile] }), gamePath: () => game, profilePath: () => profileDir }
  let requests = [], offline = false
  const apiVersion = { id: 'Version1', project_id: 'Project1', version_number: '0.6.2+26.3', files: [{ filename: 'animatica.jar', hashes: { sha1: hash } }] }
  const fetch = async (url, options) => {
    requests.push({ url, options }); if (offline) throw Error('Offline')
    if (url.endsWith('/version_files')) { const body = JSON.parse(options.body); assert.equal(body.algorithm, 'sha1'); assert.ok(body.hashes.includes(hash)); return { ok: true, json: async () => ({ [hash]: apiVersion, ['a'.repeat(40)]: { ...apiVersion, id: 'Forged01' } }) } }
    if (url.includes('/projects?')) return { ok: true, json: async () => [{ id: 'Project1', slug: 'animatica', title: 'Animatica', description: 'Provider description', icon_url: 'https://cdn.modrinth.com/icon.png', project_type: 'mod' }] }
    throw Error('Unexpected URL: ' + url)
  }
  const { ModrinthService } = load('modrinth', { fetch }, { './store': {} }), mr = new ModrinthService(store)
  const { ProfileContent } = load('profile-content'), packs = { list: async () => [] }
  const service = new ProfileContent(store, mr, {}, packs, packs)
  const [items, duplicate] = await Promise.all([service.list('owned', 'mod'), service.list('owned', 'mod')]); assert.equal(items.length, 2); assert.equal(duplicate.length, 2)
  const matched = items.find(item => item.title === 'Animatica'); assert.equal(matched.provider, 'modrinth'); assert.equal(matched.versionId, 'Version1'); assert.equal(matched.versionNumber, '0.6.2+26.3'); assert.equal(matched.enabled, false); assert.equal(matched.description, 'Animated textures'); assert.equal(matched.icon, info.icon)
  assert.equal(items.find(item => item.filename === 'local.jar').provider, undefined); assert.equal(requests.filter(r => r.url.endsWith('/version_files')).length, 1, 'concurrent reads coalesce hash lookups')
  const persisted = mr.installed('owned'); assert.equal(persisted.length, 1); assert.equal(persisted[0].filename, 'animatica.jar'); assert.equal(persisted[0].fileHash, hash)
  offline = true; requests = []; const restarted = new ProfileContent(store, mr, {}, packs, packs); const offlineItems = await restarted.list('owned', 'mod'); assert.equal(offlineItems.find(item => item.filename === 'animatica.jar.disabled').provider, 'modrinth', 'verified pack identities survive offline restarts'); assert.equal(offlineItems.find(item => item.filename === 'animatica.jar.disabled').icon, info.icon)
  await archive(path.join(mods, 'animatica.jar.disabled'), { 'fabric.mod.json': JSON.stringify({ name: 'Changed file', version: '99.0' }) }); const changed = (await restarted.list('owned', 'mod')).find(item => item.filename === 'animatica.jar.disabled'); assert.equal(changed.provider, undefined, 'replacing a recovered file invalidates provider ownership'); assert.equal(changed.versionNumber, '99.0')
  offline = false; apiVersion.files[0].hashes.sha1 = 'b'.repeat(40); assert.equal((await mr.identify([hash])).size, 0, 'mismatched provider hashes are rejected')
  await assert.rejects(() => mr.identify(['not-a-hash']), /özeti/)
  const manifest = path.join(profileDir, 'green-launcher-mods.json'); fs.writeFileSync(manifest, '{ damaged metadata'); mr.remember('owned', persisted); assert.equal(fs.readFileSync(manifest, 'utf8'), '{ damaged metadata', 'automatic recovery preserves malformed user metadata')
  console.log('PASS Fabric/Quilt/Forge/NeoForge/legacy metadata and embedded icons, malformed and oversized archives, exact batched hash ownership, disabled modpack recovery, persistent offline identities, coalescing and changed-file invalidation; isolated fixtures and mocked API')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(root, { recursive: true, force: true }))
