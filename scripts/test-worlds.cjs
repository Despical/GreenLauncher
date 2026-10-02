const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript'),nbt=require('prismarine-nbt'),zlib=require('node:zlib')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-worlds-'))
function load(file){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require:n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n),Buffer,console,Date});return mod.exports}
const {WorldService}=load('src/main/worlds.ts')
const profiles=[{id:'a'},{id:'b',gameDirectory:path.join(root,'custom')}]
const store={get:()=>({profiles}),gamePath:p=>p.gameDirectory||path.join(root,p.id)}
const doc=(name,legacy=false)=>({
 type:'compound',name:'',value:{Data:{type:'compound',value:{
  LevelName:{type:'string',value:name},GameType:{type:'int',value:1},hardcore:{type:'byte',value:0},
  LastPlayed:{type:'long',value:[400,123456789]},Version:{type:'compound',value:{Name:{type:'string',value:'1.21.1'}}},
  marker:{type:'compound',value:{nested:{type:'long',value:[-123456789,123456789]}}},
  ...(legacy?{RandomSeed:{type:'long',value:[-2147483648,0]}}:{WorldGenSettings:{type:'compound',value:{seed:{type:'long',value:[2147483647,-1]}}}})
 }}}
})
function put(dir,name,legacy=false){fs.mkdirSync(path.join(dir,'region'),{recursive:true});fs.writeFileSync(path.join(dir,'level.dat'),zlib.gzipSync(nbt.writeUncompressed(doc(name,legacy))));fs.writeFileSync(path.join(dir,'region/r.0.0.mca'),Buffer.alloc(4096,21));fs.writeFileSync(path.join(dir,'session.lock'),'\u2603')}
const read=dir=>nbt.parseUncompressed(zlib.gunzipSync(fs.readFileSync(path.join(dir,'level.dat'))))
const a=path.join(root,'a/saves/Folder A'),b=path.join(root,'custom/saves/Legacy')
put(a,'Modern');put(b,'Legacy',true)
fs.copyFileSync('src/renderer/assets/minecraft-server-default.png',path.join(a,'icon.png'))
;(async()=>{try{
 const service=new WorldService(store)
 let items=await service.list('a');assert.equal(items.length,1);assert.equal(items[0].seed,'9223372036854775807');assert.equal(items[0].lastPlayed,400*4294967296+123456789);assert.equal(items[0].gameMode,1);assert.equal(items[0].version,'1.21.1');assert.ok(items[0].icon.startsWith('data:image/png;base64,'));assert.ok(items[0].size>4096)
 assert.equal((await service.list('b'))[0].seed,'-9223372036854775808');assert.equal((await service.list('b'))[0].name,'Legacy')
 console.log('PASS real gzip level.dat metadata, exact 64-bit positive/negative seeds, icons, size, custom directories and profile isolation')
 const original=read(a);await service.rename('a','Folder A','Renamed in launcher');assert.equal(read(a).value.Data.value.LevelName.value,'Renamed in launcher');assert.deepEqual(read(a).value.Data.value.marker,original.value.Data.value.marker);assert.equal(read(a).value.Data.value.WorldGenSettings.value.seed.value.toString(),original.value.Data.value.WorldGenSettings.value.seed.value.toString());assert.ok(fs.existsSync(path.join(a,'level.dat.green-launcher-backup')));assert.equal((await service.list('a'))[0].id,'Folder A')
 const changed=read(a);changed.value.Data.value.LevelName.value='Renamed in Minecraft';fs.writeFileSync(path.join(a,'level.dat'),zlib.gzipSync(nbt.writeUncompressed(changed)));assert.equal((await service.list('a'))[0].name,'Renamed in Minecraft')
 const duplicate=await service.duplicate('a','Folder A','Modern (copy)');assert.equal(duplicate,'Folder A (1)');assert.equal(read(path.join(root,'a/saves',duplicate)).value.Data.value.LevelName.value,'Modern (copy)');assert.ok(!fs.existsSync(path.join(root,'a/saves',duplicate,'session.lock')));assert.deepEqual(fs.readFileSync(path.join(root,'a/saves',duplicate,'region/r.0.0.mca')),fs.readFileSync(path.join(a,'region/r.0.0.mca')))
 await service.resetIcon('a','Folder A');assert.equal((await service.list('a')).find(w=>w.id==='Folder A').icon,undefined);assert.ok(!fs.existsSync(path.join(a,'icon.png')))
 console.log('PASS game-side rename polling, in-game name changes preserve NBT fields and backup, complete world copies, and reset icon fallback')
 const imported=await service.import('a',b);assert.equal(imported,'Legacy');assert.ok(fs.existsSync(path.join(b,'level.dat')));assert.equal((await service.list('a')).find(w=>w.id==='Legacy').seed,'-9223372036854775808');assert.equal((await service.list('b')).length,1)
 await service.delete('a',imported,async p=>fs.renameSync(p,path.join(root,'recycle-world')));assert.ok(fs.existsSync(path.join(root,'recycle-world/level.dat')));assert.equal((await service.list('a')).length,2)
 const priorSize=(await service.list('a',true)).find(w=>w.id==='Folder A').size;fs.writeFileSync(path.join(a,'region/new.mca'),Buffer.alloc(2000));assert.equal((await service.list('a',true)).find(w=>w.id==='Folder A').size,priorSize+2000)
 console.log('PASS manual import preserves source, deletion delegates to recycle bin, forced size refresh and external file changes')
 for(const id of ['..','../custom','Folder A/../other','C:',''])await assert.rejects(()=>service.path('a',id))
 await assert.rejects(()=>service.list('missing'));await assert.rejects(()=>service.rename('a','Folder A',''));await assert.rejects(()=>service.rename('a','Folder A','Bad\0name'));await assert.rejects(()=>service.import('a',path.join(root,'a')))
 const blocked=new WorldService(store,()=>{throw new Error('Dünya açıkken bu işlem yapılamaz.')});await assert.rejects(()=>blocked.rename('a','Folder A','Blocked'),/Dünya açıkken/);assert.equal(read(a).value.Data.value.LevelName.value,'Renamed in Minecraft')
 const broken=path.join(root,'bad');fs.mkdirSync(broken);fs.writeFileSync(path.join(broken,'level.dat'),'broken');await assert.rejects(()=>service.import('a',broken));assert.equal(fs.readdirSync(path.join(root,'a/saves')).filter(n=>n.startsWith('.green-world-')).length,0)
 fs.symlinkSync(b,path.join(root,'a/saves/Linked'),'junction');await assert.rejects(()=>service.path('a','Linked'));await assert.rejects(()=>service.import('a',path.join(root,'a/saves/Linked')));assert.equal((await service.list('a')).length,2)
 fs.symlinkSync(b,path.join(a,'Linked region'),'junction');await assert.rejects(()=>service.duplicate('a','Folder A','Bad copy'));fs.rmSync(path.join(a,'Linked region'));assert.equal(fs.readdirSync(path.join(root,'a/saves')).filter(n=>n.startsWith('.green-world-')).length,0)
 console.log('PASS path traversal, broken worlds, linked folders, concurrent-game mutation guards and failed-import cleanup')
 let release;const wait=new Promise(r=>release=r),started=new Promise(async r=>{await service.launch('a','Folder A',async()=>{r();await wait;return 42})})
 await started;assert.equal(service.isBusy,true);await assert.rejects(()=>service.rename('a','Folder A','During launch'),/Başka bir dünya/);release();await new Promise(r=>setTimeout(r,20));assert.equal(service.isBusy,false)
 console.log('PASS launch reserves the world until game preparation finishes; concurrent operations are rejected')
 const split=path.join(root,'a/saves/Split world');put(split,'Minecraft 26.3')
 const splitDoc=read(split);delete splitDoc.value.Data.value.WorldGenSettings;splitDoc.value.Data.value.difficulty_settings={type:'compound',value:{hardcore:{type:'byte',value:1}}};fs.writeFileSync(path.join(split,'level.dat'),zlib.gzipSync(nbt.writeUncompressed(splitDoc)))
 const genDir=path.join(split,'data/minecraft');fs.mkdirSync(genDir,{recursive:true})
 const gen=seed=>({type:'compound',name:'',value:{data:{type:'compound',value:{seed:{type:'long',value:seed}}},DataVersion:{type:'int',value:5000}}})
 const genFile=path.join(genDir,'world_gen_settings.dat');fs.writeFileSync(genFile,zlib.gzipSync(nbt.writeUncompressed(gen([-2147483648,0]))))
 assert.equal((await service.list('a')).find(w=>w.id==='Split world').seed,'-9223372036854775808');assert.equal((await service.list('a')).find(w=>w.id==='Split world').hardcore,true)
 fs.writeFileSync(genFile,nbt.writeUncompressed(gen([0,0])));assert.equal((await service.list('a')).find(w=>w.id==='Split world').seed,'0')
 fs.writeFileSync(genFile,'broken');assert.equal((await service.list('a')).find(w=>w.id==='Split world').seed,undefined)
 fs.rmSync(genDir,{recursive:true});fs.symlinkSync(b,genDir,'junction');assert.equal((await service.list('a')).find(w=>w.id==='Split world').seed,undefined)
 console.log('PASS Minecraft 26.1+ separate world generation data, exact seeds including zero, moved hardcore field, corrupt-file fallback and linked-data exclusion')
 console.log('All world checks passed.')
}finally{fs.rmSync(root,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})
