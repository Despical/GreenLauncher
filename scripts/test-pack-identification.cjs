const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const { ZipFile } = require('yazl'), { once } = require('node:events'), { createHash } = require('node:crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-pack-identification-'))
function load(name, globals = {}) {
  const mod = { exports: {} }, file = path.resolve('src/main', name + '.ts')
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { module: mod, exports: mod.exports, require: n => n.startsWith('.') ? load(n.slice(2), globals) : require(n), Buffer, URL, URLSearchParams, structuredClone, setTimeout, clearTimeout, AbortSignal, process: { env: {} }, ...globals })
  return mod.exports
}
async function archive(entries) { const zip = new ZipFile(), chunks = []; zip.outputStream.on('data', chunk => chunks.push(chunk)); for (const [name, value] of Object.entries(entries)) zip.addBuffer(Buffer.from(value), name); zip.end(); await once(zip.outputStream, 'end'); return Buffer.concat(chunks) }
;(async () => {
  const game = path.join(root, 'game'), profileDir = path.join(root, 'profile'), packs = path.join(game, 'resourcepacks'), shaders = path.join(game, 'shaderpacks')
  fs.mkdirSync(packs, { recursive: true }); fs.mkdirSync(shaders); fs.mkdirSync(profileDir)
  const resource = await archive({ 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: 'Imported textures' } }) }), shader = await archive({ 'shaders/gbuffers_basic.fsh': 'void main() {}' })
  fs.writeFileSync(path.join(packs, 'Imported pack.zip'), resource); fs.writeFileSync(path.join(shaders, 'Imported shader.zip'), shader)
  fs.writeFileSync(path.join(game, 'options.txt'), 'music:0.7\nresourcePacks:["file/Imported pack.zip"]\n')
  const hashes = [resource, shader].map(bytes => createHash('sha1').update(bytes).digest('hex'))
  const profile = { id: 'owned', versionId: '1.21.1' }, store = { dataPath: root, get: () => ({ profiles: [profile] }), gamePath: () => game, profilePath: () => profileDir }
  let requests = [], offline = false, wrongType = false
  const fetch = async (value, options) => {
    const url = new URL(value); requests.push(url.pathname); if (offline) throw Error('Offline')
    if (url.pathname.endsWith('/version_files')) { const body = JSON.parse(options.body); assert.equal(body.algorithm, 'sha1'); return { ok: true, json: async () => Object.fromEntries(body.hashes.filter(hash => hashes.includes(hash)).map(hash => { const i = hashes.indexOf(hash); return [hash, { id: i ? 'ShaderV1' : 'PackVer1', project_id: i ? 'ShaderP1' : 'PackProj1', version_number: i ? '4.5.6' : '3.2.1', files: [{ filename: 'provider.zip', hashes: { sha1: hash } }] }] })) } }
    if (url.pathname.endsWith('/projects')) return { ok: true, json: async () => JSON.parse(url.searchParams.get('ids')).map(id => ({ id, slug: id.toLowerCase(), title: id === 'PackProj1' ? 'Recognized textures' : 'Recognized shader', description: 'Provider description', icon_url: null, project_type: wrongType ? 'mod' : id === 'PackProj1' ? 'resourcepack' : 'shader' })) }
    if (url.pathname.endsWith('/project/ShaderP1')) return { ok: true, json: async () => ({ id: 'ShaderP1', slug: 'shaderp1', title: 'Recognized shader', description: 'Recovered legacy description', body: '', icon_url: null, downloads: 10, updated: '2026-10-04', categories: [], source_url: null, project_type: 'shader' }) }
    throw Error('Unexpected network URL')
  }
  const { ModrinthService } = load('modrinth', { fetch }), mr = new ModrinthService(store)
  const { ResourcePacks } = load('resource-packs', { fetch }), resourceService = new ResourcePacks(store, mr, {}), shaderService = new ResourcePacks(store, mr, {}, () => false, 'shader')
  const [first, concurrent] = await Promise.all([resourceService.list('owned'), resourceService.list('owned')])
  assert.equal(first[0].provider, 'modrinth'); assert.equal(first[0].versionNumber, '3.2.1'); assert.equal(concurrent[0].versionId, 'PackVer1'); assert.equal(first[0].title, 'Recognized textures'); assert.equal(first[0].enabled, true); assert.equal(first[0].format, '34'); assert.equal(first[0].fileHash, hashes[0]); assert.equal(requests.filter(p => p.endsWith('/version_files')).length, 1, 'concurrent resource listing coalesces exact hash lookup')
  const shaderItems = await shaderService.list('owned'); assert.equal(shaderItems[0].versionNumber, '4.5.6'); assert.equal(shaderItems[0].sourceUrl, 'https://modrinth.com/shader/shaderp1')
  assert.equal(first[0].description, 'Imported textures', 'local pack description takes precedence'); assert.equal(shaderItems[0].description, 'Provider description', 'provider description fills missing archive text');
  const shaderRestarted = await new ResourcePacks(store, mr, {}, () => false, 'shader').list('owned'); assert.equal(shaderRestarted[0].description, 'Provider description', 'description persists across service restarts');
  const shaderManifest = path.join(profileDir, 'green-launcher-shaderpacks.json'), legacyShader = JSON.parse(fs.readFileSync(shaderManifest, 'utf8')); delete legacyShader[0].description; fs.writeFileSync(shaderManifest, JSON.stringify(legacyShader));
  const legacyService = new ResourcePacks(store, mr, {}, () => false, 'shader'); const legacyItems = await legacyService.list('owned'); assert.equal(legacyItems[0].description, 'Recovered legacy description', 'already installed provider archives also gain descriptions'); const detailCalls = requests.length; await legacyService.list('owned'); assert.equal(requests.length, detailCalls, 'description recovery persists without repeated project calls');
  const attempts = requests.length; await resourceService.enable('owned', 'Imported pack.zip', false); assert.equal(requests.length, attempts, 'activation keeps cached provider metadata'); assert.ok(fs.readFileSync(path.join(game, 'options.txt'), 'utf8').includes('music:0.7'))
  offline = true; const restarted = new ResourcePacks(store, mr, {}); const persisted = await restarted.list('owned'); assert.equal(persisted[0].versionNumber, '3.2.1'); assert.equal(requests.length, attempts, 'verified ZIP identity survives offline restart')
  fs.writeFileSync(path.join(packs, 'Imported pack.zip'), await archive({ 'pack.mcmeta': JSON.stringify({ pack: { pack_format: 34, description: 'Different bytes' } }) })); const changed = await restarted.list('owned'); assert.equal(changed[0].provider, undefined); assert.equal(changed[0].versionNumber, undefined, 'replaced ZIP cannot retain an unrelated version')
  offline = false; wrongType = true; assert.equal((await mr.identify([hashes[0]], 'resourcepack')).size, 0, 'project type must match'); wrongType = false; assert.equal((await mr.identify([hashes[0]], 'mod')).size, 0, 'ZIP hashes cannot be used as mod JAR ownership')
  fs.writeFileSync(path.join(packs, 'Imported pack.zip'), resource); const manifest = path.join(profileDir, 'green-launcher-resourcepacks.json'); fs.writeFileSync(manifest, '{ damaged metadata'); await new ResourcePacks(store, mr, {}).list('owned'); assert.equal(fs.readFileSync(manifest, 'utf8'), '{ damaged metadata', 'discovery preserves malformed user metadata')
  assert.equal(fs.readFileSync(path.join(packs, 'Imported pack.zip')).equals(resource), true, 'discovery never replaces pack bytes')
  console.log('PASS resource/shader exact ZIP identification, versions/provider/source recovery, persistence/offline restart, activation metadata retention, changed-file invalidation, type/extension checks, concurrent lookup coalescing and malformed metadata preservation; isolated fixtures')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(root, { recursive: true, force: true }))
