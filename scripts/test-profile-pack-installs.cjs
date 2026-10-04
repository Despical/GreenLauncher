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
const { LauncherStore } = load('src/main/store.ts')
const { ProfilePackages } = load('src/main/profile-packages.ts')
const { ProfilePackInstalls } = load('src/main/profile-pack-installs.ts')
const store = new LauncherStore(); store.createOfflineAccount('PackQA')
let running=[], preparing=false, failStage=false, foreign=false
const game={getRunningInstances:()=>running,getLaunchState:()=>({preparing})}
const write=(root,file,text)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text)}
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8')
const metadata=(version)=>({projectId:'project',versionId:version,title:'Fixture pack',fileCount:4,provider:'modrinth',sourceUrl:'https://modrinth.com/modpack/project',loader:'fabric'})
store.saveProfile({javaPath:'',memoryMb:4096,minMemoryMb:1024,width:1280,height:720,fullscreen:false,serverAddress:'',name:'Original',versionId:'1.21.1'}); const id=store.get().selectedProfileId, directory=store.profilePath(id)
store.setProfileVersion(id,{versionId:'1.21.1',modLoader:'fabric',modLoaderVersion:'1.21.1-fabric-fixture'});store.setModpack(id,metadata('old'))
write(directory,'green-launcher-pack.json',JSON.stringify({files:['mods/old.jar','config/pack.txt']}))
write(directory,'mods/old.jar','old jar');write(directory,'mods/personal.jar','personal');write(directory,'config/pack.txt','old config');write(directory,'saves/World/level.dat','world');write(directory,'options.txt','personal options');write(directory,'servers.dat','server list')
const packages=new ProfilePackages(store,game,()=>{})
const stage=async(version,minecraft,loader)=>{
 if(failStage)throw Error('Download failed')
 store.saveProfile({javaPath:'',memoryMb:4096,minMemoryMb:1024,width:1280,height:720,fullscreen:false,serverAddress:'',name:'Stage',versionId:minecraft});const staged=store.get().selectedProfileId, dest=store.profilePath(staged)
 store.setProfileVersion(staged,{versionId:minecraft,modLoader:loader,modLoaderVersion:minecraft+'-'+loader+'-fixture'});store.setModpack(staged,{...metadata(version),projectId:foreign?'foreign':'project'})
 write(dest,'green-launcher-pack.json',JSON.stringify({files:['mods/new.jar','config/pack.txt','options.txt','saves\\World\\level.dat']}));write(dest,'mods/new.jar',version);write(dest,'config/pack.txt','new config');write(dest,'options.txt','pack options');write(dest,'saves/World/level.dat','pack world')
 return {state:store.get(),profileId:staged}
}
const service=new ProfilePackInstalls(store,game,packages,stage)
async function main(){
 const current=await service.install(id,'new','1.20.4','fabric','current')
 assert.equal(current.profileId,id);assert.equal(store.get().profiles.length,1);assert.equal(store.get().profiles[0].versionId,'1.20.4');assert.equal(store.get().profiles[0].modpack.versionId,'new')
 assert.equal(fs.existsSync(path.join(directory,'mods/old.jar')),false);assert.equal(read(directory,'mods/new.jar'),'new');assert.equal(read(directory,'mods/personal.jar'),'personal');assert.equal(read(directory,'saves/World/level.dat'),'world');assert.equal(read(directory,'options.txt'),'personal options');assert.equal(read(directory,'servers.dat'),'server list')
 const backups=fs.readdirSync(path.join(root,'backups/profile-packages',id));const backup=path.join(root,'backups/profile-packages',id,backups[0]);const manifest=JSON.parse(read(backup,'manifest.json'));const oldJar=manifest.files.find(item=>item.destination.endsWith('old.jar'));assert.equal(read(backup,oldJar.backup),'old jar')
 results.push('Same-profile install replaces only managed files, preserves worlds/settings/local mods and retains a recoverable backup')
 const copy=await service.install(id,'older','1.21.1','fabric','copy');assert.notEqual(copy.profileId,id);assert.equal(store.get().profiles.length,2);assert.equal(read(store.profilePath(copy.profileId),'saves/World/level.dat'),'world');assert.equal(read(store.profilePath(copy.profileId),'mods/new.jar'),'older');assert.equal(read(directory,'mods/new.jar'),'new')
 const fresh=await service.install(id,'fresh','1.21.1','fabric','new');assert.equal(store.get().profiles.length,3);assert.equal(read(store.profilePath(fresh.profileId),'saves/World/level.dat'),'pack world');assert.equal(read(directory,'saves/World/level.dat'),'world')
 results.push('Older versions can install in a copied profile; fresh destinations retain independent pack defaults')
 const before=structuredClone(store.get().profiles.find(p=>p.id===id));const setPack=store.setModpack.bind(store);let failOnce=true;store.setModpack=(...args)=>{if(args[0]===id&&failOnce){failOnce=false;throw Error('Metadata failure')}return setPack(...args)}
 await assert.rejects(service.install(id,'failed','1.21.1','fabric','current'),/Metadata failure/);store.setModpack=setPack
 assert.equal(store.get().profiles.find(p=>p.id===id).modpack.versionId,before.modpack.versionId);assert.equal(read(directory,'mods/new.jar'),'new');assert.equal(read(directory,'config/pack.txt'),'new config');assert.equal(store.get().profiles.length,3)
 failStage=true;await assert.rejects(service.install(id,'failed','1.21.1','fabric','current'),/Download failed/);failStage=false
 foreign=true;await assert.rejects(service.install(id,'failed','1.21.1','fabric','current'),/projeye/);foreign=false;assert.equal(store.get().profiles.length,3)
 running=[{profileId:id}];await assert.rejects(service.install(id,'new','1.21.1','fabric','current'),/oyununu/);running=[]
 preparing=true;await assert.rejects(service.install(id,'new','1.21.1','fabric','copy'),/oyununu/);preparing=false
 await assert.rejects(service.install(id,'new','1.21.1','fabric','bogus'),/hedefi/)
 results.push('Failed downloads, foreign projects, running/preparing games and invalid targets cannot modify the source; metadata failures roll back files and runtime binding')
 const custom=path.join(root,'custom-game');fs.mkdirSync(custom);fs.cpSync(directory,custom,{recursive:true});store.saveProfile({...store.get().profiles.find(p=>p.id===id),gameDirectory:custom})
 await service.install(id,'custom','1.21.1','fabric','current');assert.equal(read(custom,'mods/new.jar'),'custom');assert.equal(read(custom,'saves/World/level.dat'),'world');assert.equal(read(directory,'mods/new.jar'),'new')
 results.push('Custom game directories update content while keeping bookkeeping in the owned profile directory')
 const oldManifest=read(directory,'green-launcher-pack.json');write(directory,'green-launcher-pack.json',JSON.stringify({files:['../outside.txt']}));await assert.rejects(service.install(id,'unsafe','1.21.1','fabric','current'));assert.equal(read(custom,'mods/new.jar'),'custom');write(directory,'green-launcher-pack.json',oldManifest)
 const outsider=path.join(root,'linked-content');fs.mkdirSync(outsider);fs.renameSync(path.join(custom,'mods'),path.join(custom,'mods-original'))
 try {fs.symlinkSync(outsider,path.join(custom,'mods'),'junction');await assert.rejects(service.install(id,'linked','1.21.1','fabric','current'),/bağlantı/);assert.equal(fs.readdirSync(outsider).length,0);results.push('Unsafe manifest paths and linked destination directories are rejected before modifying content')}
 catch(error){if(error.code!=='EPERM')throw error}
 finally{if(fs.existsSync(path.join(custom,'mods')))fs.rmSync(path.join(custom,'mods'),{recursive:true,force:true});fs.renameSync(path.join(custom,'mods-original'),path.join(custom,'mods'))}

 console.log(results.map(text=>'PASS '+text).join('\n'))
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}))
