import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { LauncherUpdate } from '../shared/types'
import type { ErrorLog } from './error-log'

const hosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])
async function request(value: string, signal: AbortSignal): Promise<Response> {
 let url = new URL(value)
 for (let i=0;i<6;i++) {
  if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error('Invalid update download address')
  const response = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'GreenLauncher' } })
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
 private verified = new Map<string,string>()
 constructor(private cache: string, private target: string, private helper: string, private receipt: string, private current: string, private quit:()=>void) {}
 async download(version: string, progress:(state:Partial<LauncherUpdate>)=>void, signal:AbortSignal):Promise<string[]> {
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Invalid update version')
  const base=`https://github.com/Despical/GreenLauncher/releases/download/v${version}/`
  const metadataResponse=await request(base+'portable-update.json',signal)
  if(!metadataResponse.ok)throw Object.assign(new Error('Portable update metadata unavailable'),{code:'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'})
  const raw=await metadataResponse.text();if(raw.length>4096)throw new Error('Invalid portable update metadata')
  const metadata=JSON.parse(raw) as {version:string;file:string;sha256:string;size:number}
  if(metadata.version!==version||metadata.file!==`GreenLauncher-${version}.exe`||!/^[a-f0-9]{64}$/.test(metadata.sha256)||!Number.isSafeInteger(metadata.size)||metadata.size<1024||metadata.size>500*1024*1024)throw new Error('Invalid portable update metadata')
  mkdirSync(this.cache,{recursive:true})
  const file=join(this.cache,metadata.file),temporary=file+'.download'
  if(existsSync(file)&&await sha256(file)===metadata.sha256){this.verified.set(file,metadata.sha256);progress({percent:100,transferred:metadata.size,total:metadata.size});return[file]}
  const response=await request(base+metadata.file,signal)
  if(!response.ok||!response.body)throw new Error(`Update download failed (${response.status})`)
  let transferred=0,last=Date.now(),lastBytes=0;const hash=createHash('sha256')
  const meter=new Transform({transform(chunk:Buffer,_encoding,callback){transferred+=chunk.length;hash.update(chunk);const now=Date.now();if(now-last>=150){progress({transferred,total:metadata.size,percent:transferred/metadata.size*100,bytesPerSecond:(transferred-lastBytes)*1000/(now-last)});last=now;lastBytes=transferred}callback(transferred>metadata.size?new Error('Update size mismatch'):null,chunk)}})
  try {
   await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),meter,createWriteStream(temporary),{signal})
   if(transferred!==metadata.size||hash.digest('hex')!==metadata.sha256)throw Object.assign(new Error('Portable update checksum mismatch'),{code:'ERR_CHECKSUM_MISMATCH'})
   if(existsSync(file))rmSync(file);renameSync(temporary,file);this.verified.set(file,metadata.sha256);progress({percent:100,transferred,total:metadata.size,bytesPerSecond:0});return[file]
  }catch(error){rmSync(temporary,{force:true});throw error}
 }
 async install(file:string,version:string):Promise<void>{
  const expected=this.verified.get(file)
  if(!expected||await sha256(file)!==expected)throw Object.assign(new Error('Staged update checksum mismatch'),{code:'ERR_CHECKSUM_MISMATCH'})
  if(!existsSync(this.target)||!existsSync(this.helper))throw new Error('Update helper or portable executable is missing')
  const child=spawn(this.helper,[resolve(this.target),resolve(file),expected,resolve(this.receipt),this.current,version,String(process.pid)],{detached:true,stdio:'ignore',windowsHide:true})
  await new Promise<void>((accept,reject)=>{child.once('spawn',accept);child.once('error',reject)})
  child.unref();this.quit()
 }
}
export function confirmUpdate(dataPath:string,version:string,target:string,logs:ErrorLog):{version:string;at:string}|undefined{
 const path=join(dataPath,'update-result.json');if(!existsSync(path))return
 try {
  const raw=readFileSync(path,'utf8');if(raw.length>4096)return
  const result=JSON.parse(raw) as {status:string;from:string;version:string;target:string;error?:number;logged?:boolean;completedAt?:string}
  if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(result.version)||typeof result.target!=='string')return
  if(resolve(result.target).toLowerCase()!==resolve(target).toLowerCase())return
  if(result.status==='applied'&&result.version===version){result.status='confirmed';result.completedAt=new Date().toISOString();logs.info('Launcher güncellemesi',`v${result.from} → v${version}: güncelleme başarıyla tamamlandı.`);result.logged=true}
  else if(result.status==='failed'&&!result.logged){logs.record('Launcher güncellemesi',Object.assign(new Error(`Güncelleme uygulanamadı; önceki sürüm korundu. Windows hata kodu: ${result.error??0}`),{code:'UPDATE_APPLY_FAILED'}));result.logged=true}
  else if(result.status==='confirmed'&&result.completedAt)return {version:result.version,at:result.completedAt}
  else return
  const temporary=path+'.confirm';writeFileSync(temporary,JSON.stringify(result),'utf8');renameSync(temporary,path)
  if(result.status==='confirmed')return {version:result.version,at:result.completedAt!}
 }catch(error){logs.record('Launcher güncellemesi',error)}
}
export function installedUpdateReceipt(dataPath:string,from:string,version:string,target:string):void{
 mkdirSync(dataPath,{recursive:true});writeFileSync(join(dataPath,'update-result.json'),JSON.stringify({status:'applied',from,version,target}),'utf8')
}
