// Compare two real independently-compressed portable builds. Never install either EXE.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict')
const {createSourceLoader}=require('./test-source.cjs'),version=require('../package.json').version
const baseline=path.resolve(process.argv[2]||'build/delta-baseline-0.17.7.exe'),next=path.resolve(`release/GreenLauncher-${version}.exe`)
const metadata=JSON.parse(fs.readFileSync('release/portable-update.json','utf8')),root=fs.mkdtempSync(path.join(os.tmpdir(),'green-packaged-delta-'))
let payloadBytes=0,ranges=0,full=0
const hash=p=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),s=fs.createReadStream(p);s.on('data',b=>h.update(b));s.on('end',()=>resolve(h.digest('hex')));s.on('error',reject)})
const server=http.createServer((req,res)=>{
 if(req.url==='/portable-update.json'){res.end(JSON.stringify(metadata));return}
 if(req.url.endsWith('.blocks.json')){fs.createReadStream(`release/${metadata.blockmap.file}`).pipe(res);return}
 const match=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range||'')
 if(match){const start=Number(match[1]),end=Number(match[2]);ranges++;payloadBytes+=end-start+1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${metadata.size}`,'Content-Length':end-start+1});fs.createReadStream(next,{start,end}).pipe(res)}
 else{full++;payloadBytes+=metadata.size;res.setHeader('Content-Length',metadata.size);fs.createReadStream(next).pipe(res)}
})
;(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const target=path.join(root,'Launcher.exe');fs.copyFileSync(baseline,target)
 const load=createSourceLoader({fetch:(url,options)=>fetch(`http://127.0.0.1:${server.address().port}/${new URL(url).pathname.split('/').at(-1)}`,options)})
 const {PortableUpdateTransport}=load('src/main/portable-updater.ts'),transport=new PortableUpdateTransport(path.join(root,'cache'),target,'unused-helper',path.join(root,'receipt'),'0.17.6',()=>{})
 const[file]=await transport.download(version,()=>{},new AbortController().signal)
 assert.equal(await hash(file),metadata.sha256);assert.equal(full,0);assert.ok(ranges>0);assert.ok(payloadBytes<metadata.size*.2,`${payloadBytes} / ${metadata.size}`)
 const results={version,fullBytes:metadata.size,downloadedBytes:payloadBytes,blockmapBytes:metadata.blockmap.size,rangeRequests:ranges,sha256:await hash(file)}
 fs.writeFileSync('build/qa-packaged-delta-results.json',JSON.stringify(results,null,2))
 console.log(`PASS real portable builds reconstructed byte-for-byte over HTTP Range: ${(payloadBytes/1024**2).toFixed(2)} MiB of ${(metadata.size/1024**2).toFixed(2)} MiB payload; ${ranges} ranges; ${(payloadBytes/metadata.size*100).toFixed(2)}% transferred`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{server.close();assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true})})
