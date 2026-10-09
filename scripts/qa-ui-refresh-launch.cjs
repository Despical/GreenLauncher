// Renderer-only fixture: all state stays in memory and Chromium uses a separate
// directory. No launcher services, login endpoints or user data are touched.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
const dataPath = fs.mkdtempSync(path.join(root, 'build', 'qa-ui-refresh-'))
app.setPath('userData', dataPath)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('remote-debugging-port', process.env.GREEN_QA_DEBUG_PORT || '9225')
const withAnalytics = process.argv.includes('--qa-analytics')
if (withAnalytics) ipcMain.handle('launcher:get-resource-packs', () => [])
const withProfileTools = process.argv.includes('--qa-profile-tools')
const withOctober = process.argv.includes('--qa-october')
const withContent = process.argv.includes('--qa-content')
const withSkin = process.argv.includes('--qa-skin')
const withOfficial = process.argv.includes('--qa-microsoft')
const withWorlds = process.argv.includes('--qa-worlds')
const withProfileServers = process.argv.includes('--qa-profile-servers')
let qaUpdate = { phase: 'current', currentVersion: require('../package.json').version, portable: false, checkedAt: new Date().toISOString() }, qaDownloadResolve, qaUpdateDownloads=0, qaImportedUpdate
const updateChanged = () => {
  if(!qaUpdate.lastInstalled)qaImportedUpdate=undefined
  if(qaUpdate.phase==='ready'){
    qaUpdate.downloadedAt ??= new Date().toISOString()
    const id=`launcher-update-${qaUpdate.version}`
    downloadJobs=[{id,launcherVersion:qaUpdate.version,title:`Green Launcher · v${qaUpdate.version}`,phase:'completed',detail:'Yeniden başlatmaya hazır',downloadedBytes:qaUpdate.total??0,totalBytes:qaUpdate.total??0,bytesPerSecond:0,filesDone:1,filesTotal:1,forLaunch:false,paused:false,priority:0,createdAt:qaUpdate.downloadedAt,finishedAt:qaUpdate.downloadedAt},...downloadJobs.filter(job=>job.id!==id)]
  }
  if(qaUpdate.lastInstalled&&qaImportedUpdate!==qaUpdate.lastInstalled.version){
    qaImportedUpdate=qaUpdate.lastInstalled.version
    const id=`launcher-update-${qaImportedUpdate}`
    downloadJobs=[{id,launcherVersion:qaImportedUpdate,title:`Green Launcher · v${qaImportedUpdate}`,phase:'completed',detail:'Güncelleme başarıyla tamamlandı.',downloadedBytes:0,totalBytes:0,bytesPerSecond:0,filesDone:1,filesTotal:1,forLaunch:false,paused:false,priority:0,createdAt:qaUpdate.lastInstalled.at,finishedAt:qaUpdate.lastInstalled.at},...downloadJobs.filter(job=>job.id!==id)]
  }
  window?.webContents.send('launcher:downloads',downloadSnapshot());window?.webContents.send('launcher:update', qaUpdate)
  if (qaDownloadResolve && !['checking','downloading'].includes(qaUpdate.phase)) { const finish = qaDownloadResolve; qaDownloadResolve = undefined; finish({ ...qaUpdate }) }; return { ...qaUpdate }
}
let fixtureSkin = null
let fixtureCape = null
if (withSkin) {
  // Deterministic 64x64 RGBA-compatible skin layout for rendering checks only.
  const bitmap = Buffer.alloc(64 * 64 * 4)
  const fill = (x, y, width, height, [red, green, blue]) => {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
      const offset = (row * 64 + col) * 4
      bitmap[offset] = blue; bitmap[offset + 1] = green; bitmap[offset + 2] = red; bitmap[offset + 3] = 255
    }
  }
  fill(0, 0, 32, 16, [188, 139, 94])
  fill(0, 0, 32, 8, [80, 47, 29])
  fill(8, 8, 8, 2, [80, 47, 29])
  fill(9, 11, 2, 1, [40, 61, 89]); fill(13, 11, 2, 1, [40, 61, 89])
  fill(11, 14, 3, 1, [102, 58, 40])
  fill(16, 16, 24, 16, [51, 143, 87])
  fill(40, 16, 16, 16, [188, 139, 94]); fill(32, 48, 16, 16, [188, 139, 94])
  fill(0, 16, 16, 16, [54, 76, 141]); fill(16, 48, 16, 16, [54, 76, 141])
  fixtureSkin = nativeImage.createFromBitmap(bitmap, { width: 64, height: 64 }).toDataURL()
  const cape = Buffer.alloc(64 * 32 * 4)
  for (let i = 0; i < cape.length; i += 4) { cape[i] = 55; cape[i + 1] = 92; cape[i + 2] = 186; cape[i + 3] = 255 }
  fixtureCape = nativeImage.createFromBitmap(cape, { width: 64, height: 32 }).toDataURL()
}
let window
let connected = false
const state = {
  settings: { language: 'tr', javaPath: '', memoryMb: 4096, width: 1280, height: 720, closeOnLaunch: false, showSnapshots: false, animateHero: false, discordPresence: false, minimizeToTray: false },
  accounts: [{ id: 'qa-offline', name: 'DesignQA', kind: withOfficial ? 'microsoft' : 'offline', homeAccountId: '' }], selectedAccountId: 'qa-offline',
  profiles: withContent ? Array.from({length:5},(_,i)=>({id:i===0?'qa-profile':`qa-profile-${i}`,name:i===0?'Test World':`Test World ${i+1}`,versionId:'1.21.1',modLoader:'fabric',modLoaderVersion:'1.21.1-fabric',memoryMb:4096,width:1280,height:720,javaPath:'',createdAt:new Date().toISOString()})) : [], selectedProfileId: withContent ? 'qa-profile' : null, selectedVersionId: '1.21.1', playHistory: [], dataPath
}
let entries = Array.from({ length: 24 }, (_, index) => ({
  id: `fixture-${index}`, at: new Date(Date.parse('2026-09-29T15:06:19Z') - index * 61000).toISOString(),
  source: index % 2 ? 'Oyun' : 'Oturum', code: index % 2 ? 'NETWORK_ERROR' : 'AUTH_EXPIRED',
  message: index % 2 ? `Sunucuya bağlanılamadı. İnternet bağlantını kontrol edip yeniden dene. Kayıt ${index + 1}.` : `Microsoft oturumunun süresi dolmuş olabilir. Hesaptan çıkıp tekrar giriş yap. Kayıt ${index + 1}.`
}))
if (withOctober) {
  Object.assign(state.profiles[1], { name: 'Fabulously Optimized', versionId: '1.20.4', modLoaderVersion: '1.20.4-fabric', modpack: { projectId: 'qaPack123', versionId: 'qaVer123', title: 'Fabulously Optimized', fileCount: 25 }, cover: { color: '#567fa3', description: 'Arkadaşlarla macera' } })
  state.profiles[0].cover = { color: '#c59b55', description: '' }
  state.profiles[2].cover = { color: '#9172a8', description: 'Dünyalarını keşfet, kendi maceranı oluştur.', image: nativeImage.createFromPath(path.join(root, 'src', 'renderer', 'assets', 'green-landscape.png')).resize({ width: 640 }).toDataURL() }
}
const snapshots = { fileOpened: 0, externalOpened: [], connections: 0 }
const launches = []
const running = process.argv.includes('--qa-running') ? Array.from({length:2}, (_,index)=>({id:`qa-instance-${index}`,pid:9000+index,profileId:'qa-profile',profileName:'Test World',accountId:'qa-offline',accountName:'DesignQA',versionId:'1.21.1-fabric',loader:'fabric',startedAt:new Date().toISOString()})) : []
const rendererState = () => {
  if (!withAnalytics) return state
  const profiles = state.profiles.filter(profile => (profile.accountId ?? 'qa-offline') === state.selectedAccountId)
  const ids = new Set(profiles.map(profile => profile.id))
  return { ...state, profiles, selectedProfileId: ids.has(state.selectedProfileId) ? state.selectedProfileId : profiles[0]?.id ?? null, playSessions: (state.playSessions ?? []).filter(session => ids.has(session.profileId)) }
}
const changed = () => { const current = rendererState(); window.webContents.send('launcher:state', structuredClone(current)); window.webContents.send('launcher:downloads', downloadSnapshot()); return current }
const handle = (name, handler) => ipcMain.handle(`launcher:${name}`, (_event, ...args) => handler(...args))
handle('get-state', () => ({...rendererState(),qaPresence:presenceContext,qaProjectRequests:projectRequests,qaLaunches:launches,qaExternalOpened:snapshots.externalOpened,qaUpdateDownloads}))
handle('play', (profileId, allowAdditional, versionId, serverAddress, serverPreference, worldId) => { launches.push({profileId,allowAdditional,versionId,serverAddress,serverPreference,worldId});return running.length && !allowAdditional ? {status:'confirmation-required',instances:running} : {status:'started'} })
handle('play-version', (versionId, allowAdditional, serverAddress, serverPreference, temporaryOfflineName) => { launches.push({profileId:null,versionId,allowAdditional,serverAddress,serverPreference,temporaryOfflineName});return {status:'started'} })
handle('get-profile-mods-path', id => id === 'qa-profile-2' ? null : path.join(dataPath,'profiles',id,'mods'))
handle('open-profile-mods', id => { snapshots.externalOpened.push('mods:'+id) })
const qaServers = [{id:'qa-server',name:'Green Community',address:'play.example.org:25565',createdAt:new Date().toISOString()},{id:'qa-offline-server',name:'Survival dünyam',address:'localhost:25567',createdAt:new Date().toISOString()}]
let profileServerService
if (withProfileServers) {
  const ts = require('typescript'), vm = require('node:vm')
  function loadServerModule(file) {
    const mod = { exports: {} }
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:name=>name.startsWith('.')?loadServerModule(path.resolve(path.dirname(file),name+'.ts')):require(name),Buffer,structuredClone,URL,setTimeout,clearTimeout,performance})
    return mod.exports
  }
  const { ProfileServers } = loadServerModule(path.join(root,'src/main/profile-servers.ts'))
  fs.writeFileSync(path.join(dataPath,'servers.json'),JSON.stringify(qaServers))
  profileServerService = new ProfileServers({dataPath,get:()=>structuredClone(state),profilePath:id=>path.join(dataPath,'profiles',id),gamePath:profile=>path.join(dataPath,'profiles',profile.id)})
}
if (withWorlds) {
  const ts=require('typescript'),vm=require('node:vm'),nbt=require('prismarine-nbt'),zlib=require('node:zlib')
  function load(file) { const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n),Buffer,Date});return mod.exports }
  const {WorldService}=load(path.join(root,'src/main/worlds.ts'))
  const service=new WorldService({get:()=>structuredClone(state),gamePath:p=>path.join(dataPath,'profiles',p.id)})
  const create=(dir,name,mode=0,seed=[2147483647,-1])=>{
    fs.mkdirSync(path.join(dir,'region'),{recursive:true})
    fs.writeFileSync(path.join(dir,'region/r.0.0.mca'),Buffer.alloc(2*1024**2))
    const played=BigInt(Date.parse('2026-10-02T10:00:00Z'))
    const document={type:'compound',name:'',value:{Data:{type:'compound',value:{
      LevelName:{type:'string',value:name},GameType:{type:'int',value:mode},
      LastPlayed:{type:'long',value:[Number(played>>32n),Number(played&0xffffffffn)|0]},
      WorldGenSettings:{type:'compound',value:{seed:{type:'long',value:seed}}},
      Version:{type:'compound',value:{Name:{type:'string',value:'1.21.1'}}}
    }}}}
    fs.writeFileSync(path.join(dir,'level.dat'),zlib.gzipSync(nbt.writeUncompressed(document)))
  }
  create(path.join(dataPath,'profiles/qa-profile/saves/Adventure'),'Uzun zamandır oynadığım hayatta kalma dünyam')
  fs.writeFileSync(path.join(dataPath,'profiles/qa-profile/saves/Adventure/icon.png'),nativeImage.createFromPath(path.join(root,'src/renderer/assets/minecraft-release.png')).resize({width:64,height:64}).toPNG())
  create(path.join(dataPath,'profiles/qa-profile/saves/Creative'),'Yaratıcı dünyam',1,[-2147483648,0])
  const modern=path.join(dataPath,'profiles/qa-profile/saves/Creative')
  const modernDoc=nbt.parseUncompressed(zlib.gunzipSync(fs.readFileSync(path.join(modern,'level.dat'))));delete modernDoc.value.Data.value.WorldGenSettings
  modernDoc.value.Data.value.Version.value.Name.value='26.3'
  fs.writeFileSync(path.join(modern,'level.dat'),zlib.gzipSync(nbt.writeUncompressed(modernDoc)))
  fs.mkdirSync(path.join(modern,'data/minecraft'),{recursive:true})
  fs.writeFileSync(path.join(modern,'data/minecraft/world_gen_settings.dat'),zlib.gzipSync(nbt.writeUncompressed({type:'compound',name:'',value:{data:{type:'compound',value:{seed:{type:'long',value:[-2147483648,0]}}},DataVersion:{type:'int',value:5000}}})))
  create(path.join(dataPath,'profiles/qa-profile-2/saves/Legacy'),'Eski dünyam')
  state.profiles[2].versionId='1.8.9';state.profiles[2].modLoaderVersion=undefined;state.profiles[2].modLoader=undefined
  const external=path.join(dataPath,'Imported world');create(external,'Elle eklenen dünya')
  handle('get-worlds',(id,refresh)=>service.list(id,refresh))
  handle('import-world',id=>service.import(id,external))
  handle('rename-world',(profile,id,name)=>service.rename(profile,id,name))
  handle('duplicate-world',(profile,id,name)=>service.duplicate(profile,id,name))
  handle('reset-world-icon',(profile,id)=>service.resetIcon(profile,id))
  handle('copy-world-seed',async(profile,id)=>{snapshots.externalOpened.push('seed:'+(await service.list(profile)).find(w=>w.id===id).seed)})
  handle('open-world-folder',async(profile,id)=>{snapshots.externalOpened.push(await service.path(profile,id))})
  handle('delete-world',(profile,id)=>service.delete(profile,id,async folder=>{fs.mkdirSync(path.join(dataPath,'recycle'),{recursive:true});fs.renameSync(folder,path.join(dataPath,'recycle',path.basename(folder))) }))
}
let qaServerChecks = 0, qaCustomImported = false
handle('get-servers', profileId => withProfileServers ? profileServerService.forProfile(profileId).get() : qaServers)
handle('get-update', () => ({ ...qaUpdate }))
handle('qa-set-update', update => { qaUpdate = { ...qaUpdate, ...update }; return updateChanged() })
handle('check-update', async () => { qaUpdate.phase = 'checking'; updateChanged(); await new Promise(resolve => setTimeout(resolve, 120)); qaUpdate.phase = qaUpdate.error ? 'error' : qaUpdate.version ? 'available' : 'current'; qaUpdate.checkedAt = new Date().toISOString(); return updateChanged() })
handle('download-update', () => { if(['ready','checking','downloading','installing'].includes(qaUpdate.phase))return {...qaUpdate};qaUpdateDownloads++;qaUpdate.downloadedAt=undefined;qaUpdate.error=undefined;qaUpdate.operation='download';qaUpdate.phase = 'downloading'; qaUpdate.percent = 42; qaUpdate.transferred = 4200000; qaUpdate.total = 10000000;qaUpdate.bytesPerSecond=2400000;qaUpdate.peakBytesPerSecond=3100000;qaUpdate.estimatedSeconds=3; updateChanged(); return new Promise(resolve => { qaDownloadResolve = resolve }) })
handle('cancel-update', () => { qaUpdate.phase = 'available'; qaUpdate.percent = undefined; return updateChanged() })
handle('install-update', () => { qaUpdate.error = 'busy';qaUpdate.operation='install'; return updateChanged() })
handle('reorder-servers', (ids,profileId) => {if(withProfileServers)return profileServerService.forProfile(profileId).reorder(ids);const next=ids.map(id=>qaServers.find(server=>server.id===id));qaServers.splice(0,qaServers.length,...next);return qaServers})
handle('refresh-server', async (id,profileId) => { qaServerChecks++; await new Promise(resolve=>setTimeout(resolve,100)); const item=(withProfileServers?profileServerService.forProfile(profileId).get():qaServers).find(server=>server.id===id); const tableQA=process.argv.includes('--qa-server-table'); return {id,address:item.address,online:item.address!=='localhost:25567',checkedAt:new Date().toISOString(),version:'Paper 1.21.1',players:tableQA?28605:id==='qa-server'?17:42,maxPlayers:tableQA?200000:80,latency:26,icon:tableQA&&id==='qa-server'?'data:image/png;base64,'+fs.readFileSync(path.join(root,'build','launcher-mark.png')).toString('base64'):undefined,motd:tableQA?[{text:'        Hypixel Network [1.8/26.3]\n',color:'#55ff55'},{text:'     SKYBLOCK 0.27.1 TORRHUS & SAFARI',color:'#ffaa00',bold:true}]:[{text:'Green Community\n',color:'#ffaa00',bold:true},{text:'Survival · Creative · Parkour',color:'#aaaaaa'}],sample:['Steve','Alex','GreenPlayer']} })
handle('save-server', (server,profileId) => { if(withProfileServers)return profileServerService.forProfile(profileId).save(server); if(server.id)Object.assign(qaServers.find(item=>item.id===server.id),server);else qaServers.push({...server,id:'qa-added-'+qaServers.length,createdAt:new Date().toISOString()});return qaServers })
handle('delete-server', (id,profileId) => { if(withProfileServers)return profileServerService.forProfile(profileId).delete(id); const index=qaServers.findIndex(item=>item.id===id);if(index>=0)qaServers.splice(index,1);return qaServers })
handle('qa-server-checks', () => qaServerChecks)
handle('qa-clear-profiles', () => { state.profiles=[];state.selectedProfileId=null;return changed() })
handle('import-custom-client', () => { qaCustomImported=true;return {id:'1.8.9-SPECIAL',versions:[...qaVersions(),{id:'1.8.9-SPECIAL',custom:true,type:'release',releaseTime:'2015-12-09',url:'',installed:true,optifineVersions:[]}]} })
handle('get-profile-mods', profileId => profileId === 'qa-profile-2' ? [] : [{provider:'modrinth',projectId:'qa',title:'Sodium',filename:'sodium-0.6.0.jar',versionNumber:'0.6.0',versionId:'qa'}, {projectId:'',title:'friends-mod',filename:'friends-mod.jar',versionNumber:'',versionId:''}])
if (!process.argv.includes('--qa-profile-content')) {
  handle('get-profile-content', (profileId, kind) => kind === 'mod' && profileId !== 'qa-profile-2' ? [{ provider: 'modrinth', projectId: 'qa', title: 'Sodium', filename: 'sodium-0.6.0.jar', versionNumber: '0.6.0', versionId: 'qa', enabled: true, description: '', modifiedAt: '2026-10-03' }, { title: 'friends-mod', filename: 'friends-mod.jar.disabled', enabled: false, description: '', modifiedAt: '2026-10-03' }] : [])
  handle('check-profile-content-updates', () => [])
}

