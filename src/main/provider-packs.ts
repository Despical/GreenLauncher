import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { LauncherActivity, LauncherProfile, ModLoader, ModProvider } from '../shared/types'
import { CurseForgeService } from './curseforge'
import { TechnicService } from './technic'
import { LauncherStore } from './store'
import { GameService } from './game'
import { extractOverrides, safePath, streamEntry, walkArchive } from './modpack'
import { downloadProviderFile } from './provider-network'

export async function archiveJson<T>(archive:string,name:string):Promise<T|null>{
  let result:T|null=null
  await walkArchive(archive,async(entry,zip)=>{
    if(entry.fileName!==name)return
    if(entry.uncompressedSize>2*1024*1024)throw new Error('Paket bilgisi çok büyük.')
    const chunks:Buffer[]=[];let size=0
    for await(const chunk of await streamEntry(zip,entry)){size+=chunk.length;if(size>2*1024*1024)throw new Error('Paket bilgisi çok büyük.');chunks.push(Buffer.from(chunk))}
    result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  })
  return result
}
interface CurseManifest { minecraft:{version:string;modLoaders:Array<{id:string;primary:boolean}>};manifestType:string;manifestVersion:number;name:string;files:Array<{projectID:number;fileID:number;required:boolean}>;overrides:string }
export class ProviderPacks {
  constructor(private store:LauncherStore,private game:GameService,private curse:CurseForgeService,private technic:TechnicService,private emit:(a:LauncherActivity)=>void){}
  async install(provider:ModProvider,versionId:string){
    const owner=this.store.get().selectedAccountId
    if(!owner)throw new Error('Önce bir hesap seçin.')
    const cache=join(this.store.dataPath,'cache','provider-packs');mkdirSync(cache,{recursive:true})
    const stage=mkdtempSync(join(cache,'stage-')),content=join(stage,'content')
    let title='',projectId='',gameVersion='',sourceUrl:string|undefined,loader:ModLoader|undefined,loaderVersion='',memory=this.store.get().settings.memoryMb
    const paths=new Set<string>()
    this.emit({kind:'installing',label:'Mod paketi hazırlanıyor',progress:2})
    if(provider==='curseforge'){
      const file=await this.curse.file(versionId),project=await this.curse.project(String(file.modId))
      if(project.projectType!=='modpack')throw new Error('Seçilen proje mod paketi değil.')
      title=project.title;projectId=project.id;sourceUrl=project.sourceUrl ?? undefined
      const archive=join(stage,'pack.zip');await this.curse.download(file,archive)
      const manifest=await archiveJson<CurseManifest>(archive,'manifest.json')
      if(!manifest||manifest.manifestType!=='minecraftModpack'||manifest.manifestVersion!==1||!Array.isArray(manifest.files)||manifest.files.length>2000||!manifest.minecraft||!Array.isArray(manifest.minecraft.modLoaders)||typeof manifest.overrides!=='string')throw new Error('Desteklenmeyen CurseForge paket biçimi.')
      gameVersion=manifest.minecraft.version
      const primary=manifest.minecraft.modLoaders.find(l=>l.primary)??manifest.minecraft.modLoaders[0]
      const match=primary?.id.match(/^(forge|neoforge|fabric|quilt)-(.+)$/)
      if(manifest.minecraft.modLoaders.length!==1||!match)throw new Error('Paket yükleyicisi henüz desteklenmiyor.')
      loader=match[1] as ModLoader;loaderVersion=match[2]
      for(const [index,item] of manifest.files.entries()){
        if(!item.required)continue
        this.emit({kind:'installing',label:'Mod paketi dosyaları indiriliyor',detail:`${index+1}/${manifest.files.length}`,progress:8+Math.round(index/Math.max(1,manifest.files.length)*65)})
        const mod=await this.curse.file(`${item.projectID}:${item.fileID}`)
        const extension=await this.curse.destination(String(mod.modId))
        if(!/\.(jar|litemod|zip)$/i.test(mod.fileName))throw new Error('Paket dosya türü desteklenmiyor.')
        const relative=`${extension}/${basename(mod.fileName)}`;await this.curse.download(mod,safePath(content,relative));paths.add(relative)
      }
      const layer=manifest.overrides.replace(/\/$/,'')+'/';safePath(content,layer.slice(0,-1))
      for(const p of await extractOverrides(archive,content,layer))paths.add(p)
    }else if(provider==='technic'){
      const {pack,build}=await this.technic.build(versionId)
      title=pack.displayName;projectId=pack.name;gameVersion=build.minecraft;sourceUrl=pack.platformUrl
      const forge=build.forge||build.mods.find(m=>/^(forge|minecraftforge|fml)$/i.test(m.name))?.version
      if(forge){loader='forge';loaderVersion=forge.replace(new RegExp('^'+gameVersion.replace(/\./g,'\\.')+'-'),'')}
      if(build.memory)memory=Math.max(memory,Math.min(32768,build.memory))
      for(const [index,file] of build.mods.entries()){
        this.emit({kind:'installing',label:'Mod paketi dosyaları indiriliyor',detail:`${index+1}/${build.mods.length}`,progress:8+Math.round(index/build.mods.length*65)})
        const archive=join(stage,`part-${index}.zip`)
        await downloadProviderFile(file.url,archive,{md5:file.md5})
        for(const p of await extractOverrides(archive,content,''))paths.add(p)
        if(paths.size>40000)throw new Error('Paket çok fazla dosya içeriyor.')
      }
      if(!loader){
        const manifest=existsSync(join(content,'bin','version.json'))?JSON.parse(readFileSync(join(content,'bin','version.json'),'utf8')):existsSync(join(content,'bin','modpack.jar'))?await archiveJson<{libraries?:Array<{name:string}>}>(join(content,'bin','modpack.jar'),'version.json'):null
        const coordinate=manifest?.libraries?.map((l:{name:string})=>l.name).find((name:string)=>/^(net\.minecraftforge:forge|net\.fabricmc:fabric-loader|org\.quiltmc:quilt-loader|net\.neoforged:neoforge):/.test(name))
        if(coordinate){loader=coordinate.startsWith('net.minecraftforge:')?'forge':coordinate.startsWith('net.fabricmc:')?'fabric':coordinate.startsWith('org.quiltmc:')?'quilt':'neoforge';loaderVersion=coordinate.split(':')[2].replace(new RegExp('^'+gameVersion.replace(/\./g,'\\.')+'-'),'')}
      }
      if(!loader && [...paths].some(p=>p==='bin/modpack.jar'||p.startsWith('mods/')))throw new Error('Bu Technic paketinin eski veya özel yükleyicisi henüz desteklenmiyor.')
      // The launcher installs the official loader; arbitrary pack launch scripts are never run.
      for(const p of paths)if(p.startsWith('bin/'))paths.delete(p)
    }else throw new Error('Geçersiz paket kaynağı.')
    if(!/^[a-zA-Z0-9._-]{1,90}$/.test(gameVersion)||(loader&&!/^[a-zA-Z0-9._-]{1,90}$/.test(loaderVersion)))throw new Error('Paket oyun veya yükleyici sürümü geçersiz.')
    if(this.store.get().selectedAccountId!==owner)throw new Error('Kurulum sırasında hesap değişti.')
    const state=this.store.get()
    const template:LauncherProfile={id:'',name:title,versionId:gameVersion,javaPath:'',memoryMb:memory,minMemoryMb:Math.min(1024,memory),width:state.settings.width,height:state.settings.height,createdAt:new Date().toISOString()}
    this.emit({kind:'installing',label:'Mod paketi yükleyicisi hazırlanıyor',progress:78})
    const installedLoader=loader?await this.game.installModLoader(gameVersion,loader,template,loaderVersion):undefined
    let name=title.slice(0,42),suffix=2
    while(state.profiles.some(p=>p.name===name))name=`${title.slice(0,38)} (${suffix++})`
    const saved=this.store.saveProfile({...template,name}),profileId=saved.selectedProfileId!
    try{
      const directory=this.store.profilePath(profileId)
      for(const p of paths){const target=safePath(directory,p);mkdirSync(dirname(target),{recursive:true});copyFileSync(safePath(content,p),target)}
      if(loader&&installedLoader)this.store.setModLoader(profileId,gameVersion,loader,installedLoader)
      const metadata={provider,projectId:`${provider}:${projectId}`,versionId,title,name:title,fileCount:paths.size,files:[...paths]}
      writeFileSync(join(directory,'green-launcher-pack.json'),JSON.stringify(metadata,null,2))
      this.store.setModpack(profileId,{projectId:`${provider}:${projectId}`,versionId,title,fileCount:paths.size,provider,sourceUrl,loader})
      this.emit({kind:'idle',label:'Hazır'});return {state:this.store.get(),profileId}
    }catch(error){this.store.deleteProfile(profileId);if(state.selectedProfileId)this.store.selectProfile(state.selectedProfileId);throw error}
  }
}
