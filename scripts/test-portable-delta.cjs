const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto')
const {createSourceLoader}=require('./test-source.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'green-delta-'))
const digest=b=>crypto.createHash('sha256').update(b).digest('hex'),load=createSourceLoader(),{updateBlocks,planUpdate}=load('src/main/update-blocks.ts')
const old=crypto.randomBytes(4*1024**2),next=Buffer.concat([old.subarray(0,1024**2),crypto.randomBytes(32768),old.subarray(1024**2)])
const target=path.join(root,'Launcher.exe'),future=path.join(root,'fixture-next.exe');fs.writeFileSync(target,old);fs.writeFileSync(future,next)
let mode='ok',full=0,ranges=0,received=0,controller,available=4*1024**3
;(async()=>{
 const map=Buffer.from(JSON.stringify(await updateBlocks(future))),oldMap=await updateBlocks(target)
 const plan=planUpdate(oldMap,JSON.parse(map)); assert.ok(plan.downloadBytes<next.length*.1,`${plan.downloadBytes} bytes needed`)
 const metadata={version:'0.17.8',file:'GreenLauncher-0.17.8.exe',size:next.length,sha256:digest(next),runtimeSize:next.length*2,blockmap:{file:'GreenLauncher-0.17.8.exe.blocks.json',size:map.length,sha256:digest(map)}}
 const fakeFetch=async(url,options)=>{
  options.signal.throwIfAborted()
  if(String(url).endsWith('portable-update.json'))return Response.json(metadata)
  if(String(url).endsWith('.blocks.json'))return new Response(mode==='bad-map'?Buffer.from('broken'):map)
  const range=options.headers.Range
  if(range){ranges++;const [,start,end]=/bytes=(\d+)-(\d+)/.exec(range).map(Number)
   if(mode==='cancel'){controller.abort();options.signal.throwIfAborted()}
   if(mode==='no-range')return new Response(next)
   const bytes=next.subarray(start,end+1);received+=bytes.length
   return new Response(mode==='bad-range'?Buffer.alloc(bytes.length,99):bytes,{status:206,headers:{'content-range':`bytes ${start}-${end}/${next.length}`}})
  }
  full++;received+=next.length;return new Response(next)
 }
 const source=createSourceLoader({fetch:fakeFetch,dependencies:{'node:fs':{...fs,statfsSync:()=>({bavail:BigInt(available),bsize:1n})}}})
 const {PortableUpdateTransport}=source('src/main/portable-updater.ts'),transport=new PortableUpdateTransport(path.join(root,'cache'),target,'helper',path.join(root,'receipt'),'0.17.7',()=>{})
 let events=[];controller=new AbortController();let[file]=await transport.download('0.17.8',e=>events.push(e),controller.signal)
 assert.ok(fs.readFileSync(file).equals(next));assert.equal(full,0);assert.ok(ranges>0);assert.ok(received<next.length*.1);assert.equal(events.at(-1).total,received)
 console.log(`PASS shifted EXE reconstructed exactly; ${(received/next.length*100).toFixed(2)}% of payload downloaded`)
 for(const failure of ['no-range','bad-map','bad-range']){
  fs.rmSync(file);mode=failure;full=0;controller=new AbortController();[file]=await transport.download('0.17.8',()=>{},controller.signal)
  assert.ok(fs.readFileSync(file).equals(next));assert.equal(full,1,`${failure} should fall back to verified full EXE`)
 }
 fs.rmSync(file);mode='cancel';full=0;controller=new AbortController();await assert.rejects(transport.download('0.17.8',()=>{},controller.signal));assert.equal(full,0);assert.equal(fs.existsSync(file+'.download'),false)
 mode='ok';available=1024**2;full=0;ranges=0;controller=new AbortController();await assert.rejects(transport.download('0.17.8',()=>{},controller.signal),e=>e.code==='INSUFFICIENT_DISK_SPACE');assert.equal(full+ranges,0)
 console.log('PASS range refusal, bad map and corrupt reconstruction fall back to a verified full EXE; cancellation never falls back; temporary output removed; insufficient disk blocks payload')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true})})
