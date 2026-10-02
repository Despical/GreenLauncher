const assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), { EventEmitter } = require('node:events')
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/updater.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, Date, Number, AbortController })
const { LauncherUpdater, newerRelease } = mod.exports
const settle = () => new Promise(resolve => setImmediate(resolve))
class Engine extends EventEmitter {
  version = '0.18.0'; checks = 0; downloads = 0; installs = 0; mode = 'ok'; hold = null
  async checkForUpdates() {
    this.checks++; await settle()
    if (this.mode === 'offline') throw Object.assign(Error('offline'), { code: 'ECONNRESET' })
    if (this.mode === 'missing-metadata') throw Object.assign(Error('release manifest missing'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' })
    const token = { cancelled: false, cancel() { this.cancelled = true; this.callback?.() } }
    return { updateInfo: { version: this.version, releaseDate: '2026-10-03', releaseNotes: 'Test notes' }, cancellationToken: token }
  }
  async downloadUpdate(token) {
    this.downloads++
    this.emit('download-progress', { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 100 })
    if (this.mode === 'cancel') await new Promise((resolve, reject) => { token.callback = () => reject(Error('cancelled')); if (token.cancelled) token.callback(); this.hold = resolve })
    if (this.mode === 'checksum') throw Object.assign(Error('bad data'), { code: 'ERR_CHECKSUM_MISMATCH' })
    if (this.mode === 'interrupted') throw Object.assign(Error('reset'), { code: 'ECONNRESET' })
    return ['verified-setup.exe']
  }
  quitAndInstall(silent, restart) { assert.equal(silent,true); assert.equal(restart,true); this.installs++ }
}
async function main() {
  for (const candidate of ['0.16.9', '0.17.0', '0.17.0-beta.1', 'bad', '0.18.0-beta.1', '9007199254740992.0.0']) assert.equal(newerRelease(candidate, '0.17.0'), false)
  for (const candidate of ['0.17.1', '0.18.0', '1.0.0', '0.100.0']) assert.equal(newerRelease(candidate, '0.17.0'), true)
  const engine = new Engine(), events = []
  let busy = false, portableInstalls = 0
  const service = new LauncherUpdater(engine, '0.17.0', true, false, value => events.push(value), () => busy, async () => portableInstalls++)
  assert.equal(engine.autoDownload, false); assert.equal(engine.autoInstallOnAppQuit, false); assert.equal(engine.allowDowngrade, false); assert.equal(engine.allowPrerelease, false)
  const a = service.check(), b = service.check(); assert.equal(a, b); assert.equal((await a).phase, 'available'); assert.equal(engine.checks, 1); assert.equal(engine.downloads, 0)
  assert.equal((await service.install()).phase, 'available'); assert.equal(engine.installs, 0)
  for (const version of ['0.16.0', '0.17.0', '0.18.0-beta.1']) { engine.version = version; assert.equal((await service.check()).phase, 'current'); await service.download(); assert.equal(engine.downloads, 0) }
  engine.version = '0.18.0'; engine.mode = 'offline'; assert.equal((await service.check()).error, 'network')
  engine.mode = 'missing-metadata'; assert.equal((await service.check()).error, 'metadata')
  engine.mode = 'ok'; await service.check()
  engine.mode = 'checksum'; assert.equal((await service.download()).error, 'checksum'); await service.install(); assert.equal(engine.installs, 0)
  engine.mode = 'interrupted'; assert.equal((await service.download()).error, 'network'); await service.install(); assert.equal(engine.installs, 0)
  engine.mode = 'cancel'; const downloading = service.download(); assert.equal(service.download(), downloading)
  while (!engine.hold) await settle()
  await service.cancel(); assert.equal((await downloading).phase, 'available'); assert.equal(service.get().error, undefined)
  engine.mode = 'ok'; assert.equal((await service.download()).phase, 'ready'); assert.ok(events.some(item => item.percent === 42)); assert.equal(engine.installs, 0)
  const downloads = engine.downloads; await service.download(); assert.equal(engine.downloads, downloads)
  busy = true; assert.equal((await service.install()).error, 'busy'); assert.equal(engine.installs, 0); assert.equal(service.get().phase, 'ready')
  busy = false; await service.install(); assert.equal(engine.installs, 1); assert.equal(portableInstalls, 0)
  const portableEngine = new Engine(), portable = new LauncherUpdater(portableEngine, '0.17.0', true, true, () => {}, () => false, async file => { assert.equal(file, 'verified-setup.exe'); portableInstalls++ })
  await portable.check(); await portable.download(); await portable.install(); assert.equal(portableInstalls, 1); assert.equal(portableEngine.installs, 0)
  const stoppedEngine = new Engine(), stopped = new LauncherUpdater(stoppedEngine, '0.17.0', false, false, () => {}, () => false, async () => {})
  await stopped.check(); await stopped.download(); await stopped.install(); assert.equal(stopped.get().phase, 'disabled'); assert.equal(stoppedEngine.checks, 0)
  const changing = new Engine(), changed = new LauncherUpdater(changing, '0.17.0', true, false, () => {}, () => false, async () => {})
  await changed.check(); changing.version = '0.16.0'; assert.equal((await changed.download()).phase, 'current'); assert.equal(changing.downloads, 0); await changed.install(); assert.equal(changing.installs, 0)
  assert.equal(portableEngine.disableDifferentialDownload,true)
  const logged=[],failingEngine=new Engine(),loggedUpdater=new LauncherUpdater(failingEngine,'0.17.1',true,true,()=>{},()=>false,async()=>{},error=>logged.push(error))
  await loggedUpdater.check();failingEngine.mode='interrupted';await loggedUpdater.download();assert.equal(logged.length,1);assert.equal(loggedUpdater.get().operation,'download')
  failingEngine.emit('error',logged[0]);assert.equal(logged.length,1,'engine event and rejected promise report the same failure once')
  await loggedUpdater.download();assert.equal(logged.length,2,'a separate retry can produce its own diagnostic')
  failingEngine.mode='offline';await loggedUpdater.check();assert.equal(loggedUpdater.get().operation,'check');assert.ok(loggedUpdater.get().checkedAt)
  let nativeInstalls=0, cancelledSignal, releaseNative
  const nativeEngine=new Engine(), nativeUpdater=new LauncherUpdater(nativeEngine,'0.17.4',true,true,()=>{},()=>false,async()=>{throw Error('legacy path used')},()=>{}, {
    async download(version,progress,signal){assert.equal(version,'0.18.0');progress({percent:33});cancelledSignal=signal;if(releaseNative===null)await new Promise((resolve,reject)=>{releaseNative=resolve;signal.addEventListener('abort',()=>reject(Error('cancelled')))});return ['native.exe']},
    async install(file,version){assert.equal(file,'native.exe');assert.equal(version,'0.18.0');nativeInstalls++}
  })
  await nativeUpdater.check();releaseNative=null;const nativePending=nativeUpdater.download();while(!releaseNative)await settle();await nativeUpdater.cancel();await nativePending;assert.equal(cancelledSignal.aborted,true);assert.equal(nativeUpdater.get().phase,'available');assert.equal(nativeEngine.downloads,0)
  await nativeUpdater.download();assert.equal(nativeUpdater.get().phase,'ready');await nativeUpdater.install();assert.equal(nativeInstalls,1);assert.equal(nativeUpdater.get().phase,'installing');nativeUpdater.dispose()
  service.dispose(); portable.dispose(); stopped.dispose(); changed.dispose()
  console.log('PASS stable version ordering, downgrade prevention, check/download coalescing, offline recovery, checksum/interruption failure, cancellation/retry, progress, operation guards, explicit installation, portable transition and disabled development checks')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
