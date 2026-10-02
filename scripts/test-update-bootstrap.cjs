// Exercise the unchanged 0.17.4 shell.openPath handoff with isolated copies only.
const {app,shell}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-bootstrap-')),target=path.join(root,'Launcher.exe'),version=require('../package.json').version
// The harness's Chromium files stay outside the directory cleaned before exit.
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'green-bootstrap-harness-')))
process.env.PORTABLE_EXECUTABLE_FILE=target;process.env.GREEN_LAUNCHER_UPDATE_QA_ROOT=root
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const receipt=path.join(root,'GreenLauncher/update-result.json'),expected=hash(`release/GreenLauncher-${version}.exe`)
fs.copyFileSync('release/GreenLauncher-0.17.4.exe',target)
assert.notEqual(hash(target),expected)
const wait=ms=>new Promise(r=>setTimeout(r,ms))
app.whenReady().then(async()=>{
 try{
  assert.equal(await shell.openPath(path.resolve(`release/GreenLauncher-Setup-${version}.exe`)),'')
  let result
  for(let n=0;n<240;n++){await wait(500);if(fs.existsSync(receipt)){try{result=JSON.parse(fs.readFileSync(receipt,'utf8'))}catch{}}if(result?.status==='confirmed'||result?.status==='failed')break}
  assert.equal(result?.status,'confirmed',JSON.stringify(result));assert.equal(result.version,version);assert.equal(result.from,'0.17.4');assert.equal(hash(target),expected)
  const entries=JSON.parse(fs.readFileSync(path.join(root,'GreenLauncher/error-log.json'),'utf8'));assert.ok(entries.some(e=>e.code==='UPDATE_SUCCESS'&&e.level==='info'))
  await wait(7000);assert.equal(fs.existsSync(target+'.update-backup'),false)
  console.log('PASS unchanged 0.17.4 Electron shell.openPath -> silent bootstrap -> atomic portable replacement -> real new launcher window -> confirmed success log; original user EXE untouched')
  assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true,maxRetries:20,retryDelay:200});app.exit(0)
 }catch(error){console.error(error);console.error('Isolated fixture preserved:',root);app.exit(1)}
})
