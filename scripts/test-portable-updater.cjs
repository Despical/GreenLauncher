const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict')
const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-transport-')),mod={exports:{}}
const bytes=Buffer.alloc(2048,42),digest=crypto.createHash('sha256').update(bytes).digest('hex')
let mode='ok', requests=0
const fakeFetch=async(url,{signal})=>{
 requests++;signal.throwIfAborted()
 if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://example.org/payload.exe'}})
 if(String(url).endsWith('portable-update.json'))return Response.json({version:'0.17.5',file:mode==='filename'?'../../other.exe':'GreenLauncher-0.17.5.exe',size:bytes.length,sha256:digest})
 return new Response(mode==='checksum'?Buffer.alloc(2048,1):bytes)
}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/portable-updater.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,require,process,Buffer,URL,fetch:fakeFetch,Date,Number,Set,Map,Error,JSON})
async function main(){
 const {PortableUpdateTransport,confirmUpdate}=mod.exports
 const transport=new PortableUpdateTransport(path.join(root,'cache'),path.join(root,'Launcher.exe'),'missing-helper',path.join(root,'receipt'),'0.17.4',()=>{throw Error('must not quit')})
 mode='redirect';await assert.rejects(transport.download('0.17.5',()=>{},new AbortController().signal),/Invalid update download address/)
 mode='filename';await assert.rejects(transport.download('0.17.5',()=>{},new AbortController().signal),/Invalid portable update metadata/)
 mode='checksum';await assert.rejects(transport.download('0.17.5',()=>{},new AbortController().signal),e=>e.code==='ERR_CHECKSUM_MISMATCH');assert.equal(fs.existsSync(path.join(root,'cache/GreenLauncher-0.17.5.exe.download')),false)
 mode='ok';const events=[];const [file]=await transport.download('0.17.5',v=>events.push(v),new AbortController().signal);assert.equal(events.at(-1).percent,100);assert.equal(fs.readFileSync(file).equals(bytes),true)
 const before=requests;await transport.download('0.17.5',()=>{},new AbortController().signal);assert.equal(requests,before+1,'verified cache reused after current metadata check')
 fs.writeFileSync(file,'modified');await assert.rejects(transport.install(file,'0.17.5'),e=>e.code==='ERR_CHECKSUM_MISMATCH')
 const controller=new AbortController();controller.abort();await assert.rejects(transport.download('0.17.5',()=>{},controller.signal))
 const log=[],logs={info:(...args)=>log.push(args),record:(...args)=>log.push(args)},target=path.join(root,'Launcher.exe'),receipt=path.join(root,'update-result.json')
 fs.writeFileSync(receipt,JSON.stringify({status:'applied',from:'0.17.4',version:'0.17.5',target}));assert.equal(confirmUpdate(root,'0.17.4',target,logs),undefined);assert.equal(log.length,0)
 assert.equal(confirmUpdate(root,'0.17.5',path.join(root,'Other.exe'),logs),undefined)
 assert.equal(confirmUpdate(root,'0.17.5',target,logs).version,'0.17.5');assert.equal(log.length,1);assert.equal(JSON.parse(fs.readFileSync(receipt)).status,'confirmed')
 confirmUpdate(root,'0.17.5',target,logs);assert.equal(log.length,1,'success logged once across launches')
 let imported=0
 confirmUpdate(root,'0.17.5',target,logs,()=>imported++);confirmUpdate(root,'0.17.5',target,logs,()=>imported++)
 assert.equal(imported,1,'installed update migrates to history once and will not return after history is cleared')
 fs.writeFileSync(receipt,JSON.stringify({status:'failed',from:'0.17.4',version:'0.17.5',target,error:193}));confirmUpdate(root,'0.17.4',target,logs);confirmUpdate(root,'0.17.4',target,logs);assert.equal(log.length,2,'failure logged once')
 console.log('PASS trusted HTTPS redirects, manifest validation, checksum/size verification, cancellation, verified cache reuse, rechecking install payload, exact version/target confirmation and once-only result logs')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true})})
