// Isolated renderer fixture; all version downloads and profile changes stay in memory.
const { ipcMain, BrowserWindow } = require('electron')
const register = ipcMain.handle.bind(ipcMain), requests = [], installed = new Set(['1.21.1', '1.21.1-fabric'])
let stateHandler, fail = false, locked = false, noDates = false
const addedProfiles = []
const catalog = () => ['1.21.1', '1.20.4', '1.12.2', '24w02a'].map(id => ({ id, type: id.startsWith('24w') ? 'snapshot' : 'release', releaseTime: '2026-10-03', url: 'https://piston-meta.mojang.com/isolated-fixture', installed: installed.has(id), optifineAvailable: id !== '24w02a', optifineVersions: installed.has(`${id}-OptiFine_HD_U_TEST`) ? [{ id: `${id}-OptiFine_HD_U_TEST`, source: 'launcher' }] : [] })).concat([...installed].filter(id => /-fabric|-forge|-quilt|-neoforge|-liteloader/.test(id)).map(id => ({ id, installed: true, type: 'release', url: '', releaseTime: '2026-10-03', optifineVersions: [] })))
ipcMain.handle = (channel, handler) => {
  if (channel === 'launcher:get-state') stateHandler = handler
  return register(channel, async (event, ...args) => {
    if (channel === 'launcher:get-versions') return catalog()
    if (channel === 'launcher:get-mod-versions' && args[5] === 'modpack') return [{id:'qa',versionNumber:'1.0',name:'Pack 1.0',type:'release',published:noDates?'':'2026-09-01',gameVersions:['1.21.1'],loaders:['fabric']},{id:'qa-new',versionNumber:'2.0',name:'Pack 2.0',type:'release',published:noDates?'':'2026-10-01',gameVersions:['1.20.4'],loaders:['fabric']}]
    if (channel === 'launcher:get-state') { const state = await handler(event, ...args); return { ...state, profiles: [...state.profiles, ...addedProfiles], qaVersionRequests: requests } }
    if (channel === 'launcher:save-settings' && args[0]?.qaVersion) {
      const { qaVersion: control, ...settings } = args[0]; args[0] = settings; fail = control.fail ?? fail; locked = control.locked ?? locked; noDates = control.noDates ?? noDates
      if(control.extraLogs) for(let i=0;i<40;i++) fixtureLogs.set('logs/archive-'+i+'.log','Archived file '+i);
      if(control.navigate) for(const window of BrowserWindow.getAllWindows()) window.webContents.send('launcher:navigate',control.navigate)
      const state = await stateHandler(event), profile = state.profiles.find(p => p.id === 'qa-profile')
      if (profile) profile.modpack = locked ? { projectId: 'qa', versionId: 'qa', title: 'Fixture pack', fileCount: 1, provider: 'modrinth', sourceUrl: 'https://modrinth.com/modpack/qa', loader: 'fabric' } : undefined
    }
    return handler(event, ...args)
  })
}
require('./qa-resource-packs-launch.cjs')
register('launcher:install-modpack', async (event, ...args) => {
  if(args[0]!=='qa-new') throw Error('Invalid fixture version')
  const state=await stateHandler(event), original=state.profiles.find(p=>p.id==='qa-profile')
  requests.push({kind:'pack-install',args})
  addedProfiles.push({...structuredClone(original),id:'qa-updated-pack',name:'Fixture pack (2)',versionId:args[1],modpack:{...original.modpack,versionId:args[0]}})
  return {state:{...state,profiles:[...state.profiles,...addedProfiles]},profileId:'qa-updated-pack'}
})
register('launcher:configure-profile-version', async (event, id, version, loader, acknowledged) => {
  const state = await stateHandler(event), profile = state.profiles.find(p => p.id === id)
  if (!profile) throw Error('Profil bulunamadı.')
  requests.push({ id, version, loader, acknowledged })
  const oldBase = profile.versionId.split(/-OptiFine_/i)[0], oldLoader = profile.modLoader ?? (profile.versionId.includes('-OptiFine_') ? 'optifine' : 'none')
  loader ??= version === oldBase ? oldLoader : 'none'
  if (!acknowledged && (version !== oldBase || loader !== oldLoader)) return { status: 'confirmation-required', activeMods: 1 }
  await new Promise(resolve => setTimeout(resolve, 300)); if (fail) throw Error('Fixture download failed')
  profile.versionId = loader === 'optifine' ? `${version}-OptiFine_HD_U_TEST` : version
  profile.modLoader = ['none', 'optifine'].includes(loader) ? undefined : loader
  profile.modLoaderVersion = profile.modLoader ? `${version}-${loader}-fixture` : undefined
  installed.add(version); installed.add(profile.modLoaderVersion ?? profile.versionId)
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('launcher:state', state)
  return { status: 'configured', state }
})

register('launcher:install-profile-modpack',async(event,id,version,minecraft,loader,target)=>{
 const state=await stateHandler(event),original=state.profiles.find(p=>p.id===id);if(!original||!['qa','qa-new'].includes(version)||!['current','copy','new'].includes(target))throw Error('Invalid fixture request')
 requests.push({kind:'profile-pack-install',id,version,target});await new Promise(resolve=>setTimeout(resolve,150))
 if(target==='current'){original.versionId=minecraft;original.modpack={...original.modpack,versionId:version};return {state:{...state,profiles:[...state.profiles,...addedProfiles]},profileId:id}}
 const profileId=target==='new'?'qa-updated-pack':'qa-copy-pack';addedProfiles.push({...structuredClone(original),id:profileId,name:'Fixture pack ('+target+')',versionId:minecraft,modpack:{...original.modpack,versionId:version}})
 return {state:{...state,profiles:[...state.profiles,...addedProfiles]},profileId}
})
const fixtureLogs=new Map([['logs/archive.log.gz','[main/INFO]: Archived fixture\n[main/WARN]: Warning\nCaused by: fixture'],['crash-reports/crash.txt','Crash fixture'],['logs/latest.log','[main/INFO]: Latest fixture']])
register('launcher:get-system-log-files',async()=>[...fixtureLogs.keys()].map(filename=>({filename,bytes:150,modifiedAt:'2026-10-04T12:00:00Z',compressed:filename.endsWith('.gz')})))
register('launcher:get-system-log',async(_event,_id,filename)=>({filename,truncated:false,lines:fixtureLogs.get(filename).split('\n').map((text,index)=>({seq:index+1,text,level:index===1?'warn':index===2?'error':'info'}))}))
register('launcher:delete-system-logs',async(_event,_id,files)=>{requests.push({kind:'delete-logs',files});for(const file of files)fixtureLogs.delete(file)})
register('launcher:copy-system-log',async()=>{requests.push({kind:'copy-log'})})
register('launcher:upload-system-log',async()=>{requests.push({kind:'upload-log'});return 'https://mclo.gs/Fixture01'})
