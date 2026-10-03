// Isolated renderer fixture. Uploads and clipboard writes never leave the fixture.
const { ipcMain, BrowserWindow } = require('electron')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const mod = {exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/game-console.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require,structuredClone,Buffer,AbortSignal,setTimeout,clearTimeout})
const {GameConsole,publishGameLog}=mod.exports
const send=(event,value)=>{for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send('launcher:'+event,value)}
const logs=new GameConsole(change=>send('gameLog',change)), sessions=new Map()
let copied='', uploads=[], failUpload=false, failRead=false
const start=(id,profileId='qa-profile',pid=9001)=>{const instance={id,profileId,pid,profileName:profileId==='qa-profile'?'Test World':'Test World 2',accountId:'qa-offline',accountName:'DesignQA',versionId:'1.21.1',startedAt:new Date().toISOString()};sessions.set(id,instance);logs.begin(instance,['fixture-private-token']);send('instances',[...sessions.values()])}
start('log-first');start('log-second','qa-profile',9002);start('log-other-profile','qa-profile-1',9003)
logs.append('log-first','[12:00:00] [main/INFO]: First instance only')
logs.append('log-other-profile','[12:00:00] [main/INFO]: Other profile only')
for(const line of ['[12:00:00] [main/INFO]: Minecraft started','[12:00:01] [main/WARN]: Test warning','[12:00:02] [main/ERROR]: Test error','[12:00:03] [main/DEBUG]: Debug message','[12:00:04] [main/INFO]: <script>window.fixtureInjected=true</script>','[12:00:05] [main/INFO]: fixture-private-token','[12:00:06] [main/INFO]: '+('Very long world output '.repeat(55))])logs.append('log-second',line)
const register=ipcMain.handle.bind(ipcMain)
ipcMain.handle=(channel,handler)=>register(channel,async(event,...args)=>{
  if(channel==='launcher:get-running-instances')return [...sessions.values()]
  if(channel==='launcher:save-settings'&&args[0]?.qaGameLog){
    const {qaGameLog:control,...settings}=args[0];args[0]=settings
    if(control.start)start(control.start,control.profileId,control.pid)
    if(control.append){let level='info';for(const line of control.append)level=logs.append(control.id??'log-second',line,level)}
    if(control.launcher)for(const line of control.launcher)logs.append(control.id??'log-second',line,'launcher')
    if(control.stream){const stream=new (require('node:stream').PassThrough)();logs.attach(control.id??'log-second',stream,'info');stream.end(control.stream)}
    if(control.consoleRequest)send('consoleRequest',control.consoleRequest)
    if(control.finish){logs.finish(control.finish);sessions.delete(control.finish);send('instances',[...sessions.values()])}
    if(control.failUpload!==undefined)failUpload=control.failUpload
    if(control.failRead!==undefined)failRead=control.failRead
  }
  const result=await handler(event,...args)
  return channel==='launcher:get-state'?{...result,qaCopiedLog:copied,qaLogUploads:uploads}:result
})
register('launcher:get-game-log',(_event,profile,id,after)=>{if(failRead)throw Error('Oyun günlüğü bulunamadı.');return logs.snapshot(profile,id,after)})
register('launcher:clear-game-log',(_event,profile,id)=>logs.clear(profile,id))
register('launcher:copy-game-log',(_event,profile,id)=>{copied=logs.content(profile,id)})
register('launcher:upload-game-log',async(_event,profile,id)=>{
  const url=await publishGameLog(logs,profile,id,{started:'Günlük yüklemesi başlatıldı.',success:'Günlük mclo.gs’a yüklendi.',failed:'Günlük yüklenemedi. İnternet bağlantını kontrol edip yeniden dene.'},async(endpoint,options)=>{uploads.push({endpoint,content:JSON.parse(options.body).content});await new Promise(resolve=>setTimeout(resolve,180));return {ok:!failUpload,json:async()=>({success:true,id:'Fixture123',url:'https://mclo.gs/Fixture123'})}})
  copied=url;return url
})
require('./qa-profile-workspace-launch.cjs')
