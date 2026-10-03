import { safeStorage } from 'electron'
import { copyFileSync, existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { InstalledMod, ModContentType, ModLoader, ModProject, ModSearchResult, ModSort, ModVersion } from '../shared/types'
import { LauncherStore } from './store'
import { downloadProviderFile, providerJson } from './provider-network'
declare const __CURSEFORGE_API_KEY__: string
const defaultKey = typeof __CURSEFORGE_API_KEY__ === 'string' ? __CURSEFORGE_API_KEY__ : ''
const api = 'https://api.curseforge.com/v1'
const loaderIds: Record<ModLoader, number> = { forge: 1, liteloader: 3, fabric: 4, quilt: 5, neoforge: 6 }
export interface CurseFile { id: number; modId: number; displayName: string; fileName: string; releaseType: number; fileDate: string; downloadCount: number; downloadUrl: string | null; gameVersions: string[]; hashes: Array<{ algo: number; value: string }>; dependencies: Array<{ modId: number; relationType: number }>; isAvailable: boolean }
interface CurseMod { id: number; name: string; slug: string; summary: string; downloadCount: number; dateModified: string; authors: Array<{ name: string }>; logo?: { url: string }; categories: Array<{ id: number; name: string }>; classId: number; links: { websiteUrl: string; sourceUrl?: string }; allowModDistribution?: boolean }
const id = (value: string) => { if (!/^\d{1,12}$/.test(value)) throw new Error('Geçersiz CurseForge kimliği.'); return value }
export class CurseForgeService {
  private key = process.env.GREEN_CURSEFORGE_API_KEY || defaultKey
  private keyFile: string
  constructor(private store: LauncherStore) {
    this.keyFile = join(store.dataPath, 'curseforge-key.bin')
    if (existsSync(this.keyFile)) try { this.key = safeStorage.decryptString(readFileSync(this.keyFile)) } catch { /* A key encrypted for another Windows user is not usable. */ }
  }
  get connected() { return !!this.key }
  private headers = (url: URL): Record<string, string> => {
    if (url.hostname !== 'api.curseforge.com' && !['edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net'].includes(url.hostname)) throw new Error('CurseForge adresi doğrulanamadı.')
    if (!this.key) throw new Error('CurseForge bağlantısı henüz yapılandırılmadı.')
    return url.hostname === 'api.curseforge.com' ? { 'x-api-key': this.key, Accept: 'application/json' } : {}
  }
  async connect(value: string) {
    if (typeof value !== 'string' || value.trim().length < 20 || value.length > 512 || /[\r\n]/.test(value)) throw new Error('Geçerli bir CurseForge API anahtarı girin.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows güvenli anahtar deposu kullanılamıyor.')
    const candidate = value.trim()
    await providerJson(api + '/games/432', url => {
      if (url.hostname !== 'api.curseforge.com') throw new Error('CurseForge adresi doğrulanamadı.')
      return { 'x-api-key': candidate, Accept: 'application/json' }
    })
    writeFileSync(this.keyFile + '.tmp', safeStorage.encryptString(candidate))
    renameSync(this.keyFile + '.tmp', this.keyFile)
    this.key = candidate
  }
  private request<T>(path: string): Promise<T> { return providerJson<T>(api + path, this.headers) }
  async search(query: string, gameVersion: string, loader: ModLoader, sort: ModSort, offset: number, category: string, type: ModContentType): Promise<ModSearchResult> {
    const sorts = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 }
    const params = new URLSearchParams({ gameId: '432', classId: type === 'shader' ? '6552' : type === 'resourcepack' ? '12' : type === 'modpack' ? '4471' : '6', searchFilter: query.slice(0,100), gameVersion, sortField: String(sorts[sort]), sortOrder: 'desc', index: String(Math.max(0, Math.min(9990, offset))), pageSize: '9' })
    if (type === 'mod' || type === 'modpack') params.set('modLoaderType', String(loaderIds[loader]))
    if (category !== 'all') params.set('categoryId', id(category))
    const result = await this.request<{ data: CurseMod[]; pagination: { totalCount: number } }>('/mods/search?' + params)
    return { total: result.pagination.totalCount, hits: result.data.map(item => ({ projectId: String(item.id), slug: item.slug, title: item.name, description: item.summary, author: item.authors.map(a=>a.name).join(', '), iconUrl: item.logo?.url ?? null, downloads: item.downloadCount, updated: item.dateModified, categories: item.categories.map(c=>c.name) })) }
  }
  async categories(type: ModContentType) { const result = await this.request<{data:Array<{id:number;name:string;classId:number}>}>('/categories?gameId=432&classId='+(type==='shader'?6552:type==='resourcepack'?12:type==='modpack'?4471:6)); return result.data.map(c=>({value:String(c.id),label:c.name})) }
  async project(projectId: string): Promise<ModProject> {
    const [{data:item},{data:body}] = await Promise.all([this.request<{data:CurseMod}>(`/mods/${id(projectId)}`),this.request<{data:string}>(`/mods/${id(projectId)}/description`)])
    return {id:String(item.id),slug:item.slug,title:item.name,description:item.summary,body:body.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' '),iconUrl:item.logo?.url??null,downloads:item.downloadCount,license:'—',sourceUrl:item.links.websiteUrl,projectType:item.classId===6552?'shader':item.classId===12?'resourcepack':item.classId===4471?'modpack':'mod'}
  }
  async files(projectId: string, gameVersion: string, loader: ModLoader, allGameVersions = false, contentType: ModContentType = 'mod'): Promise<CurseFile[]> {
    const params = new URLSearchParams()
    if (!allGameVersions) params.set('gameVersion', gameVersion)
    if (contentType === 'mod' || contentType === 'modpack') params.set('modLoaderType', String(loaderIds[loader])); params.set('pageSize', '50')
    return (await this.request<{data:CurseFile[]}>(`/mods/${id(projectId)}/files?${params}`)).data.filter(f=>f.isAvailable)
  }
  async versions(projectId: string, gameVersion: string, loader: ModLoader, allGameVersions = false, contentType: ModContentType = 'mod'): Promise<ModVersion[]> { return (await this.files(projectId,gameVersion,loader,allGameVersions,contentType)).map(f=>({id:`${f.modId}:${f.id}`,name:f.displayName,versionNumber:f.displayName,type:({1:'release',2:'beta',3:'alpha'} as Record<number,string>)[f.releaseType]??'release',published:f.fileDate,downloads:f.downloadCount,gameVersions:f.gameVersions,loaders:contentType==='resourcepack'||contentType==='shader'?[]:[loader],filename:f.fileName})) }
  async file(value: string): Promise<CurseFile> {
    const [project,fileId,...extra]=value.split(':')
    if(extra.length)throw new Error('Geçersiz dosya kimliği.')
    const {data}=await this.request<{data:CurseFile}>(`/mods/${id(project)}/files/${id(fileId)}`)
    if(String(data.modId)!==project||String(data.id)!==fileId)throw new Error('CurseForge dosya bilgisi doğrulanamadı.')
    return data
  }
  async destination(projectId: string): Promise<string> {
    const {data}=await this.request<{data:CurseMod}>(`/mods/${id(projectId)}`)
    const folder=({6:'mods',12:'resourcepacks',6552:'shaderpacks'} as Record<number,string>)[data.classId]
    if(!folder)throw new Error('Paket içeriğinin türü desteklenmiyor.')
    return folder
  }
  async download(file: CurseFile, path: string) {
    if (!file.isAvailable || !file.downloadUrl) throw new Error(`${file.displayName}: yayıncı doğrudan indirmeye izin vermiyor. CurseForge sayfasından indirebilirsin.`)
    const sha1=file.hashes.find(h=>h.algo===1)?.value,md5=file.hashes.find(h=>h.algo===2)?.value
    if(!sha1&&!md5)throw new Error('CurseForge dosyasının doğrulama özeti yok.')
    await downloadProviderFile(file.downloadUrl,path,{sha1,md5},this.headers)
  }
  async install(profileId:string, versionId:string, repairing=false):Promise<InstalledMod[]> {
    const profile=this.store.get().profiles.find(p=>p.id===profileId)
    if(!profile?.modLoaderVersion||!profile.modLoader)throw new Error('Önce bu profile mod yükleyicisini kurun.')
    const manifest=join(this.store.profilePath(profileId),'green-launcher-mods.json')
    const installed:InstalledMod[]=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):[]
    const planned=new Map<number,CurseFile>()
    const visit=async(file:CurseFile,depth=0):Promise<void>=>{
      if(planned.has(file.modId))return
      if(depth>20||planned.size>=60)throw new Error('Mod bağımlılık zinciri çok uzun.')
      const compatible=await this.files(String(file.modId),profile.versionId,profile.modLoader!)
      if(!compatible.some(f=>f.id===file.id))throw new Error(`${file.displayName} seçili profil ile uyumlu değil.`)
      planned.set(file.modId,file)
      for(const dep of file.dependencies.filter(d=>d.relationType===3)){const choices=await this.files(String(dep.modId),profile.versionId,profile.modLoader!);if(!choices.length)throw new Error('Gerekli bağımlılığın uyumlu sürümü yok.');const pinned=repairing?installed.find(m=>m.provider==='curseforge'&&m.projectId===String(dep.modId))?.versionId.split(':')[1]:undefined;const chosen=pinned?choices.find(f=>String(f.id)===pinned):choices.find(f=>f.releaseType===1)??choices[0];if(!chosen)throw new Error('Kurulu bağımlılığın sürümü kaynakta bulunamadı.');await visit(chosen,depth+1)}
    }
    await visit(await this.file(versionId))
    const directory=join(this.store.gamePath(profile),'mods')
    // Stage every dependency before changing installed files.
    const staged:Array<{file:CurseFile;path:string;filename:string;title:string;sourceUrl?:string}>=[]
    for(const file of planned.values()){
      if(!/\.(jar|litemod)$/i.test(file.fileName))throw new Error('Seçilen dosya kurulabilir bir mod değil.')
      const filename=`cf-${file.modId}-${file.id}-${basename(file.fileName).replace(/[^a-zA-Z0-9._+()-]/g,'_').slice(0,100)}`
      const path=repairing?join(directory,filename):join(this.store.dataPath,'cache','curseforge',filename)
      await this.download(file,path);const project=await this.project(String(file.modId));staged.push({file,path,filename,title:project.title,sourceUrl:project.sourceUrl??undefined})
    }
    mkdirSync(directory,{recursive:true})
    for(const item of staged){
      const previous=installed.findIndex(m=>m.provider==='curseforge'&&m.projectId===String(item.file.modId))
      const old=installed[previous]
      if(old&&old.filename!==item.filename&&basename(old.filename)===old.filename&&existsSync(join(directory,old.filename)))renameSync(join(directory,old.filename),join(directory,old.filename+`.${Date.now()}.disabled`))
      if(item.path!==join(directory,item.filename))copyFileSync(item.path,join(directory,item.filename))
      const next:InstalledMod={provider:'curseforge',projectId:String(item.file.modId),title:item.title,versionId:`${item.file.modId}:${item.file.id}`,versionNumber:item.file.displayName,filename:item.filename,sourceUrl:item.sourceUrl}
      if(previous<0)installed.push(next);else installed[previous]=next
    }
    writeFileSync(manifest+'.tmp',JSON.stringify(installed,null,2));renameSync(manifest+'.tmp',manifest)
    return installed
  }
}
