const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events')
const {createSourceLoader}=require('./test-source.cjs')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const profileId='12345678-1234-1234-1234-123456789abc',accountId='12345678123412341234123456789abc'
async function scenario({shortcut=true,native=false,result='started',exit=false,second=false,latePaint=false,standalone=false,visible=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-shortcut-startup-')),data=path.join(root,'GreenLauncher'),windows=[],channels=new Map(),calls=[],sent=[]
  fs.mkdirSync(data,{recursive:true})
  fs.writeFileSync(path.join(data,'launcher.json'),JSON.stringify({settings:{language:'tr',discordPresence:false,exitOnLaunch:exit},accounts:[{id:accountId,name:'ShortcutQA',kind:'offline',homeAccountId:''}],selectedAccountId:accountId,profiles:[{id:profileId,accountId,name:'Shortcut QA',versionId:'1.21.1',javaPath:'',memoryMb:2048,width:1920,height:1080}],selectedProfileId:profileId}))
  const ready=path.join(root,'native-ready'),paths={userData:data,appData:root,temp:root},app=new EventEmitter()
  Object.assign(app,{setPath:(key,value)=>paths[key]=value,getPath:key=>paths[key]||root,getAppPath:()=>process.cwd(),isPackaged:false,getVersion:()=>require('../package.json').version,setAppUserModelId:()=>{},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),quit:()=>{app.exits=(app.exits||0)+1;app.emit('before-quit')}})
  class Window extends EventEmitter{
    constructor(options){super();this.options=options;this.shows=0;this.visible=false;this.destroyed=false;this.webContents=new EventEmitter();Object.assign(this.webContents,{setWindowOpenHandler:()=>{},send:(...args)=>sent.push(args)});windows.push(this)}
    setAppDetails(){}loadFile(){}loadURL(){}show(){this.shows++;this.visible=true}hide(){this.visible=false}focus(){}isMinimized(){return false}isDestroyed(){return this.destroyed}close(){this.destroyed=true;this.visible=false}destroy(){this.close()}
    static getAllWindows(){return windows.filter(w=>!w.destroyed)}static getFocusedWindow(){return null}
  }
  class Tray extends EventEmitter{setToolTip(){}setContextMenu(){}destroy(){}}
  const image={resize(){return this}}
  const electron={app,BrowserWindow:Window,Tray,Menu:{buildFromTemplate:x=>x},nativeImage:{createFromPath:()=>image},screen:{getPrimaryDisplay:()=>({bounds:{width:1920,height:1080},workAreaSize:{width:1920,height:1040}})},safeStorage:{isEncryptionAvailable:()=>false},ipcMain:{handle:(key,fn)=>channels.set(key,fn)},dialog:{showErrorBox:(...args)=>{throw Error(args.join(' '))}},shell:{}}
  class Game{
    constructor(store,auth,window,activity,instances,state,quit){this.store=store;this.quit=quit;this.running=[];this.console={};Game.current=this}
    getLaunchState(){return {preparing:false,busy:false,session:null}}getRunningInstances(){return this.running}flushPlaytime(){}
    async play(...args){calls.push(args);await delay(10);if(result==='error')throw Error('Fixture launch failed');if(result==='confirmation-required')return {status:result,instances:[]};this.running=[{id:'fixture',profileId,args}];if(this.store.get().settings.exitOnLaunch)this.quit();return {status:'started'}}
  }
  class Engine extends EventEmitter{}
  class Discord{setPlaying(){}clearPlaying(){}shutdown(){}setContext(){}setEnabled(){}}
  const requestArgs=[standalone?'--launch-version=1.20.4':`--launch-profile=${profileId}`,`--launch-account=${accountId}`]
  const args=[process.execPath,...(shortcut&&!second?requestArgs:[])]
  const dependencies={electron,'electron-updater':{NsisUpdater:Engine},'./game':{GameService:Game,message:e=>e.message||String(e)},'./discord':{DiscordPresence:Discord,DISCORD_APPLICATION_ID:'fixture'},'./windows-integration':{appId:'fixture',configureWindows:()=>{},executable:()=>process.execPath,persistentIcon:()=>path.join(process.cwd(),'build/icon.ico'),navigationArgument:()=>null,navigationItems:[]}}
  const env={...process.env,LOCALAPPDATA:root,...(native?{GREEN_LAUNCHER_SPLASH_READY_FILE:ready}:{})}
  delete env.GREEN_LAUNCHER_UPDATE_QA_ROOT;delete env.PORTABLE_EXECUTABLE_FILE
  const load=createSourceLoader({dependencies,process:{...process,argv:args,env},__dirname:path.resolve('src/main')})
  load('src/main/index.ts');await delay(25)
  const main=windows.find(w=>w.options.title==='Green Launcher')
  assert.ok(main)
  for(const win of [...windows])if(!latePaint||win!==main)win.emit('ready-to-show')
  if(shortcut&&!second){assert.equal(main.shows,0,'shortcut first paint never reveals main window');channels.get('launcher:get-state')({})}
  await delay(second?160:550)
  if(latePaint)main.emit('ready-to-show')
  if(second){
    if(!visible)main.hide();main.shows=0
    app.emit('second-instance',{},[process.execPath,...requestArgs])
    await delay(190)
  }
  if(shortcut){
    assert.equal(calls.length,1);assert.equal(calls[0][0],standalone?null:profileId);assert.equal(calls[0][7],true,'shortcut requests the game background mode')
    if(standalone)assert.equal(calls[0][1],'1.20.4')
    assert.equal(main.visible,result!=='started'||second&&visible,'shortcut never reveals a hidden main window')
    if(result==='started'){assert.equal(main.shows,0);assert.equal(!!app.exits,exit);assert.ok(!windows.some(w=>w!==main&&!w.destroyed),'loading window closes after game starts')}
    if(result==='error')assert.ok(sent.some(e=>e[0]==='launcher:shortcutError'))
    if(result==='confirmation-required')assert.ok(sent.some(e=>e[0]==='launcher:launchRequest'))
  }else assert.ok(main.visible,'normal launcher startup still shows the main window')
  if(native)assert.ok(fs.existsSync(ready),'native loading helper receives its completion marker')
  if(!app.exits)app.quit()
  return {root}
}
;(async()=>{
  await scenario();await scenario({native:true});await scenario({exit:true});await scenario({shortcut:false});await scenario({latePaint:true})
  await scenario({result:'error'});await scenario({result:'confirmation-required'});await scenario({second:true});await scenario({second:true,visible:true});await scenario({standalone:true})
  console.log('PASS shortcut cold/native startup, no main-window flash, background game mode, exit preference, normal startup, failure/confirmation recovery and second-instance forwarding; isolated data and mocked game preparation')
})().catch(error=>{console.error(error);process.exitCode=1})
