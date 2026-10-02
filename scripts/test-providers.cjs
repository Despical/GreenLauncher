const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const crypto = require('node:crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-providers-'))
let checks = 0
function load(name, mocks = {}, globals = {}) {
  const file = path.resolve('src/main', name + '.ts')
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod, require: n => mocks[n] || (n.startsWith('.') ? load(n.startsWith('./') ? n.slice(2) : n, mocks, globals) : require(n)), process, console, Buffer, URL, URLSearchParams, AbortSignal, fetch, Response, structuredClone, ...globals }, { filename: file })
  return mod.exports
}
async function check(name, run) { await run(); checks++; console.log('PASS', name) }
async function main() {
  const { TechnicService } = load('technic')
  const technic = new TechnicService()
  await check('live Technic discovery returns real packs', async () => assert.ok((await technic.search('', 'all', 'relevance', 0)).hits.length))
  await check('live Technic search and recommended build', async () => {
    assert.ok((await technic.search('tekkit', 'all', 'downloads', 0)).hits.length)
    const versions = await technic.versions('tekkit-smp')
    const selected = await technic.build(versions[0].id)
    assert.equal(selected.pack.name, 'tekkit-smp'); assert.ok(selected.build.mods.length > 5)
    fs.writeFileSync(path.join(root, 'live-build.json'), JSON.stringify(selected))
  })
  await check('Technic invalid names and missing builds rejected', async () => {
    await assert.rejects(technic.pack('../other'))
    await assert.rejects(technic.build('tekkit-smp:not-a-build'))
  })
  const network = load('provider-network')
  await check('live Technic package downloads with its published MD5', async () => {
    const selected = JSON.parse(fs.readFileSync(path.join(root, 'live-build.json'), 'utf8'))
    const file = selected.build.mods.find(m => m.name === 'forge')
    assert.ok(file?.md5)
    const target = path.join(root, 'live-forge.zip')
    await network.downloadProviderFile(file.url, target, { md5: file.md5 })
    const { walkArchive } = load('modpack'); let entries = 0
    await walkArchive(target, async () => { entries++ }); assert.ok(entries)
  })
  await check('public download validation rejects local and unsafe URLs', async () => {
    for (const url of ['http://example.com/x', 'https://127.0.0.1/x', 'https://192.168.0.1/x', 'https://name:password@example.com/x']) await assert.rejects(network.publicUrl(url))
  })
  const fixture = Buffer.from('verified provider data')
  const mockedNetwork = load('provider-network', { 'node:dns/promises': { lookup: async () => [{ address: '1.1.1.1' }] } }, { fetch: async () => new Response(fixture) })
  await check('download verifies hash and preserves destination on corrupt response', async () => {
    const target = path.join(root, 'download.jar')
    await mockedNetwork.downloadProviderFile('https://example.com/a', target, { sha1: crypto.createHash('sha1').update(fixture).digest('hex') })
    await assert.rejects(mockedNetwork.downloadProviderFile('https://example.com/a', target, { sha1: '0'.repeat(40) }), /bütünlük/)
    assert.equal(fs.readFileSync(target, 'utf8'), fixture.toString())
    assert.ok(!fs.readdirSync(root).some(f => f.endsWith('.download')))
  })
  let blocked = false, requestedHeaders = []
  const files = [1, 2].map(n => ({ id: n * 10, modId: n, fileName: `mod${n}.jar`, displayName: `Mod ${n}`, releaseType: 1, fileDate: new Date().toISOString(), downloadCount: 1, downloadUrl: `https://edge.forgecdn.net/${n}`, gameVersions: ['1.20.1'], hashes: [{ algo: 1, value: 'a'.repeat(40) }], dependencies: n === 1 ? [{ modId: 2, relationType: 3 }] : [], isAvailable: true }))
  const profileRoot = path.join(root, 'profile'); fs.mkdirSync(profileRoot)
  const store = { dataPath: root, profilePath: () => profileRoot, gamePath: profile => profile.gameDirectory || profileRoot, get: () => ({ profiles: [{ id: 'p', versionId: '1.20.1', modLoader: 'forge', modLoaderVersion: 'forge-test' }] }) }
  const { CurseForgeService } = load('curseforge', {
    electron: { safeStorage: { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('encrypted:' + s), decryptString: b => b.toString().slice(10) } },
    './provider-network': {
      providerJson: async (value, headers) => {
        const url = new URL(value); requestedHeaders.push(headers(url))
        if (url.pathname === '/v1/games/432') return { data: { id: 432 } }
        const match = url.pathname.match(/\/mods\/(\d+)(.*)/); assert.ok(match)
        const file = files[Number(match[1]) - 1]
        if (match[2].startsWith('/files/')) return { data: file }
        if (match[2] === '/files') return { data: [file] }
        if (match[2] === '/description') return { data: '<p>Description</p>' }
        return { data: { id: file.modId, name: file.displayName, slug: 'mod', summary: 'Test', downloadCount: 1, classId: 6, links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/test' } } }
      },
      downloadProviderFile: async (url, destination, hashes, headers) => {
        assert.equal(headers(new URL(url))['x-api-key'], undefined); assert.throws(() => headers(new URL('https://example.com/leak')))
        if (blocked && url.endsWith('/2')) throw Error('dependency unavailable')
        fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, 'jar data')
      }
    }
  })
  const cf = new CurseForgeService(store)
  await check('CurseForge credentials verified before encrypted persistence', async () => {
    await cf.connect('fixture-key-only-for-tests-123456')
    assert.ok(cf.connected); assert.ok(requestedHeaders.length)
    assert.match(fs.readFileSync(path.join(root, 'curseforge-key.bin'), 'utf8'), /^encrypted:/)
  })
  await check('CurseForge honors publisher download restrictions', async () => await assert.rejects(cf.download({ ...files[0], downloadUrl: null }, path.join(root, 'blocked.jar')), /yayıncı/))
  await check('CurseForge dependency failure leaves profile unchanged', async () => {
    blocked = true; await assert.rejects(cf.install('p', '1:10'), /dependency/)
    assert.deepEqual(fs.readdirSync(profileRoot), [])
  })
  await check('CurseForge installs required dependencies and keeps provider identity', async () => {
    blocked = false; const result = await cf.install('p', '1:10')
    assert.equal(result.length, 2); assert.ok(result.every(m => m.provider === 'curseforge'))
    assert.equal(fs.readdirSync(path.join(profileRoot, 'mods')).length, 2)
    assert.equal((await cf.install('p', '1:10')).length, 2)
  })
  const electron = { app: { getPath: () => path.join(root, 'pack-store') }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1280, height: 720 } }) } }
  const { LauncherStore } = load('store', { electron })
  const packStore = new LauncherStore(); packStore.createOfflineAccount('PackTester')
  const zipFolder = fs.readdirSync('node_modules/.pnpm').find(n => n.startsWith('yazl@'))
  assert.ok(zipFolder, 'ZIP fixture writer available')
  const { ZipFile } = require(path.resolve('node_modules/.pnpm', zipFolder, 'node_modules/yazl'))
  const archive = path.join(root, 'pack-fixture.zip')
  const zip = new ZipFile(); zip.addBuffer(Buffer.from('fixture mod'), 'mods/test.jar'); zip.addBuffer(Buffer.from('keep config'), 'config/test.cfg'); zip.addBuffer(Buffer.from('ignored loader'), 'bin/modpack.jar'); zip.end()
  await new Promise((resolve, reject) => zip.outputStream.pipe(fs.createWriteStream(archive)).on('finish', resolve).on('error', reject))
  const loaderCalls = []
  let failLoader = false
  const game = { installModLoader: async (...args) => { loaderCalls.push(args); if (failLoader) throw Error('loader failed'); return '1.12.2-forge-test' } }
  const { ProviderPacks } = load('provider-packs', { electron, './provider-network': { downloadProviderFile: async (_url, destination) => fs.copyFileSync(archive, destination) } })
  const packService = new ProviderPacks(packStore, game, {}, { build: async () => ({ pack: { name: 'fixture-pack', displayName: 'Fixture pack' }, build: { minecraft: '1.12.2', forge: '14.23.5.2860', memory: 4096, mods: [{ name: 'fixture', version: '1', url: 'https://example.com/pack.zip' }] } }) }, () => {})
  await check('Technic pack extracts content, installs exact loader, creates account-owned profile', async () => {
    const result = await packService.install('technic', 'fixture-pack:1')
    const profile = result.state.profiles.find(p => p.id === result.profileId)
    assert.equal(profile.accountId, result.state.selectedAccountId)
    assert.equal(profile.modLoader, 'forge'); assert.equal(loaderCalls[0][3], '14.23.5.2860')
    assert.equal(fs.readFileSync(path.join(packStore.profilePath(profile.id), 'config/test.cfg'), 'utf8'), 'keep config')
    assert.ok(!fs.existsSync(path.join(packStore.profilePath(profile.id), 'bin/modpack.jar')))
    assert.equal(profile.modpack.projectId, 'technic:fixture-pack')
  })
  await check('failed Technic loader never creates an incomplete profile', async () => {
    const previous = packStore.get().profiles.length; failLoader = true
    await assert.rejects(packService.install('technic', 'fixture-pack:1'), /loader failed/)
    assert.equal(packStore.get().profiles.length, previous)
  })
  const cfArchive = path.join(root, 'cf-pack-fixture.zip')
  const cfZip = new ZipFile()
  cfZip.addBuffer(Buffer.from(JSON.stringify({ minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.4.0', primary: true }] }, manifestType: 'minecraftModpack', manifestVersion: 1, name: 'Fixture CF', files: [{ projectID: 1, fileID: 10, required: true }, { projectID: 2, fileID: 20, required: false }], overrides: 'overrides' })), 'manifest.json')
  cfZip.addBuffer(Buffer.from('pack options'), 'overrides/options.txt'); cfZip.end()
  await new Promise((resolve, reject) => cfZip.outputStream.pipe(fs.createWriteStream(cfArchive)).on('finish', resolve).on('error', reject))
  const downloaded = []
  const cfPacks = new ProviderPacks(packStore, game, {
    file: async value => value === '99:100' ? { id: 100, modId: 99 } : files.find(f => `${f.modId}:${f.id}` === value),
    project: async () => ({ id: '99', title: 'Fixture CF', projectType: 'modpack' }),
    destination: async () => 'mods',
    download: async (file, target) => { downloaded.push(file.modId); fs.mkdirSync(path.dirname(target), { recursive: true }); file.modId === 99 ? fs.copyFileSync(cfArchive, target) : fs.writeFileSync(target, 'verified fixture mod') }
  }, {}, () => {})
  await check('CurseForge pack installs required files and overrides into separate profile', async () => {
    failLoader = false; const result = await cfPacks.install('curseforge', '99:100')
    assert.deepEqual(downloaded, [99, 1]); assert.equal(loaderCalls.at(-1)[3], '47.4.0')
    const directory = packStore.profilePath(result.profileId)
    assert.equal(fs.readFileSync(path.join(directory, 'options.txt'), 'utf8'), 'pack options')
    assert.ok(fs.existsSync(path.join(directory, 'mods/mod1.jar')))
    assert.equal(result.state.profiles.find(p => p.id === result.profileId).modpack.projectId, 'curseforge:99')
  })
  const { safePath } = load('modpack')
  await check('provider archives cannot escape profile or target Windows device names', async () => {
    for (const name of ['../outside', 'a/../../outside', 'C:/outside', 'NUL.txt', 'mods/a.jar:stream', 'mods/a.']) assert.throws(() => safePath(root, name))
  })
  console.log(`${checks} provider checks passed. Live Technic catalog; fixture install/CurseForge (no app API key). Data: ${root}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
