const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createSourceLoader}=require('./test-source.cjs')
const load=createSourceLoader(),{ProjectSummaryCache}=load('src/main/project-summary-cache.ts'),{ModFavorites}=load('src/main/mod-favorites.ts')
let now=0,requests=0,count=999,offline=false
const cache=new ProjectSummaryCache(120000,()=>now)
const old={projectId:'AABBCCDD',slug:'sample',title:'Old title',description:'Old description',author:'Owner',downloads:111,updated:'old',categories:['utility'],iconUrl:null,provider:'modrinth',contentType:'mod',savedAt:'2026-10-01T00:00:00Z'}
const fetchBatch=async ids=>{requests++;await new Promise(r=>setTimeout(r,10));if(offline)throw Error('offline');return ids.map(projectId=>({...old,projectId,title:'New title',description:'New description',downloads:count,updated:'new',categories:['optimization']}))}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'green-favorites-cache-'))
;(async()=>{
 const [normal,favorite]=await Promise.all([cache.hydrate([old],fetchBatch),cache.hydrate([old],fetchBatch)])
 assert.equal(requests,1);assert.equal(normal[0].downloads,999);assert.equal(favorite[0].downloads,999);assert.equal(favorite[0].title,'New title');assert.equal(favorite[0].author,'Owner')
 normal[0].categories.push('external-mutation');assert.equal((await cache.hydrate([old],fetchBatch))[0].categories.length,1)
 now=120001;count=1500;const [fresh]=await cache.hydrate([old],fetchBatch);assert.equal(fresh.downloads,1500);assert.equal(requests,2)
 now=240002;offline=true;assert.equal((await cache.hydrate([old],fetchBatch))[0].downloads,1500)
 now+=10;await cache.hydrate([old],fetchBatch);assert.equal(requests,3)
 const favorites=new ModFavorites(path.join(root,'favorites.json'));favorites.set(old,true);const savedAt=favorites.get()[0].savedAt
 assert.equal(favorites.refresh('modrinth',[fresh]),true);assert.equal(favorites.get()[0].savedAt,savedAt);assert.equal(favorites.get()[0].downloads,1500)
 assert.equal(new ModFavorites(path.join(root,'favorites.json')).get()[0].description,'New description')
 favorites.set(old,false);favorites.refresh('modrinth',[fresh]);assert.equal(favorites.get().length,0)
 console.log('PASS canonical counts for search/favorites, TTL refresh, coalesced batches, stale offline fallback, clone isolation, saved metadata persisted without changing savedAt or resurrecting removed favorites')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{assert.equal(path.dirname(root),os.tmpdir());fs.rmSync(root,{recursive:true,force:true})})
