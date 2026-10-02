import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { LauncherUpdate } from '../shared/types'
import type { ErrorLog } from './error-log'
import { diskSpace, isDiskSpaceError } from './disk-space'
import { downloadDelta, limitedBody } from './portable-delta'

const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
async function request(value: string, signal: AbortSignal, headers: Record<string, string> = {}): Promise<Response> {
 let url = new URL(value)
 for (let i=0;i<6;i++) {
  if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error('Invalid update download address')
  const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'GreenLauncher', ...headers } })
  if (![301,302,303,307,308].includes(response.status)) return response
  const location = response.headers.get('location');await response.body?.cancel()
  if (!location) throw new Error('Missing update redirect')
  url = new URL(location,url)
 }
 throw new Error('Too many update redirects')
}
export async function sha256(file: string): Promise<string> {
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')
}
export class PortableUpdateTransport {
 private verified = new Map<string,{ sha256: string; runtimeSize: number }>()
 constructor(private cache: string, private target: string, private helper: string, private receipt: string, private current: string, private quit:()=>void) {}
 async download(version: string, progress:(state:Partial<LauncherUpdate>)=>void, signal:AbortSignal):Promise<string[]> {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid update version')
  const base=`https://github.com/Despical/GreenLauncher/releases/download/v${version}/`
  const metadataResponse=await request(base+'portable-update.json',signal)
  if(!metadataResponse.ok)throw Object.assign(new Error('Portable update metadata unavailable'),{code:'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'})
  const metadata=JSON.parse((await limitedBody(metadataResponse,4096,signal)).toString('utf8')) as {version:string;file:string;sha256:string;size:number;runtimeSize?:number;blockmap?:{file:string;sha256:string;size:number}}
  if(metadata.version!==version||metadata.file!==`GreenLauncher-${version}.exe`||!/^[a-f0-9]{64}$/.test(metadata.sha256)||!Number.isSafeInteger(metadata.size)||metadata.size<1024||metadata.size>500*1024*1024)throw new Error('Invalid portable update metadata')
  if (metadata.runtimeSize !== undefined && (!Number.isSafeInteger(metadata.runtimeSize) || metadata.runtimeSize < metadata.size || metadata.runtimeSize > 2 * 1024 ** 3)) throw new Error('Invalid portable runtime size')
  const runtimeSize = metadata.runtimeSize ?? metadata.size * 4
  if (metadata.blockmap && (metadata.blockmap.file !== metadata.file + '.blocks.json' || !/^[a-f0-9]{64}$/.test(metadata.blockmap.sha256) || !Number.isSafeInteger(metadata.blockmap.size) || metadata.blockmap.size < 32 || metadata.blockmap.size > 4 * 1024 ** 2)) throw new Error('Invalid portable block map metadata')
  mkdirSync(this.cache,{recursive:true})
  const file=join(this.cache,metadata.file),temporary=file+'.download'
  if(existsSync(file)&&await sha256(file)===metadata.sha256){this.verified.set(file,{sha256:metadata.sha256,runtimeSize});progress({percent:100,transferred:metadata.size,total:metadata.size});return[file]}
  rmSync(temporary,{force:true})
  const leases: Array<ReturnType<ReturnType<typeof diskSpace>['reserve']>> = []
  try {
   const lease = diskSpace().reserve(file, metadata.size); leases.push(lease)
   leases.push(diskSpace().reserve(this.target, metadata.size))
   const runtimeRoot = join(process.env.LOCALAPPDATA ?? dirname(this.cache), 'GreenLauncher', 'runtime')
   leases.push(diskSpace().reserve(runtimeRoot, runtimeSize))
   let result: {transferred: number;total: number} | undefined
   if (metadata.blockmap && existsSync(this.target)) {
    try {
     result = await downloadDelta({source:this.target,destination:temporary,url:base+metadata.file,size:metadata.size,map:metadata.blockmap,base,signal,request,progress,written: bytes => {lease.consume(bytes);lease.check()} })
     if (await sha256(temporary) !== metadata.sha256) throw new Error('Reconstructed portable update checksum mismatch')
    } catch(error) {
     rmSync(temporary,{force:true});if(signal.aborted || isDiskSpaceError(error))throw error
     lease.ensure(metadata.size);progress({percent:0,transferred:0,total:metadata.size,bytesPerSecond:0})
    }
   }
   if (!result || !existsSync(temporary)) {
    const response=await request(base+metadata.file,signal)
    if(!response.ok||!response.body)throw new Error(`Update download failed (${response.status})`)
    let transferred=0,last=Date.now(),lastBytes=0;const hash=createHash('sha256')
    const meter=new Transform({transform(chunk:Buffer,_encoding,callback){
     try {transferred+=chunk.length;hash.update(chunk);lease.consume(chunk.length);lease.check();const now=Date.now();if(now-last>=150){progress({transferred,total:metadata.size,percent:transferred/metadata.size*100,bytesPerSecond:(transferred-lastBytes)*1000/(now-last)});last=now;lastBytes=transferred}callback(transferred>metadata.size?new Error('Update size mismatch'):null,chunk)}catch(error){callback(error as Error)}
    }})
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),meter,createWriteStream(temporary),{signal})
    if(transferred!==metadata.size||hash.digest('hex')!==metadata.sha256)throw Object.assign(new Error('Portable update checksum mismatch'),{code:'ERR_CHECKSUM_MISMATCH'})
    result = {transferred,total:metadata.size}
   }
   if(existsSync(file))rmSync(file);renameSync(temporary,file);this.verified.set(file,{sha256:metadata.sha256,runtimeSize});progress({percent:100,...result,bytesPerSecond:0});return[file]
  }catch(error){rmSync(temporary,{force:true});throw error}
  finally {for(const lease of leases)lease.release()}
 }
 async install(file:string,version:string):Promise<void>{
  const verified=this.verified.get(file)
  if(!verified||await sha256(file)!==verified.sha256)throw Object.assign(new Error('Staged update checksum mismatch'),{code:'ERR_CHECKSUM_MISMATCH'})
  if(!existsSync(this.target)||!existsSync(this.helper))throw new Error('Update helper or portable executable is missing')
  const lease = diskSpace().reserve(this.target,statSync(file).size)
  try { diskSpace().check(join(process.env.LOCALAPPDATA ?? dirname(this.cache),'GreenLauncher','runtime'),verified.runtimeSize) }
  finally {lease.release()}
  const child=spawn(this.helper,[resolve(this.target),resolve(file),verified.sha256,resolve(this.receipt),this.current,version,String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true})
  await new Promise<void>((accept,reject)=>{child.once('spawn',accept);child.once('error',reject)})
  child.unref();this.quit()
 }
}
export function confirmUpdate(dataPath:string,version:string,target:string,logs:ErrorLog,onConfirmed?:(result:{version:string;at:string})=>void):{version:string;at:string}|undefined{
 const path=join(dataPath,'update-result.json');if(!existsSync(path))return
 try {
  const raw=readFileSync(path,'utf8');if(raw.length>4096)return
  const result=JSON.parse(raw) as {status:string;from:string;version:string;target:string;error?:number;logged?:boolean;completedAt?:string;historyRecorded?:boolean}
  if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(result.version)||typeof result.target!=='string')return
  if(resolve(result.target).toLowerCase()!==resolve(target).toLowerCase())return
  if(result.status==='applied'&&result.version===version){result.status='confirmed';result.completedAt=new Date().toISOString();logs.info('Launcher güncellemesi',`v${result.from} → v${version}: güncelleme başarıyla tamamlandı.`);result.logged=true}
  else if(result.status==='failed'&&!result.logged){logs.record('Launcher güncellemesi',Object.assign(new Error(`Güncelleme uygulanamadı; önceki sürüm korundu. Windows hata kodu: ${result.error??0}`),{code:'UPDATE_APPLY_FAILED'}));result.logged=true}
  else if(result.status==='confirmed'&&result.completedAt){if(result.historyRecorded||!onConfirmed)return {version:result.version,at:result.completedAt}}
  else return
  if(result.status==='confirmed'&&result.completedAt&&!result.historyRecorded&&onConfirmed){onConfirmed({version:result.version,at:result.completedAt});result.historyRecorded=true}
  const temporary=path+'.confirm';writeFileSync(temporary,JSON.stringify(result),'utf8');renameSync(temporary,path)
  if(result.status==='confirmed')return {version:result.version,at:result.completedAt!}
 }catch(error){logs.record('Launcher güncellemesi',error)}
}
export function installedUpdateReceipt(dataPath:string,from:string,version:string,target:string):void{
 mkdirSync(dataPath,{recursive:true});writeFileSync(join(dataPath,'update-result.json'),JSON.stringify({status:'applied',from,version,target}),'utf8')
}
