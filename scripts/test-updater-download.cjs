// Real electron-updater network/cache/checksum exercise. All paths and the feed
// are isolated; the fake payload is never executed and no installer is launched.
const { app } = require('electron'), { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-update-network-'))
app.setPath('userData', path.join(root, 'user'))
const moduleFixture = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/updater.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: moduleFixture, exports: moduleFixture.exports, Date, Number })
const { LauncherUpdater } = moduleFixture.exports
let mode = 'corrupt', installerRequests = 0, version = '0.18.0'
const payload = Buffer.alloc(1024 * 1024, 77), hash = crypto.createHash('sha512').update(payload).digest('base64')
fs.writeFileSync(path.join(root, 'app-update.yml'), 'updaterCacheDirName: isolated-updater-cache\n')
const server = http.createServer((request, response) => {
 if (request.url.startsWith('/latest.yml') && mode==='missing-metadata') { response.writeHead(404); response.end('Not Found'); return }
 if (request.url.startsWith('/latest.yml')) { response.end(`version: ${version}\nfiles:\n  - url: setup.exe\n    sha512: ${hash}\n    size: ${payload.length}\npath: setup.exe\nsha512: ${hash}\nreleaseDate: '2026-10-03T10:00:00Z'\nreleaseNotes: Verified test notes\n`); return }
 installerRequests++;response.setHeader('Content-Length',payload.length)
 if(mode==='corrupt'){response.end(Buffer.alloc(payload.length,19));return}
 if(mode==='interrupted'){response.write(payload.subarray(0,4096));setTimeout(()=>response.destroy(),10);return}
 if(mode==='slow'){let offset=0;const timer=setInterval(()=>{if(offset>=payload.length){clearInterval(timer);response.end();return}response.write(payload.subarray(offset,offset+8192));offset+=8192},20);response.on('close',()=>clearInterval(timer));return}
 response.end(payload)
})
let updater
const deadline = setTimeout(() => { console.error('Updater network check timed out'); app.exit(1) }, 60000)
app.whenReady().then(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const adapter={version:'0.17.0',name:'GreenLauncherUpdaterQA',isPackaged:true,appUpdateConfigPath:path.join(root,'app-update.yml'),userDataPath:path.join(root,'user'),baseCachePath:root,whenReady:()=>app.whenReady(),onQuit:handler=>app.on('quit',(_,code)=>handler(code)),quit:()=>{throw Error('Installer must never run in network QA')}}
 const engine=new NsisUpdater({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`},adapter)
 engine.httpExecutor=new ElectronHttpExecutor(()=>{})
 engine.setFeedURL({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`})
 engine.on('error',error=>console.log('Expected network QA diagnostic:',error.code,error.message))
 engine.logger=null;engine.disableDifferentialDownload=true
 updater=new LauncherUpdater(engine,'0.17.0',true,false,()=>{},()=>false,async()=>{throw Error('No installation allowed')})
 mode='missing-metadata';assert.equal((await updater.check()).error,'metadata')
 mode='corrupt';assert.equal((await updater.check()).phase,'available');assert.equal(installerRequests,0)
 assert.equal((await updater.download()).error,'checksum');assert.equal(engine.installerPath,null)
 mode='interrupted';assert.equal((await updater.download()).phase,'error');assert.equal(engine.installerPath,null)
 mode='slow';const promise=updater.download();while(updater.get().phase!=='downloading')await new Promise(r=>setTimeout(r,10));await new Promise(r=>setTimeout(r,90));await updater.cancel();assert.equal((await promise).phase,'available');assert.equal(engine.installerPath,null)
 mode='valid';assert.equal((await updater.download()).phase,'ready');assert.equal(crypto.createHash('sha512').update(fs.readFileSync(engine.installerPath)).digest('base64'),hash)
 const count=installerRequests,newEngine=new NsisUpdater({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`},adapter);newEngine.logger=null;newEngine.disableDifferentialDownload=true
 newEngine.httpExecutor=new ElectronHttpExecutor(()=>{})
 newEngine.setFeedURL({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`})
 const restarted=new LauncherUpdater(newEngine,'0.17.0',true,false,()=>{},()=>false,async()=>{})
 await restarted.check();assert.equal((await restarted.download()).phase,'ready');assert.equal(installerRequests,count)
 version='0.16.0';const olderEngine=new NsisUpdater({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`},adapter);olderEngine.logger=null
 olderEngine.httpExecutor=new ElectronHttpExecutor(()=>{})
 olderEngine.setFeedURL({provider:'generic',url:`http://127.0.0.1:${server.address().port}/`})
 const older=new LauncherUpdater(olderEngine,'0.17.0',true,false,()=>{},()=>false,async()=>{});assert.equal((await older.check()).phase,'current');await older.download();assert.equal(installerRequests,count)
 restarted.dispose();older.dispose()
 console.log('PASS real NsisUpdater feed, corrupt SHA-512 rejection, interrupted transfer, cancellation, retry, exact verified download, cache reuse after restart and older release exclusion; no installer executed')
}).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{clearTimeout(deadline);updater?.dispose();server.close();app.exit(process.exitCode||0)})
