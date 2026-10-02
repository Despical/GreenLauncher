import type { ModProject, ModSearchResult, ModSort, ModVersion } from '../shared/types'
import { providerFetch, providerJson } from './provider-network'
export interface TechnicPack { name:string;displayName:string;description:string;user?:string;installs?:number;minecraft:string;forge?:string;version:string;url?:string;solder?:string;platformUrl:string;icon?:{url:string};feed?:Array<{date:number;content:string}>;tags?:string }
export interface TechnicBuild { minecraft:string;forge?:string;java?:string;memory?:number;mods:Array<{name:string;version:string;url:string;md5?:string}> }
const api='https://api.technicpack.net'
const slug=(value:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('Geçersiz Technic paket adı.');return value}
const buildName=(value:string)=>{if(!/^[a-zA-Z0-9._+-]{1,100}$/.test(value))throw new Error('Geçersiz Technic paket sürümü.');return value}
export class TechnicService {
  private cache=new Map<string,{at:number;value:TechnicPack}>()
  async pack(name:string):Promise<TechnicPack>{
    slug(name);const cached=this.cache.get(name);if(cached&&Date.now()-cached.at<300000)return cached.value
    const value=await providerJson<TechnicPack>(`${api}/modpack/${name}?build=green-launcher`)
    if(value.name!==name||!value.displayName)throw new Error('Technic paket bilgisi geçersiz.')
    this.cache.set(name,{at:Date.now(),value});if(this.cache.size>150)this.cache.delete(this.cache.keys().next().value!)
    return value
  }
  private solder(pack:TechnicPack):string { if(!pack.solder)throw new Error('Paket sürüm sunucusu bulunamadı.');const url=new URL(pack.solder);url.protocol='https:';return url.toString().replace(/\/$/,'') }
  async search(query:string,gameVersion:string,sort:ModSort,offset:number):Promise<ModSearchResult>{
    let names:string[]=[]
    if(query.trim()){
      const text=query.trim();const match=text.match(/^https:\/\/(?:www\.)?technicpack.net\/modpack\/([a-zA-Z0-9_-]+)\.\d+/)||text.match(/^https:\/\/api.technicpack.net\/modpack\/([a-zA-Z0-9_-]+)/)
      if(match)names=[match[1]]
      else {const result=await providerJson<{modpacks:Array<{slug:string}>}>(`${api}/search?build=green-launcher&q=${encodeURIComponent(text.slice(0,100))}`);names=result.modpacks.map(p=>p.slug)}
    }else{
      const response=await providerFetch(`${api}/discover?build=green-launcher`)
      if(!response.ok)throw new Error('Technic keşfet listesi alınamadı.')
      const html=await response.text()
      names=[...new Set([...html.matchAll(/https:\/\/www\.technicpack\.net\/modpack\/([a-zA-Z0-9_-]+)\.\d+/g)].map(m=>m[1]))]
    }
    names=[...new Set(names)].slice(0,60)
    const packs:TechnicPack[]=[]
    // Four requests at a time keeps the public platform responsive.
    for(let i=0;i<names.length;i+=4){const batch=await Promise.allSettled(names.slice(i,i+4).map(name=>this.pack(name)));for(const result of batch)if(result.status==='fulfilled')packs.push(result.value)}
    if(names.length&&!packs.length)throw new Error('Technic paket bilgileri şu anda alınamıyor. Tekrar dene.')
    const filtered=packs.filter(p=>!gameVersion||gameVersion==='all'||p.minecraft===gameVersion)
    if(sort==='downloads')filtered.sort((a,b)=>(b.installs??0)-(a.installs??0))
    if(sort==='updated')filtered.sort((a,b)=>(b.feed?.[0]?.date??0)-(a.feed?.[0]?.date??0))
    return {total:filtered.length,hits:filtered.slice(offset,offset+9).map(p=>({projectId:p.name,slug:p.name,title:p.displayName,description:p.description,author:p.user??'Technic',iconUrl:p.icon?.url??null,downloads:p.installs??0,updated:p.feed?.[0]?.date?new Date(p.feed[0].date*1000).toISOString():'',categories:p.tags?.split(',')??[]}))}
  }
  async project(name:string):Promise<ModProject>{const p=await this.pack(name);return {id:p.name,slug:p.name,title:p.displayName,description:p.description,body:p.description,iconUrl:p.icon?.url??null,downloads:p.installs??0,license:'—',sourceUrl:p.platformUrl,projectType:'modpack'}}
  async versions(name:string):Promise<ModVersion[]>{
    const p=await this.pack(name)
    let builds=[p.version],recommended=p.version
    if(p.solder){const info=await providerJson<{builds:string[];recommended:string}>(`${this.solder(p)}/modpack/${slug(name)}`);builds=info.builds;recommended=info.recommended}
    if(!Array.isArray(builds))throw new Error('Technic sürüm listesi geçersiz.')
    return [...new Set([recommended,...builds.slice().reverse()])].filter(Boolean).map(b=>({id:`${slug(name)}:${buildName(b)}`,name:b,versionNumber:b,type:b===recommended?'recommended':'release',published:'',downloads:0,gameVersions:[p.minecraft],loaders:[]}))
  }
  async build(value:string):Promise<{pack:TechnicPack;version:string;build:TechnicBuild}>{
    const [name,version,...extra]=value.split(':');if(extra.length)throw new Error('Geçersiz Technic sürümü.');slug(name);buildName(version)
    const pack=await this.pack(name)
    if(!(await this.versions(name)).some(v=>v.id===value))throw new Error('Technic paket sürümü bulunamadı.')
    const build=pack.solder?await providerJson<TechnicBuild>(`${this.solder(pack)}/modpack/${name}/${encodeURIComponent(version)}`):{minecraft:pack.minecraft,forge:pack.forge,mods:pack.url?[{name,version,url:pack.url}]:[]}
    if(!Array.isArray(build.mods)||!build.mods.length||build.mods.length>2000||!/^\d[\w.-]{0,89}$/.test(build.minecraft))throw new Error('Technic paket dosyaları eksik veya geçersiz.')
    return {pack,version,build}
  }
}
