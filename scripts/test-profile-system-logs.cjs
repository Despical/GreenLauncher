const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const { pipeline } = require('node:stream/promises')
const { ZipFile } = require('yazl')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-profile-test-'))
const modules = new Map(), results = []
function load(file) {
  file = path.resolve(file)
  if (modules.has(file)) return modules.get(file)
  const mod = { exports: {} }; modules.set(file, mod.exports)
  const localRequire = name => {
    if (name === 'electron') return { app: { getPath: key => key === 'userData' ? root : path.join(root, 'roaming') }, screen: { getPrimaryDisplay: () => ({ bounds: { width: 1920, height: 1080 } }) } }
    if (name.endsWith('/game')) return { message: error => error.message }
    if (name.startsWith('.')) { const target = path.resolve(path.dirname(file), name + '.ts'); if (fs.existsSync(target)) return load(target) }
    return require(name)
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, { exports: mod.exports, module: mod, require: localRequire, structuredClone, Buffer, URL, AbortController, AbortSignal, fetch, console, setInterval, clearInterval, setTimeout, clearTimeout }, { filename: file })
  return mod.exports
}
const {LauncherStore}=load('src/main/store.ts'), {ProfileSystemLogs}=load('src/main/profile-system-logs.ts'), {gzipSync}=require('node:zlib')
const store=new LauncherStore();store.createOfflineAccount('LogsQA');store.saveProfile({javaPath:'',memoryMb:4096,minMemoryMb:1024,width:1280,height:720,fullscreen:false,serverAddress:'',name:'Logs',versionId:'1.21.1'});const id=store.get().selectedProfileId, directory=store.profilePath(id)
let running=[],preparing=false
const service=new ProfileSystemLogs(store,{getRunningInstances:()=>running,getLaunchState:()=>({preparing})})
const write=(file,bytes)=>{const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes)}
async function main(){
 write('logs/latest.log','[12:00:00] [main/INFO]: Started\n[main/WARN]: Warning\nCaused by: fixture\n  at fixture\naccess_token=private-fixture-token');write('logs/archive.log.gz',gzipSync('archived fixture'));write('crash-reports/crash.txt','crash fixture');write('hs_err_pid100.log','vm crash');write('logs/not-a-log.json','keep');write('secret.txt','keep')
 assert.equal((await service.list(id)).length,4);assert.equal((await service.read(id,'logs/archive.log.gz')).lines[0].text,'archived fixture')
 const doc=await service.read(id,'logs/latest.log');assert.equal(doc.lines[0].level,'info');assert.equal(doc.lines[1].level,'warn');assert.equal(doc.lines[2].level,'error');assert.equal(doc.lines[3].level,'error');assert.equal(doc.lines[4].text.includes('private-fixture-token'),false)
 results.push('Plain logs, gzip archives, crash reports and JVM logs are listed, colored and redacted')
 write('logs/large.log','fixture\n'.repeat(11000));assert.equal((await service.read(id,'logs/large.log')).truncated,true);assert.equal((await service.read(id,'logs/large.log')).lines.length,10000)
 write('logs/bomb.log.gz',gzipSync(Buffer.alloc(9*1024**2)));await assert.rejects(service.read(id,'logs/bomb.log.gz'))
 await assert.rejects(service.read(id,'../secret.txt'));await assert.rejects(service.read(id,'logs/../secret.txt'));await assert.rejects(service.read(id,'secret.txt'));await assert.rejects(service.read('foreign','logs/latest.log'))
 await assert.rejects(service.remove(id,['logs/latest.log','../secret.txt']));assert.ok(fs.existsSync(path.join(directory,'logs/latest.log')))
 running=[{profileId:id}];await assert.rejects(service.remove(id,['logs/latest.log']));running=[];preparing=true;await assert.rejects(service.remove(id,['logs/latest.log']));preparing=false
 results.push('Read bounds and gzip output limits reject oversized archives; traversal, foreign profiles and running games are guarded before deletion')
 await service.remove(id,['logs/archive.log.gz']);assert.equal(fs.existsSync(path.join(directory,'logs/archive.log.gz')),false)
 await service.remove(id,(await service.list(id)).map(file=>file.filename));assert.equal((await service.list(id)).length,0);assert.equal(fs.readFileSync(path.join(directory,'secret.txt'),'utf8'),'keep');assert.ok(fs.existsSync(path.join(directory,'logs/not-a-log.json')))
 results.push('Selected and all-log deletion leave unrelated files and directories intact')
 console.log(results.map(text=>'PASS '+text).join('\n'))
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}))
