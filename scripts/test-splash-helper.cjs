const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn,spawnSync}=require('node:child_process')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-shortcut-splash-')),exe=path.resolve('build/qa-shortcut-splash.exe'),png=path.resolve('build/portable-splash.png'),delay=ms=>new Promise(r=>setTimeout(r,ms))
const compilation=spawnSync('g++',['-std=c++17','-O2','-mwindows','-o',exe,'scripts/splash-helper.cpp','-lgdiplus','-lshell32','-lole32'],{windowsHide:true,encoding:'utf8'})
assert.equal(compilation.status,0,compilation.stderr)
const children=[]
async function exited(child){for(let i=0;i<60;i++){if(child.exitCode!==null)return;await delay(50)}throw Error('Native splash did not close')}
;(async()=>{try{
 const owner=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});children.push(owner)
 const first=spawn(exe,[png,path.join(root,'owner-ready'),String(owner.pid)],{windowsHide:true,stdio:'ignore'});children.push(first)
 await delay(400);assert.equal(first.exitCode,null,'splash remains visible while its owner is alive');owner.kill();await exited(first);assert.equal(first.exitCode,0)
 const ready=path.join(root,'complete'),second=spawn(exe,[png,ready,String(process.pid)],{windowsHide:true,stdio:'ignore'});children.push(second)
 await delay(250);assert.equal(second.exitCode,null);fs.writeFileSync(ready,'ready');await exited(second);assert.equal(second.exitCode,0)
 console.log('PASS native loading window follows wrapper lifetime and completion marker; owned temporary processes only')
}finally{for(const child of children)if(child.exitCode===null)child.kill()}})().catch(e=>{console.error(e);process.exitCode=1})
