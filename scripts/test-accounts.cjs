const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-accounts-test-'))
function load(file, extras = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const mod = {exports:{}}
  const mocks = {electron:{app:{getPath:()=>root},screen:{getPrimaryDisplay:()=>({bounds:{width:1920,height:1080}})}}}
  vm.runInNewContext(output,{exports:mod.exports,module:mod,require:n=>mocks[n]||(n.startsWith('.') && fs.existsSync(path.resolve(path.dirname(file), n + '.ts')) ? load(path.resolve(path.dirname(file), n + '.ts')) : require(n)),structuredClone,Buffer,URL,AbortSignal,console,...extras})
  return mod.exports
}
const {LauncherStore} = load('src/main/store.ts')
const store = new LauncherStore()
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('PASS',name) }
check('trim account names',()=>assert.equal(store.createOfflineAccount('  Steve  ').accounts[0].name,'Steve'))
for(const name of ['Steve','STEVE',' steve ']) check('reject duplicate '+JSON.stringify(name),()=>assert.throws(()=>store.createOfflineAccount(name),/zaten var/))
for(const name of ['', 'ab','a'.repeat(17),'bad name','Türkçe','a/b',null]) check('reject invalid '+JSON.stringify(name),()=>assert.throws(()=>store.createOfflineAccount(name)))
check('offline UUID matches Minecraft',()=>assert.equal(store.get().accounts[0].id,'5627dd98e6be3c21b8a8e92344183641'))
const ms={id:'a'.repeat(32),name:'MicrosoftUser',homeAccountId:'a'.repeat(32),kind:'microsoft'}
check('add Microsoft account',()=>assert.equal(store.upsertAccount(ms).accounts.length,2))
check('reject offline name matching Microsoft',()=>assert.throws(()=>store.createOfflineAccount('microsoftuser'),/zaten var/))
check('reject Microsoft name matching offline',()=>assert.throws(()=>store.upsertAccount({...ms,id:'b'.repeat(32),name:'sTEVE'}),/zaten var/))
check('Microsoft reauthentication updates in place',()=>assert.equal(store.upsertAccount({...ms,skinUrl:'https://textures.minecraft.net/texture/a'}).accounts.length,2))
check('rejected duplicates do not change selection',()=>assert.equal(store.get().selectedAccountId,ms.id))
check('select unknown account fails',()=>assert.throws(()=>store.selectAccount('missing')))
check('removing inactive account preserves selection',()=>assert.equal(store.removeAccount('5627dd98e6be3c21b8a8e92344183641').selectedAccountId,ms.id))
store.createOfflineAccount('Alex')
check('removing selected account picks remaining account',()=>assert.equal(store.removeAccount(store.get().selectedAccountId).selectedAccountId,ms.id))
check('last account removal clears selection',()=>assert.equal(store.removeAccount(ms.id).selectedAccountId,null))
check('state persists across restart',()=>assert.equal(new LauncherStore().get().accounts.length,0))

;(async()=>{
 let calls=0, mode='ok'
 const png=Buffer.alloc(24); Buffer.from('89504e470d0a1a0a','hex').copy(png); png.writeUInt32BE(64,16); png.writeUInt32BE(64,20)
 const texture='https://textures.minecraft.net/texture/abc123'
 const mockedFetch=async target=>{ calls++; if(mode==='fail') throw Error('offline'); const url=String(target); if(url.includes('users/profiles')) return {ok:true,status:mode==='missing'?404:200,json:async()=>({id:'f'.repeat(32)})}; if(url.includes('sessionserver')) return {ok:true,json:async()=>({properties:[{name:'textures',value:Buffer.from(JSON.stringify({textures:{SKIN:{url:mode==='unsafe'?'https://example.com/bad.png':texture}}})).toString('base64')}]})}; return {ok:true,arrayBuffer:async()=>mode==='invalid'?Buffer.from('not a png'):png} }
 const {AccountSkins}=load('src/main/account-skins.ts',{fetch:mockedFetch})
 const directory=path.join(root,'skin-cache')
 const service=new AccountSkins(directory)
 const offline={id:'c'.repeat(32),name:'Notch',kind:'offline',homeAccountId:'c'.repeat(32)}
 const [a,b]=await Promise.all([service.get(offline),service.get(offline)])
 check('coalesces concurrent skin lookup',()=>{assert.equal(calls,3);assert.equal(a,b);assert.match(a,/^data:image\/png/)})
 await service.get(offline);check('memory cache avoids repeat network calls',()=>assert.equal(calls,3))
 await new AccountSkins(directory).get(offline);check('fresh disk cache avoids network calls',()=>assert.equal(calls,3))
 for(const file of fs.readdirSync(directory)) fs.utimesSync(path.join(directory,file),new Date(0),new Date(0))
 mode='fail';check('cached skin available without internet',()=>{});assert.equal(await new AccountSkins(directory).get(offline),a)
 mode='missing';assert.equal(await service.get({...offline,name:'MissingPlayer'}),null);checks++
 mode='unsafe';assert.equal(await service.get({...offline,name:'UnsafePlayer'}),null);checks++
 mode='invalid';assert.equal(await service.get({...offline,name:'InvalidPlayer'}),null);checks++
 check('loading has an empty frame in both implementations',()=>{assert.match(fs.readFileSync('src/main/index.ts','utf8'),/frames=\['','\.','\.\.','\.\.\.'\]/);assert.match(fs.readFileSync('scripts/splash-helper.cpp','utf8'),/dotCount = \(dotCount \+ 1\) % 4/)})
 console.log(`${checks} account/skin/splash checks passed. Test data: ${root}`)
})().catch(error=>{console.error(error);process.exitCode=1})
