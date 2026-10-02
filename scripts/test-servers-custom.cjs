const assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), net = require('node:net'), ts = require('typescript'), { createHash } = require('node:crypto')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'green-servers-custom-'))
function load(file, mocks = {}) {
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => mocks[name] ?? (name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts'), mocks) : require(name)), Buffer, URL, structuredClone, setTimeout, clearTimeout, performance, console, process, AbortSignal, fetch:mocks.fetch ?? fetch })
  return mod.exports
}
const { ServerService, queryServer, parseMotd, varInt } = load('src/main/servers.ts')
const { CustomClients } = load('src/main/custom-clients.ts')
const json = value => JSON.parse(JSON.stringify(value)), hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value) }
const pack = (id, payload) => { const bytes = Buffer.concat([varInt(id), payload]); return Buffer.concat([varInt(bytes.length), bytes]) }
const readInt = (bytes, offset = 0) => { let value = 0; for (let i = 0; i < 5; i++) { if (i + offset >= bytes.length) return null; const byte = bytes[i + offset]; value |= (byte & 127) << (i * 7); if (!(byte & 128)) return { value: value >>> 0, length: i + 1 } } throw new Error('long varint') }
const sockets = new Set(), captured = [], statusesSent = []
let mockIcon, mockOffline = false, mockPlayers = { online: 17, max: 80, sample: [{ name: 'PlayerOne' }, {name: '<script>literal</script>'}] }
const mock = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let buffered = Buffer.alloc(0)
  socket.on('data', chunk => {
    buffered = Buffer.concat([buffered, chunk])
    while (buffered.length) {
      const size = readInt(buffered); if (!size || buffered.length < size.length + size.value) return
      const body = buffered.subarray(size.length, size.length + size.value); buffered = buffered.subarray(size.length + size.value)
      const id = readInt(body)
      if (id.value === 0 && body.length > 1) captured.push(body)
      else if (id.value === 0) {
        if (mockOffline) { socket.destroy(); return }
        const data = Buffer.from(JSON.stringify({ version: { name: 'Paper 1.21.1', protocol: 767 }, players: mockPlayers, favicon: mockIcon, description: {text:'Welcome\n',color:'gold',extra:[{text:'§aEnjoy §lthe server',bold:false}]} }))
        const response = pack(0, Buffer.concat([varInt(data.length), data])); statusesSent.push(data)
        socket.write(response.subarray(0, 1)); setTimeout(() => { if (!socket.destroyed) socket.write(response.subarray(1)) }, 10)
      } else if (id.value === 1) socket.write(pack(1, body.subarray(1)))
    }
  })
})
async function main() {
  await new Promise(resolve => mock.listen(0, '127.0.0.1', resolve))
  const address = `127.0.0.1:${mock.address().port}`, saved = {id:'test',name:'Test',address,createdAt:new Date().toISOString()}
  const status = await queryServer(saved, 1000)
  assert.equal(status.online, true); assert.equal(status.players,17); assert.equal(status.maxPlayers,80); assert.equal(status.version,'Paper 1.21.1'); assert.equal(status.protocol,767); assert.ok(Number.isInteger(status.latency)); assert.equal(status.motd.map(p=>p.text).join(''),'Welcome\nEnjoy the server'); assert.equal(status.motd[0].color,'#ffaa00'); assert.equal(status.motd.at(-1).bold,true)
  const handshake = captured[0]; assert.equal(readInt(handshake,1).value,0xffffffff)
  const hostLength = readInt(handshake,6); assert.equal(handshake.subarray(7,7+hostLength.value).toString(),'127.0.0.1'); assert.equal(handshake.readUInt16BE(7+hostLength.value),mock.address().port); assert.equal(handshake.at(-1),1)
  console.log('PASS real TCP handshake, fragmented status response, MOTD formatting, player data and echoed ping latency')
  const listPath = path.join(temp,'servers.json'), service = new ServerService(listPath)
  service.save({name:'  My server  ',address}); const id = service.get()[0].id
  assert.equal(service.get()[0].name,'My server'); assert.equal(new ServerService(listPath).get()[0].address,address)
  const before = statusesSent.length; await Promise.all([service.refresh(id),service.refresh(id),service.refresh(id)]); assert.equal(statusesSent.length-before,1)
  service.save({id,name:'Renamed',address}); assert.equal(service.get()[0].id,id); assert.equal(service.get()[0].name,'Renamed')
  assert.throws(()=>service.save({name:'bad',address:'https://example.com'})); assert.throws(()=>service.save({id:'missing',name:'bad',address})); assert.throws(()=>service.save({name:'',address}))
  service.delete(id); assert.equal(new ServerService(listPath).get().length,0); assert.throws(()=>service.delete(id))
  const copy=service.get(); copy.push(saved); assert.equal(service.get().length,0)
  console.log('PASS persistent server add/edit/delete, validation, isolated returned state and coalesced refresh')
  const iconPath = path.join(temp, 'icon-cache.json'), iconService = new ServerService(iconPath)
  mockIcon = 'data:image/png;base64,' + fs.readFileSync('src/renderer/assets/minecraft-server-default.png').toString('base64')
  iconService.save({name:'Icon cache',address}); const iconId = iconService.get()[0].id
  assert.equal((await iconService.refresh(iconId)).icon,mockIcon)
  assert.equal(new ServerService(iconPath).get()[0].icon,mockIcon)
  iconService.save({id:iconId,name:'Renamed cache',address}); assert.equal(iconService.get()[0].icon,mockIcon)
  mockOffline = true
  const cachedOffline = await new ServerService(iconPath).refresh(iconId)
  assert.equal(cachedOffline.online,false);assert.equal(cachedOffline.icon,mockIcon);assert.equal(cachedOffline.players,undefined);assert.equal(cachedOffline.latency,undefined)
  mockOffline = false; mockIcon = undefined
  await iconService.refresh(iconId); assert.equal(new ServerService(iconPath).get()[0].icon,undefined)
  mockIcon = 'data:image/png;base64,' + fs.readFileSync('src/renderer/assets/minecraft-server-default.png').toString('base64')
  await iconService.refresh(iconId)
  iconService.save({id:iconId,name:'New address',address:'localhost:25568'});assert.equal(new ServerService(iconPath).get()[0].icon,undefined)
  iconService.save({id:iconId,name:'Pending edit',address});const pendingIcon=iconService.refresh(iconId)
  iconService.save({id:iconId,name:'Changed while querying',address:'localhost:25569'});await pendingIcon;assert.equal(iconService.get()[0].icon,undefined)
  iconService.save({id:iconId,name:'Pending delete',address});const deletingIcon=iconService.refresh(iconId)
  iconService.delete(iconId);await deletingIcon;assert.equal(new ServerService(iconPath).get().length,0)
  put(iconPath,[{...saved,icon:'data:image/svg+xml;base64,evil'}]);assert.equal(new ServerService(iconPath).get()[0].icon,undefined)
  mockIcon = undefined; mockPlayers = {online:-1,max:'unknown'}
  const missingPlayers=await queryServer(saved,1000);assert.equal(missingPlayers.online,true);assert.equal(missingPlayers.players,undefined);assert.equal(missingPlayers.maxPlayers,undefined)
  mockPlayers = {online:0,max:80};const emptyPlayers=await queryServer(saved,1000);assert.equal(emptyPlayers.players,0);assert.equal(emptyPlayers.maxPlayers,80)
  console.log('PASS icon cache survives restart/offline/rename, clears on address or favicon removal, ignores obsolete queries and invalid icons, and distinguishes unavailable player counts from zero')
  const noReply = net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  await new Promise(resolve=>noReply.listen(0,'127.0.0.1',resolve)); const began=Date.now(); const offline=await queryServer({...saved,address:`127.0.0.1:${noReply.address().port}`},100); assert.equal(offline.online,false); assert.ok(Date.now()-began<800); noReply.close()
  assert.ok(parseMotd('x'.repeat(10000)).reduce((n,p)=>n+p.text.length,0)<=2048)
  assert.equal(parseMotd({text:'safe',color:'url(evil)',extra:[{text:'good',color:'#ffcc00'}]})[0].color,undefined)
  const reorderService = new ServerService(path.join(temp, 'reorder.json'))
  reorderService.save({name:'First',address:'first.example.org',resourcePacks:'enabled'});reorderService.save({name:'Second',address:'second.example.org',resourcePacks:'disabled'})
  const orderedIds = reorderService.get().map(server=>server.id).reverse();reorderService.reorder(orderedIds)
  assert.deepEqual(new ServerService(path.join(temp,'reorder.json')).get().map(server=>server.name), ['Second','First'])
  assert.equal(reorderService.get()[0].resourcePacks,'disabled');assert.throws(()=>reorderService.reorder([orderedIds[0],orderedIds[0]]));assert.throws(()=>reorderService.reorder([]));assert.throws(()=>reorderService.save({name:'bad',address:'test.example.org',resourcePacks:'invalid'}))
  const { saveMinecraftServerPreference } = load('src/main/server-preference.ts'), nbt = require('prismarine-nbt'), zlib = require('node:zlib')
  const gameDirectory=path.join(temp,'game'), serverFile=path.join(gameDirectory,'servers.dat')
  const existing={type:'compound',name:'',value:{other:{type:'int',value:7},servers:{type:'list',value:{type:'compound',value:[{name:{type:'string',value:'Existing'},ip:{type:'string',value:'existing.example.org'},hidden:{type:'byte',value:1}},{name:{type:'string',value:'Target'},ip:{type:'string',value:'target.example.org:25565'},icon:{type:'string',value:'original-icon'}}]}}}}
  put(serverFile,zlib.gzipSync(nbt.writeUncompressed(existing)))
  const readServers=()=>nbt.parseUncompressed(zlib.gunzipSync(fs.readFileSync(serverFile)))
  for(const [policy,value] of [['enabled',1],['disabled',0],['prompt',undefined]]) {
    saveMinecraftServerPreference(gameDirectory,'target.example.org',{name:'Renamed',resourcePacks:policy})
    const parsed=readServers();assert.equal(parsed.value.other.value,7);assert.equal(parsed.value.servers.value.value.length,2);assert.deepEqual(parsed.value.servers.value.value[0],existing.value.servers.value.value[0]);assert.equal(parsed.value.servers.value.value[1].icon.value,'original-icon');assert.equal(parsed.value.servers.value.value[1].acceptTextures?.value,value)
  }
  saveMinecraftServerPreference(gameDirectory,'new.example.org',{name:'New',resourcePacks:'enabled'});assert.equal(readServers().value.servers.value.value.length,3)
  put(serverFile,'damaged file');const damagedHash=hash(serverFile);assert.throws(()=>saveMinecraftServerPreference(gameDirectory,'target.example.org',{name:'Target',resourcePacks:'disabled'}));assert.equal(hash(serverFile),damagedHash)
  console.log('PASS persisted drag order, validation and all resource pack policies preserve existing compressed Minecraft server entries and reject corrupted files without overwriting')
  console.log('PASS unresponsive server deadline and bounded safe MOTD styles')
  const sourceRoot=path.join(temp,'original'), owned=path.join(temp,'owned'), folder=path.join(sourceRoot,'versions','1.8.9-SPECIAL')
  put(path.join(folder,'1.8.9-SPECIAL.json'),{id:'1.8.9-SPECIAL',mainClass:'net.minecraft.client.main.Main',assets:'1.8',libraries:[{name:'test:lib:1',downloads:{artifact:{path:'test/lib/1/lib-1.jar'},classifiers:{'natives-windows':{path:'test/lib/1/lib-1-natives-windows.jar'}}}}]})
  put(path.join(folder,'1.8.9-SPECIAL.jar'),Buffer.from('PK\x03\x04CUSTOM')); put(path.join(folder,'natives','test.dll'),'native')
  put(path.join(sourceRoot,'libraries','test/lib/1/lib-1.jar'),'library'); put(path.join(sourceRoot,'libraries','test/lib/1/lib-1-natives-windows.jar'),'natives')
  const asset=Buffer.from('texture'), assetHash=createHash('sha1').update(asset).digest('hex')
  put(path.join(sourceRoot,'assets','indexes','1.8.json'),{objects:{texture:{hash:assetHash}}}); put(path.join(sourceRoot,'assets','objects',assetHash.slice(0,2),assetHash),asset)
  const originalHash=hash(path.join(folder,'1.8.9-SPECIAL.jar')), descriptorHash=hash(path.join(folder,'1.8.9-SPECIAL.json'))
  const importer=new CustomClients(owned); assert.equal(await importer.import(folder),'1.8.9-SPECIAL')
  const destination=path.join(owned,'versions','1.8.9-SPECIAL')
  assert.equal(hash(path.join(destination,'1.8.9-SPECIAL.jar')),originalHash); assert.equal(hash(path.join(folder,'1.8.9-SPECIAL.json')),descriptorHash)
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination,'1.8.9-SPECIAL.json'),'utf8')).greenLauncherCustom,true)
  assert.equal(fs.readFileSync(path.join(destination,'natives','test.dll'),'utf8'),'native'); assert.equal(fs.readFileSync(path.join(owned,'libraries','test/lib/1/lib-1.jar'),'utf8'),'library'); assert.equal(fs.readFileSync(path.join(owned,'assets','objects',assetHash.slice(0,2),assetHash)).toString(),'texture')
  await assert.rejects(importer.import(folder),/zaten/); assert.equal(hash(path.join(folder,'1.8.9-SPECIAL.jar')),originalHash)
  console.log('PASS custom client import, unchanged source JAR/JSON, native/library/assets copy and no overwrite')
  const bad=path.join(sourceRoot,'versions','bad-client'); put(path.join(bad,'bad-client.json'),{id:'bad-client',mainClass:'Test.Main',libraries:[{name:'test:lib:1',downloads:{artifact:{path:'../../escape.jar'}}}]});put(path.join(bad,'bad-client.jar'),'jar')
  await assert.rejects(importer.import(bad),/yolu/); assert.equal(fs.existsSync(path.join(owned,'versions','bad-client')),false); assert.equal(fs.readdirSync(owned).some(n=>n.startsWith('.custom-import-')),false)
  const inherited=path.join(sourceRoot,'versions','inherited'); put(path.join(inherited,'inherited.json'),{id:'inherited',inheritsFrom:'1.20.4'})
  const baseImporter=new CustomClients(owned,async id=>{assert.equal(id,'1.20.4');put(path.join(owned,'versions',id,`${id}.json`),{id,mainClass:'Test.Main'});put(path.join(owned,'versions',id,`${id}.jar`),'base')})
  await baseImporter.import(inherited); assert.equal(fs.existsSync(path.join(owned,'versions','1.20.4','1.20.4.jar')),true)
  const cycle=path.join(sourceRoot,'versions','cycle');put(path.join(cycle,'cycle.json'),{id:'cycle',inheritsFrom:'cycle'});await assert.rejects(importer.import(cycle),/döngü/)
  console.log('PASS traversal rejection, staging cleanup, inherited base installation and cyclic metadata rejection')
  const runtimeRoot=path.join(temp,'java-check'), java21=path.join(runtimeRoot,'java21','javaw.exe'), bundled8=path.join(runtimeRoot,'java','jre-legacy','bin','javaw.exe');put(java21,'21')
  const installer={...require('@xmcl/installer'),resolveJava:async file=>fs.existsSync(file)?{path:file,majorVersion:file===java21?21:8,version:file===java21?'21':'8'}:null,createJavaRuntimeInstallWorkflow:options=>options,executeInstallWorkflow:async()=>put(bundled8,'8'),createDefaultNodeInstallRuntime:()=>({})}
  const {GameService}=load('src/main/game.ts',{'@xmcl/installer':installer,'./download-manager':{getDownloadManager:()=>undefined},fetch:async()=>({ok:true,json:async()=>({'windows-x64':{'jre-legacy':[{}]}})})})
  const game=new GameService({dataPath:runtimeRoot,minecraftPath:owned,get:()=>({settings:{javaPath:''}})}, {},()=>null,()=>{});game.javaRuntimes=async()=>[{path:java21}]
  const oldVersion={id:'1.8.9-SPECIAL',javaVersion:{majorVersion:8,component:'jre-legacy'}}
  assert.equal(await game.findJava(oldVersion,undefined,false),java21)
  assert.equal(await game.findJava(oldVersion,undefined,true),bundled8)
  console.log('PASS custom legacy client automatically receives its exact Java 8 runtime instead of an incompatible newer Java')
  if(process.argv[2]) {
    const original=path.resolve(process.argv[2]), name=path.basename(original), beforeJar=hash(path.join(original,`${name}.jar`)), beforeJson=hash(path.join(original,`${name}.json`)), realOwned=path.join(temp,'real-owned')
    await new CustomClients(realOwned).import(original)
    assert.equal(hash(path.join(realOwned,'versions',name,`${name}.jar`)),beforeJar);assert.equal(hash(path.join(original,`${name}.jar`)),beforeJar);assert.equal(hash(path.join(original,`${name}.json`)),beforeJson)
    const {MinecraftFolder,Version}=require('@xmcl/core');const parsed=await Version.parse(new MinecraftFolder(realOwned),name);assert.equal(parsed.mainClass,'net.minecraft.client.main.Main');assert.equal(parsed.javaVersion.majorVersion,8)
    const {customJavaVersion,customRuntime}=load('src/main/custom-runtime.ts');const required=await customJavaVersion(parsed,new MinecraftFolder(realOwned));assert.equal(required.javaVersion.majorVersion,25);assert.equal((await customRuntime(parsed,new MinecraftFolder(realOwned))).providedNatives.size,8)
    console.log('PASS actual requested custom client parsed by the launch library and copied into isolated test directory; source JAR and metadata unchanged')
  }
}
main().then(()=>{for(const socket of sockets)socket.destroy();mock.close();console.log('All server and custom client checks passed.')}).catch(error=>{console.error(error);for(const socket of sockets)socket.destroy();mock.close();process.exitCode=1}).finally(async()=>{const resolved=path.resolve(temp);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('green-servers-custom-'))await fsp.rm(resolved,{recursive:true,force:true})})
