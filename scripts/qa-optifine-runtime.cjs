const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),ts=require('typescript'),core=require('@xmcl/core');
const originalData=path.join(process.env.APPDATA,'GreenLauncher');
const resourcePath=path.join(originalData,'minecraft'),javaRoot=path.join(originalData,'java','java-runtime-epsilon');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-optifine-runtime-'));
const runtimeId='26.2-Optifine_HD_U_K2_pre1';
const state={settings:{javaPath:path.join(javaRoot,'bin','javaw.exe'),memoryMb:2048,width:960,height:540,closeOnLaunch:false},profiles:[],accounts:[{id:'1234567812343234a234123456781234',name:'GreenQA',kind:'offline'}],selectedAccountId:'1234567812343234a234123456781234'};
const store={dataPath:root,minecraftPath:resourcePath,get:()=>structuredClone(state)};
let child;
const baseline=process.argv.includes('--qa-before-fix');
let gameSource=fs.readFileSync('src/main/game.ts','utf8');if(baseline)gameSource=gameSource.replace('process.stdout?.resume()','').replace('process.stderr?.resume()','');
const outputName=baseline?'qa-optifine-before':'qa-optifine';
const source=ts.transpileModule(gameSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const serverModule={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/shared/server-launch.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:serverModule,exports:serverModule.exports,URL});
const mod={exports:{}};
vm.runInNewContext(source,{module:mod,exports:mod.exports,require:n=>n==='../shared/server-launch'?serverModule.exports:n==='electron'?{}:n==='./download-manager'?{getDownloadManager:()=>undefined}:n==='@xmcl/core'?{...core,launch:async options=>{child=await core.launch(options);return child}}:require(n),structuredClone,Buffer,URL,AbortSignal,console,process,setTimeout,clearTimeout});
const game=new mod.exports.GameService(store,{},()=>null,()=>{});
(async()=>{
try{
await game.play(null,runtimeId);
console.log(JSON.stringify({started:true,pid:child.pid,testDirectory:root}));
const log=path.join(root,'standalone',runtimeId,'logs','latest.log');
await new Promise(resolve=>setTimeout(resolve,30000));
const before=fs.existsSync(log)?fs.statSync(log).size:0;
const jcmd=path.join(javaRoot,'bin','jcmd.exe');
const first=await promisify(execFile)(jcmd,[String(child.pid),'Thread.print'],{windowsHide:true,maxBuffer:4*1024*1024,timeout:10000});
fs.writeFileSync(`build/${outputName}-threads-first.txt`,first.stdout);
await new Promise(resolve=>setTimeout(resolve,8000));
const second=await promisify(execFile)(jcmd,[String(child.pid),'Thread.print'],{windowsHide:true,maxBuffer:4*1024*1024,timeout:10000});
fs.writeFileSync(`build/${outputName}-threads-second.txt`,second.stdout);
const render=second.stdout.split('\n\n').find(block=>block.includes('"Render thread"'))??'';
const logText=fs.existsSync(log)?fs.readFileSync(log,'utf8'):'';
const result={alive:child.exitCode===null,logBytes:Buffer.byteLength(logText),beforeLogBytes:before,renderThread:render,testDirectory:root};
fs.writeFileSync(`build/${outputName}-runtime-results.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{if(child&&child.exitCode===null)child.kill()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