let projectRequests = 0
let presenceContext = null
handle('set-presence-context', context => { presenceContext = context })
handle('qa-presence-context', () => presenceContext)
handle('select-version', id => { state.selectedVersionId=id; return changed() })
handle('select-account', id => { state.selectedAccountId=id; return changed() })
handle('create-offline-account', name => { const account={id:`qa-account-${state.accounts.length}`,name,kind:'offline',homeAccountId:''};state.accounts.push(account);state.selectedAccountId=account.id;return changed() })
const qaVersions = () => [{ id: '1.21.1', type: 'release', releaseTime: '2024-08-08', url: '', installed: true, optifineVersions: [] }, ...(process.argv.includes('--qa-server-join') ? [...Array.from({length:120},(_,i)=>({id:`1.20.${i}`,type:'release',releaseTime:'2023-12-07',url:'',installed:false,optifineVersions:[]})), ...['1.8.9','1.8','1.7.10','1.6.4','1.5.2','1.0'].map(id=>({id,type:'release',releaseTime:'2014-09-02',url:'',installed:false,optifineVersions:[]})),{id:'24w02a',type:'snapshot',releaseTime:'2024-01-10',url:'',installed:false,optifineVersions:[]}] : []), ...(process.argv.includes('--qa-reorder') ? [{id:'1.20.4',type:'release',releaseTime:'2023-12-07',url:'',installed:true,optifineAvailable:true,optifineVersions:[]}] : [])]
handle('get-versions', () => [...qaVersions(),...(qaCustomImported?[{id:'1.8.9-SPECIAL',custom:true,type:'release',releaseTime:'2015-12-09',url:'',installed:true,optifineVersions:[]}]:[])])
handle('save-settings', settings => { const { qaUpdate: update, qaPlaySessions, qaDownloads, qaActivity, ...saved } = settings; if (qaPlaySessions) state.playSessions = qaPlaySessions; if (qaDownloads) downloadJobs = qaDownloads; if (qaActivity) window.webContents.send('launcher:activity', qaActivity); if (update) { qaUpdate = { ...qaUpdate, ...update }; updateChanged() }; Object.assign(state.settings, saved); return changed() })
handle('sign-out', () => { state.accounts = []; state.selectedAccountId = null; return changed() })
handle('get-account-skin', () => fixtureSkin)
let activeCape = 'minecraft:qa'
const mockCapes = () => fixtureSkin ? [
  { id: 'minecraft:qa', name: 'Purple Heart', source: 'minecraft', image: fixtureCape, active: activeCape === 'minecraft:qa' },
  { id: 'minecraft:qb', name: '15th Anniversary', source: 'minecraft', image: fixtureCape, active: activeCape === 'minecraft:qb' },
  { id: 'optifine', name: 'OptiFine', source: 'optifine', image: fixtureCape, active: false }
] : []
handle('get-account-capes', mockCapes)
handle('set-account-cape', (_id, capeId) => { if (!withOfficial || !['none', 'minecraft:qa', 'minecraft:qb'].includes(capeId)) throw new Error('QA cape denied'); activeCape = capeId; return mockCapes() })
handle('get-screenshots', () => fixtureSkin ? [{ id: 'qa-shot', profileId: null, name: 'QA screenshot', modifiedAt: '2026-09-30T10:00:00Z', thumbnail: fixtureSkin }] : [])
handle('get-screenshot', () => nativeImage.createFromDataURL(fixtureSkin).resize({ width: 128, height: 128 }).toDataURL())
handle('get-screenshot-preview', () => nativeImage.createFromDataURL(fixtureSkin).resize({ width: 128, height: 128 }).toDataURL())
handle('get-running-instances', () => running)
handle('get-offline-status', () => ({ accountReady: true, versionReady: true }))
handle('get-disk-usage', () => ({ profiles: state.profiles.map(item => ({ id: item.id, name: item.name, bytes: 300000000 })), sharedBytes: 900000000, totalBytes: 2400000000 }))
handle('get-cleanup-preview', () => (process.argv.includes('--qa-final-polish') ? { logs: 10240, crashReports: 0, versions: 0, bytes: 10240, items: [{path:'C:\\Users\\DesignQA\\AppData\\Roaming\\GreenLauncher\\profiles\\qa-profile\\logs\\latest.log',kind:'logs',bytes:10240}] } : { logs: 0, crashReports: 0, versions: 0, bytes: 0, items: [] }))
handle('get-error-log', () => entries)
handle('clear-error-log', () => { entries = []; window.webContents.send('launcher:errorLog', []); return [] })
handle('open-error-log', () => { snapshots.fileOpened++; return snapshots })
handle('get-provider-status', () => ({ curseforge: connected }))
handle('get-mod-categories', () => [])
let favorites=[],catalogDownloads=235123
handle('get-mod-favorites',refresh=>{
  if(refresh&&process.argv.includes('--qa-catalog-refresh')){
    catalogDownloads=876543
    favorites=favorites.map(item=>({...item,downloads:catalogDownloads,description:'Fresh catalog metadata.'}))
    window.webContents.send('launcher:modFavorites',favorites)
  }
  return favorites
})
handle('set-mod-favorite',(item,saved)=>{favorites=favorites.filter(f=>f.provider!==item.provider||f.projectId!==item.projectId);if(saved)favorites.unshift(item);return favorites})
const hit=(provider,type)=>({projectId:provider==='technic'?'qa-technic':type==='modpack'?'qaPack123':'qaMod123',slug:'qa-project',title:provider==='technic'?'Technic Adventure':type==='modpack'?'World Explorer Pack':'Better Worlds',description:'A detailed project description for visual and interaction checks.',author:'DesignQA',iconUrl:null,downloads:catalogDownloads,updated:'2026-09-30T10:00:00Z',categories:['adventure']})
handle('search-mods',(_q,_g,_l,_s,_o,_c,type,provider)=>withContent?({total:withProfileTools?2:1,hits:[hit(provider,type),...(withProfileTools?[{...hit(provider,type),projectId:'qaMore123',title:'Another Great Mod'}]:[])]}):({total:0,hits:[]}))
handle('get-mod-project',(id,provider)=>{projectRequests++;return {...hit(provider,id==='qaPack123'?'modpack':'mod'),id,title:id==='qaMore123'?'Another Great Mod':hit(provider,id==='qaPack123'?'modpack':'mod').title,body:'Explore new worlds with this test project. This fixture contains no actual downloadable content.',license:'MIT',sourceUrl:provider==='technic'?'https://www.technicpack.net/modpack/qa':'https://modrinth.com/mod/qa-project',projectType:provider==='technic'||id==='qaPack123'?'modpack':'mod'}})
handle('get-mod-versions',(id,_g,_l,provider,all)=>[{id:provider==='technic'?'qa-technic:recommended':id==='qaMore123'?'qaVerMore':'qaVer123',name:'Release',versionNumber:'1.0.0',type:'release',published:'2026-09-30',downloads:100,gameVersions:['1.21.1'],loaders:['fabric']},...(all?[{id:'qaOther123',name:'Other release',versionNumber:'2.0.0',type:'beta',published:'2026-09-30',downloads:1,gameVersions:['26.3'],loaders:['fabric']},...(withOctober?Array.from({length:24},(_,i)=>({id:`qaOther${i}`,name:'Other release',versionNumber:`15.0.0-alpha.${i}`,type:'alpha',published:'2026-09-30',downloads:1,gameVersions:['26.3'],loaders:['fabric']})):[])]:[])])
let downloadsPaused=false
let downloadJobs=withContent?[
{id:'qa-active',title:'Minecraft 1.21.1',phase:'downloading',detail:'client.jar',estimatedSeconds:23,peakBytesPerSecond:3100000,downloadedBytes:45000000,totalBytes:100000000,bytesPerSecond:2400000,filesDone:123,filesTotal:410,paused:false,priority:0,forLaunch:false,createdAt:new Date().toISOString()},
{id:'qa-queued',title:'Mod paketi kurulumu',phase:'queued',detail:'Adventure World',downloadedBytes:0,totalBytes:0,bytesPerSecond:0,filesDone:0,filesTotal:0,paused:false,priority:0,forLaunch:false,createdAt:new Date().toISOString()},
{id:'qa-completed',title:'Fabric 1.21.1',phase:'completed',detail:'',downloadedBytes:4000000,totalBytes:4000000,bytesPerSecond:0,filesDone:12,filesTotal:12,paused:false,priority:0,forLaunch:false,createdAt:new Date().toISOString()}]:[]
if (withOctober) for (const loader of ['Forge','Quilt','NeoForge','LiteLoader']) downloadJobs.push({...downloadJobs.find(job=>job.phase==='completed'),id:`qa-completed-${loader}`,title:`${loader} · Minecraft 1.21.1`})
if (process.argv.includes('--qa-reorder')) downloadJobs.push({...downloadJobs[1],id:'qa-queued-two',title:'Mod kurulumu',detail:'Better Worlds'})
const downloadSnapshot=()=>({jobs:downloadJobs.map(job=>({...job,queued:job.phase==='queued',phase:downloadsPaused||job.paused?'paused':job.phase})),paused:downloadsPaused,playing:false,speedLimitKiB:state.settings.downloadSpeedLimitKiB??0,concurrency:state.settings.downloadConcurrency??6,pauseWhilePlaying:state.settings.pauseDownloadsWhilePlaying===true})
handle('get-downloads',downloadSnapshot)
handle('control-downloads',(action,id,beforeId)=>{const job=downloadJobs.find(j=>j.id===id);if(action==='pause-all')downloadsPaused=true;if(action==='resume-all'){downloadsPaused=false;downloadJobs.forEach(j=>j.paused=false)}if(action==='pause'&&job)job.paused=true;if(action==='resume'&&job){downloadsPaused=false;job.paused=false}if(action==='prioritize'&&job)job.priority=101;if(action==='reorder'&&job){const queue=downloadJobs.filter(j=>!['completed','failed'].includes(j.phase)&&j!==job).sort((a,b)=>b.priority-a.priority);const index=beforeId?queue.findIndex(j=>j.id===beforeId):queue.length;const previous=queue[index-1],next=queue[index];job.priority=previous&&next?(previous.priority+next.priority)/2:next?next.priority+1:previous?previous.priority-1:0;downloadJobs.splice(downloadJobs.indexOf(job),1);if(next)downloadJobs.splice(downloadJobs.indexOf(next),0,job);else downloadJobs.push(job)}if(action==='clear')downloadJobs=downloadJobs.filter(j=>!['completed','failed'].includes(j.phase));const snapshot=downloadSnapshot();window.webContents.send('launcher:downloads',snapshot);return snapshot})
let installedMods=[]
handle('get-installed-mods', () => installedMods)
handle('install-mod', async (profileId,versionId,provider,content) => {
  const job={id:'qa-install-'+versionId,title:content.title,profileId,phase:'queued',detail:'',downloadedBytes:0,totalBytes:0,bytesPerSecond:0,filesDone:0,filesTotal:0,paused:false,priority:0,forLaunch:false,createdAt:new Date().toISOString()}
  downloadJobs.push(job);changed()
  await new Promise(resolve=>setTimeout(resolve,10000))
  installedMods.push({provider,projectId:versionId==='qaVerMore'?'qaMore123':'qaMod123',title:content.title,versionId,versionNumber:'1.0.0',filename:'fixture.jar'})
  job.phase='completed';changed();return installedMods
})
handle('install-mod-loader', async (profileId,versionId,loader) => {await new Promise(resolve=>setTimeout(resolve,2000));Object.assign(state.profiles.find(p=>p.id===profileId),{versionId,modLoader:loader,modLoaderVersion:versionId+'-'+loader});return changed()})
handle('clone-profile', id => { const clone={...state.profiles.find(p=>p.id===id),id:'qa-clone-'+state.profiles.length,name:'Test World kopyası'};state.profiles.push(clone);state.selectedProfileId=clone.id;return {state:changed(),profileId:clone.id} })
handle('export-profile', () => 'C:/QA/Friend.glprofile')
handle('import-profile', () => {const profile={...state.profiles[0],id:'qa-import-'+state.profiles.length,name:'Imported Adventure'};state.profiles.push(profile);state.selectedProfileId=profile.id;return {state:changed(),profileId:profile.id}})
handle('repair-profile', () => changed())
handle('choose-profile-cover', () => nativeImage.createFromPath(path.join(root,'src','renderer','assets','green-landscape.png')).resize({width:640}).toDataURL())
handle('choose-profile-icon', () => nativeImage.createFromPath(path.join(root,'src','renderer','assets','minecraft-release.png')).resize({width:128,height:128}).toDataURL())
handle('save-profile-cover',(id,cover)=>{state.profiles.find(p=>p.id===id).cover=cover;return changed()})
handle('create-profile-shortcut', () => 'C:/QA/Friend.lnk')
handle('open-folder', () => null)
handle('select-profile', id => {state.selectedProfileId=id;const profile=state.profiles.find(p=>p.id===id);state.selectedVersionId=profile.modLoaderVersion??profile.versionId;return changed()})
handle('reorder-profiles',ids=>{state.profiles.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));return changed()})
handle('delete-profile',id=>{state.profiles=state.profiles.filter(p=>p.id!==id);return changed()})
handle('get-java-runtimes', () => process.argv.includes('--qa-final-polish') ? [{path:'C:\\Users\\DesignQA\\AppData\\Roaming\\GreenLauncher\\java\\java-25\\bin\\javaw.exe',version:'25.0.1',majorVersion:25,source:'Launcher tarafından kuruldu'},{path:'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\javaw.exe',version:'21.0.8',majorVersion:21,source:'Bilgisayarda bulundu'},{path:'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',version:'17.0.12',majorVersion:17,source:'Bilgisayarda bulundu'}] : [])
handle('connect-curseforge', async key => {
  snapshots.connections++
  await new Promise(resolve => setTimeout(resolve, 120))
  if (key !== 'QA_ONLY_SUCCESS_VALUE_NOT_A_CREDENTIAL') throw new Error('QA rejected fake key')
  connected = true
})
handle('open-external', url => { snapshots.externalOpened.push(url); return snapshots })
handle('window-action', action => { if (action === 'close') app.quit() })
handle('save-profile', profile => {
  const saved = { ...profile, id: profile.id ?? 'qa-profile', accountId: withAnalytics ? state.selectedAccountId : 'qa-offline', createdAt: new Date().toISOString() }
  const index=state.profiles.findIndex(p=>p.id===saved.id);if(index>=0)state.profiles[index]=saved;else state.profiles.push(saved);state.selectedProfileId=saved.id
  return changed()
})
app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1280, height: 800, show: false, frame: false, backgroundColor: '#0d1117', webPreferences: { preload: path.join(root, 'out', 'preload', 'index.js'), contextIsolation: true, sandbox: false, nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.loadFile(path.join(root, 'out', 'renderer', 'index.html'))
})
app.on('window-all-closed', () => app.quit())
