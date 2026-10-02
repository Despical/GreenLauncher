// Offline smoke test using installed assets, isolated profiles, and real Minecraft processes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript')
const {once}=require('node:events')
const root=path.join(__dirname,'..'),directory=fs.mkdtempSync(path.join(root,'build','qa-real-games-'))
const java=path.join(process.env.APPDATA,'GreenLauncher','java','java-runtime-epsilon','bin','javaw.exe')
assert.ok(fs.existsSync(java))
const electron={app:{getPath:name=>name==='appData'?process.env.APPDATA:directory},screen:{getPrimaryDisplay:()=>({bounds:{width:1920,height:1080}})}}
const core=require('@xmcl/core'),children=[],output=[]
const modules={electron,'@xmcl/core':{...core,launch:async options=>{
 const child=await core.launch(options);children.push(child)
 child.stdout?.on('data',chunk=>output.push(String(chunk)))
 child.stderr?.on('data',chunk=>output.push(String(chunk)))
 return child
}}}
function load(file){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:name=>modules[name]||(name.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), name + '.ts')) ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name)),Buffer,URL,AbortSignal,structuredClone,fetch,console,process,setTimeout,clearTimeout,setInterval,clearInterval});return mod.exports}
const {LauncherStore}=load('src/main/store.ts'),{GameService}=load('src/main/game.ts')
const store=new LauncherStore();store.createOfflineAccount('LauncherQA')
const input=name=>({name,versionId:'26.2',javaPath:java,memoryMb:2048,minMemoryMb:512,width:854,height:480})
const first=store.saveProfile(input('QA One')).selectedProfileId,second=store.saveProfile(input('QA Two')).selectedProfileId
const game=new GameService(store,{},()=>null,activity=>{if(activity.kind==='error')console.error('ACTIVITY',activity)},instances=>console.log('ACTIVE',instances.map(i=>({pid:i.pid,profile:i.profileName,version:i.versionId}))))
const pause=ms=>new Promise(r=>setTimeout(r,ms))
;(async()=>{
 try{
  assert.equal((await game.play(first,'26.2')).status,'started')
  await pause(15000)
  assert.equal(game.getRunningInstances().length,1,'first Minecraft must stay alive')
  assert.equal((await game.play(second,'26.2')).status,'confirmation-required')
  assert.equal(children.length,1)
  assert.equal((await game.play(second,'26.2',true)).status,'started')
  await pause(15000)
  assert.equal(game.getRunningInstances().length,2,'both Minecraft processes must stay alive')
  fs.writeFileSync(path.join(root,'build','qa-real-games-ready.json'),JSON.stringify(game.getRunningInstances(),null,2))
  console.log('READY: two real Minecraft sessions running; holding 25 seconds for visual inspection')
  await pause(25000)
  const stop=once(children[0],'exit');children[0].kill();await stop
  assert.equal(game.getRunningInstances().length,1)
  const last=once(children[1],'exit');children[1].kill();await last
  assert.equal(game.getRunningInstances().length,0)
  console.log('PASS actual Minecraft 26.2: confirmation before second launch, two real processes, independent exit tracking. No user worlds opened.')
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill();fs.writeFileSync(path.join(directory,'process-output.log'),output.join(''))}
})().catch(error=>{console.error(error);console.error(output.join('').slice(-3500));process.exitCode=1})
