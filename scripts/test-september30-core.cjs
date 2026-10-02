const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { EventEmitter } = require('node:events')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-september30-'))
const electron = { app: { getPath: name => path.join(root, name) }, screen: {getPrimaryDisplay:()=>({bounds:{width:1920,height:1080}})} }
function load(file, mocks={}, globals={}) {
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText
 const module={exports:{}}
 vm.runInNewContext(source,{module,exports:module.exports,require:n=>n in mocks?mocks[n]:n==='electron'?electron:n==='./download-manager'?{getDownloadManager:()=>undefined}:(n.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), n + '.ts')) ? load(path.resolve(path.dirname(file), n + '.ts')) : require(n)),structuredClone,Buffer,URL,URLSearchParams,AbortSignal,AbortController,console,setTimeout,clearTimeout,setInterval,clearInterval,...globals})
 return module.exports
}
const checks=[]
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS',name)}
async function main(){
 const {LauncherStore}=load('src/main/store.ts')
 const store=new LauncherStore();store.createOfflineAccount('PathFixture')
 const standard=path.join(electron.app.getPath('appData'),'.minecraft')
 const marker=path.join(standard,'screenshots','keep.png');fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,'keep')
 const input={name:'Own world',versionId:'26.1.2',javaPath:'',memoryMb:2048,width:1280,height:720}
 const saved=store.saveProfile({...input,gameDirectory:standard}).profiles[0]
 check('A standard .minecraft override switches to the launcher profile without moving original data',()=>{assert.equal(saved.gameDirectory,'');assert.equal(store.gamePath(saved),store.profilePath(saved.id));assert.equal(fs.readFileSync(marker,'utf8'),'keep')})
 check('Standard child paths are excluded while similarly named sibling directories are allowed',()=>{assert.equal(store.isStandardMinecraftPath(path.join(standard,'versions')),true);assert.equal(store.isStandardMinecraftPath(standard+'-backup'),false);assert.equal(store.gamePath({...saved,gameDirectory:standard+'-backup'}),standard+'-backup')})
 store.updateSettings({javaPath:path.join(standard,'runtime','bin','javaw.exe')})
 check('Legacy standard-folder Java overrides fall back to launcher or system Java',()=>assert.equal(store.get().settings.javaPath,''))
 const stockVersion=path.join(standard,'versions','26.1.2');fs.mkdirSync(stockVersion,{recursive:true});fs.writeFileSync(path.join(stockVersion,'26.1.2.json'),JSON.stringify({id:'26.1.2',type:'release'}));fs.writeFileSync(path.join(stockVersion,'26.1.2.jar'),'stock')
 const {GameService}=load('src/main/game.ts',{'@xmcl/installer':{}})
 const game=new GameService(store,{},()=>null,()=>{})
 check('Standard installed versions are never discovered or selected for launch',()=>assert.equal(game.isInstalled('26.1.2'),false))
 const ownVersion=path.join(store.minecraftPath,'versions','26.1.2');fs.mkdirSync(ownVersion,{recursive:true});fs.writeFileSync(path.join(ownVersion,'26.1.2.json'),JSON.stringify({id:'26.1.2',type:'release'}));fs.writeFileSync(path.join(ownVersion,'26.1.2.jar'),'own')
 check('Launcher versions remain installed and point exclusively to launcher files',()=>{assert.equal(game.isInstalled('26.1.2'),true);assert.equal(game.versionLocation('26.1.2'),ownVersion);assert.equal(game.localVersions().vanilla.get('26.1.2').source,'launcher')})
 const loaderId='26.1.2-forge-65.1.0', loaderRoot=path.join(store.minecraftPath,'versions',loaderId)
 fs.mkdirSync(loaderRoot,{recursive:true});fs.writeFileSync(path.join(loaderRoot,`${loaderId}.json`),JSON.stringify({id:loaderId,inheritsFrom:'26.1.2',libraries:[{name:'net.minecraftforge:forge:65.1.0'}]}))
 check('Installed inherited loader versions appear and can be used by standalone launch',()=>assert.equal(game.isInstalled(loaderId),true))
 check('New profile records the exact installed loader and its Minecraft base',()=>{const spec=game.profileVersion(loaderId);assert.equal(spec.versionId,'26.1.2');assert.equal(spec.modLoader,'forge');assert.equal(spec.modLoaderVersion,loaderId)})
 const {LibraryService}=load('src/main/library.ts',{'../shared/types':{screenshotPageSize:18}})
 const library=new LibraryService(store)
 check('The standard screenshot directory remains an explicit gallery source, alongside profile screenshots',()=>{const folders=library.screenshotFolders();assert.equal(folders.find(f=>f.profileId===null).path,path.dirname(marker));assert.equal(folders.find(f=>f.profileId===saved.id).path,path.join(store.profilePath(saved.id),'screenshots'))})
 const requests=[]
 const {ModrinthService}=load('src/main/modrinth.ts',{'./store':{},'./modrinth-download':{}},{fetch:async url=>{requests.push(new URL(url));return{ok:true,json:async()=>[{id:'abcd1234',version_number:'2.0',game_versions:['26.3'],loaders:['fabric'],name:'Release',version_type:'release'}]}}})
 const modrinth=new ModrinthService(store)
 await modrinth.versions('abcd1234','26.1.2','fabric');await modrinth.versions('abcd1234','26.1.2','fabric',true)
 check('Other-version browsing removes only the Minecraft version restriction and preserves loader filtering',()=>{assert.equal(requests[0].searchParams.get('game_versions'),'["26.1.2"]');assert.equal(requests[1].searchParams.has('game_versions'),false);assert.equal(requests[1].searchParams.get('loaders'),'["fabric"]')})
 const clients=[], activities=[];let clears=0
 class Client extends EventEmitter {
  isConnected=false
  user={setActivity:async activity=>activities.push(activity),clearActivity:async()=>{clears++}}
  constructor(){super();clients.push(this)}
  async login(){this.isConnected=true}
  async destroy(){this.isConnected=false}
 }
 const {DiscordPresence}=load('src/main/discord.ts',{'@xhayper/discord-rpc':{Client}})
 const presence=new DiscordPresence('fixture',true)
 const settle=async()=>{for(let i=0;i<30&&presence.syncing;i++)await new Promise(r=>setTimeout(r,1));assert.equal(presence.syncing,false)}
 await settle();check('Enabled Discord activity publishes launcher details and the registered asset immediately',()=>{assert.equal(activities[0].details,'Ana sayfaya bakıyor');assert.equal(activities[0].largeImageKey,'green_launcher_slime')})
 presence.setLauncherContext({page:'mods',section:'modrinth',contentType:'mod'});await new Promise(r=>setTimeout(r,800));await settle()
 check('Navigation publishes the provider and content type without resetting the launcher timer',()=>{assert.equal(activities.at(-1).details,'Modrinth modlarına bakıyor');assert.equal(activities.at(-1).startTimestamp,activities[0].startTimestamp)})
 presence.setLauncherContext({page:'mods',section:'technic',contentType:'modpack',favorites:true});presence.setLauncherContext({page:'account',section:'capes'});const before=activities.length;await new Promise(r=>setTimeout(r,800));await settle()
 check('Rapid navigation publishes only the latest page context',()=>{assert.equal(activities.length,before+1);assert.equal(activities.at(-1).details,'Pelerinlerini görüntülüyor')})
 presence.setPlaying('26.1.2');await settle();const count=activities.length,time=activities.at(-1).startTimestamp
 presence.setLauncherContext({page:'mods',section:'technic',contentType:'modpack'});await new Promise(r=>setTimeout(r,800));await settle()
 check('Playing Minecraft takes precedence over launcher navigation',()=>assert.equal(activities.length,count))
 presence.setPlaying('26.1.2');await settle();check('Repeated game events preserve the elapsed game timer without redundant presence updates',()=>{assert.equal(activities.length,count);assert.equal(activities.at(-1).startTimestamp,time);assert.match(activities.at(-1).details,/26.1.2/)})
 presence.clearPlaying();await settle();check('Ending the game restores launcher activity while keeping the connection',()=>{assert.equal(activities.at(-1).details,'Technic mod paketlerine bakıyor');assert.equal(clients.length,1)})
 clients[0].emit('disconnected');presence.requestSync();await settle();check('Discord reconnects and republishes activity after the socket is lost',()=>{assert.equal(clients.length,2);assert.equal(activities.at(-1).details,'Technic mod paketlerine bakıyor')})
 presence.setEnabled(false);await settle();check('Disabling the preference clears activity and closes the RPC connection',()=>{assert.equal(clears,1);assert.equal(clients.at(-1).isConnected,false)})
 presence.shutdown();await settle()
 fs.writeFileSync('build/qa-september30-core-results.json',JSON.stringify({passed:true,checks,temporaryData:root},null,2))
}
main().catch(error=>{console.error(error);process.exitCode=1})
