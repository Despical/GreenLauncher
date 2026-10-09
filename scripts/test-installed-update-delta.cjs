// Real installed updater, block maps and HTTP Range reconstruction. Owned cache
// only; neither installer is executed and no user accounts or profiles are read.
const electron = require('electron'), { spawnSync } = require('node:child_process')
if (!electron.app) {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'green-installed-delta-'))
  let code = 1
  try {
    const child = spawnSync(electron, [__filename, ...process.argv.slice(2)], { windowsHide: true, stdio: 'inherit', timeout: 120_000, env: { ...process.env, GREEN_INSTALLED_DELTA_QA_ROOT: owned } })
    if (child.error) throw child.error
    code = child.status ?? 1
  } finally {
    if (path.dirname(owned) !== os.tmpdir() || !path.basename(owned).startsWith('green-installed-delta-')) throw Error('Unexpected fixture path')
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
  }
  process.exit(code)
}
const { app } = electron, { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const { createRequire } = require('node:module')
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict')
const version = require('../package.json').version
const baseline = path.resolve(process.argv[2] || 'build/qa-nsis-baseline/GreenLauncher-Setup-0.19.0.exe')
const next = path.resolve(`release/GreenLauncher-Setup-${version}.exe`), portable = path.resolve(`release/GreenLauncher-${version}.exe`)
const metadata = yaml.load(fs.readFileSync('release/latest.yml', 'utf8'))
const root = process.env.GREEN_INSTALLED_DELTA_QA_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'green-installed-delta-'))
app.setPath('userData', path.join(root, 'user'))
let updater, ranges = 0, full = 0, payloadBytes = 0
const server = http.createServer((request, response) => {
  const name = new URL(request.url, 'http://127.0.0.1').pathname.split('/').at(-1)
  if (name === 'latest.yml') { response.end(fs.readFileSync('release/latest.yml')); return }
  if (name === `GreenLauncher-Setup-${version}.exe.blockmap`) { fs.createReadStream(next + '.blockmap').pipe(response); return }
  if (name === 'GreenLauncher-Setup-0.19.0.exe.blockmap') { fs.createReadStream(baseline + '.blockmap').pipe(response); return }
  if (name !== path.basename(next)) { response.writeHead(404); response.end(); return }
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '')
  if (match) {
    const start = Number(match[1]), end = Number(match[2]); ranges++; payloadBytes += end - start + 1
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${metadata.files[0].size}`, 'Content-Length': end - start + 1 })
    fs.createReadStream(next, { start, end }).pipe(response)
  } else { full++; payloadBytes += metadata.files[0].size; response.setHeader('Content-Length', metadata.files[0].size); fs.createReadStream(next).pipe(response) }
})
const hash = file => new Promise((resolve, reject) => {
  const value = crypto.createHash('sha512'), stream = fs.createReadStream(file)
  stream.on('data', data => value.update(data)); stream.on('end', () => resolve(value.digest('base64'))); stream.on('error', reject)
})
const deadline = setTimeout(() => { console.error('Installed delta QA timed out'); app.exit(1) }, 120_000)
app.whenReady().then(async () => {
  // Assert the already compressed bridge EXE is embedded without recompression.
  assert.ok(fs.readFileSync(next).indexOf(fs.readFileSync(portable)) >= 0, 'The setup embeds the exact portable bytes unchanged')
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  fs.copyFileSync('src/main/app-update.yml', path.join(root, 'app-update.yml'))
  const adapter = { version: '0.19.0', name: 'GreenLauncherInstalledDeltaQA', isPackaged: true, appUpdateConfigPath: path.join(root, 'app-update.yml'), userDataPath: path.join(root, 'user'), baseCachePath: root, whenReady: () => app.whenReady(), onQuit: handler => app.on('quit', (_, code) => handler(code)), quit: () => { throw Error('QA must not install anything') } }
  const feed = { provider: 'generic', url: `http://127.0.0.1:${server.address().port}/`, useMultipleRangeRequest: false }
  const engine = new NsisUpdater(feed, adapter)
  engine.on('error', error => console.error('Installed delta QA diagnostic:', error))
  engine.logger = null; engine.disableDifferentialDownload = false; engine.autoDownload = false; engine.autoInstallOnAppQuit = false
  engine.httpExecutor = new ElectronHttpExecutor(() => {})
  engine.setFeedURL(feed)
  const helper = await engine.getOrCreateDownloadHelper()
  fs.mkdirSync(helper.cacheDir, { recursive: true }); fs.copyFileSync(baseline, path.join(helper.cacheDir, 'installer.exe'))
  fs.copyFileSync(baseline + '.blockmap', path.join(helper.cacheDir, 'current.blockmap'))
  const { LauncherUpdater } = require('./test-source.cjs').createSourceLoader()('src/main/updater.ts')
  updater = new LauncherUpdater(engine, '0.19.0', true, false, () => {}, () => false, async () => { throw Error('Portable installation must not run') })
  assert.equal((await updater.check()).phase, 'available')
  const state = await updater.download(); assert.equal(state.phase, 'ready', JSON.stringify(state))
  assert.equal(await hash(engine.installerPath), metadata.files[0].sha512)
  assert.equal(full, 0, 'No full installer download or fallback')
  assert.ok(ranges > 0); assert.ok(payloadBytes < 64 * 1024 ** 2, `${payloadBytes} bytes exceeds the small-update budget`)
  assert.ok(payloadBytes < metadata.files[0].size * .25)
  assert.equal(state.total, payloadBytes, 'The displayed total is the actual network payload')
  const requests = ranges
  const restartedEngine = new NsisUpdater(feed, adapter); restartedEngine.logger = null; restartedEngine.httpExecutor = new ElectronHttpExecutor(() => {})
  restartedEngine.setFeedURL(feed)
  const restarted = new LauncherUpdater(restartedEngine, '0.19.0', true, false, () => {}, () => false, async () => { throw Error('No installation allowed') })
  await restarted.check(); assert.equal((await restarted.download()).phase, 'ready')
  assert.equal(ranges, requests, 'Verified download cache is reused after restart'); restarted.dispose()
  fs.writeFileSync('build/qa-installed-delta-results.json', JSON.stringify({ passed: true, version, downloadBytes: payloadBytes, fullBytes: metadata.files[0].size, ranges, sha512: metadata.files[0].sha512 }, null, 2))
  console.log(`PASS real installed NsisUpdater reconstructs exact setup over HTTP Range: ${(payloadBytes / 1024 ** 2).toFixed(2)} MiB of ${(metadata.files[0].size / 1024 ** 2).toFixed(2)} MiB; ${ranges} ranges; raw bridge bytes, progress and verified cache correct; no installer executed`)
}).catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  clearTimeout(deadline); updater?.dispose(); server.close()
  assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('green-installed-delta-'))
  // The owning Node process removes Chromium's fixture directory after exit.
  app.exit(process.exitCode || 0)
})
