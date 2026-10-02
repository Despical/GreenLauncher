import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 await evaluate("window.launcher.saveSettings({language:'tr',qaUpdate:{phase:'current',version:null,error:null,downloadedAt:null,lastInstalled:null}})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 await key('1');assert.equal(await evaluate("!!document.querySelector('.statusbar-update')"),false)
 await key('9');await button('Hakkında');assert.equal(await evaluate("!!document.querySelector('.launcher-update-panel')"),false);await button('Launcher');await until("document.querySelector('.launcher-update-panel')")
 assert.match(await evaluate("document.querySelector('.launcher-update-panel').textContent"),/En son sürüm yüklü/)
 await button('Kontrol et');await until("document.querySelector('.update-last-check')")
 const setUpdate=async value=>await evaluate('window.launcher.saveSettings({qaUpdate:'+JSON.stringify(value)+'})')
 await setUpdate({phase:'available',version:'0.18.0',notes:'New release notes\nWorlds and servers improved.'})
 await key('1');assert.equal(await evaluate("!!document.querySelector('.home-update')"),false)
 assert.equal(await evaluate("document.querySelectorAll('.update-notes').length"),0)
 await shot('qa-update-home')
 await click('.statusbar-update');await until("document.querySelector('.main-content.page-downloads .launcher-update-job')")
 assert.equal(await evaluate("document.querySelectorAll('.account-dialog,.changelog-dialog').length"),0)
 const footer=await evaluate("(()=>{const g=document.querySelector('.statusbar-release'),u=g.querySelector('.statusbar-update').getBoundingClientRect(),v=g.querySelector('.statusbar-changelog').getBoundingClientRect();return {border:getComputedStyle(g).borderLeftWidth,u:u.left,v:v.left}})()")
 assert.equal(footer.border,'1px');assert.ok(footer.u<footer.v)
 await button('Güncellemeyi indir');await until("document.querySelector('.launcher-update-job [aria-valuenow=\"42\"]')")
 assert.equal(await evaluate("document.querySelectorAll('.launcher-update-job .download-job-metrics>div').length"),3)
 assert.ok(await evaluate("document.querySelector('.launcher-update-job img').naturalWidth")>=512)
 await shot('qa-update-downloads')
 await button('İndirmeyi iptal et');await until("window.launcher.getUpdate().then(s=>s.phase==='available')")
 await setUpdate({phase:'error',error:'network',operation:'download'});await until("document.querySelector('.launcher-update-job .update-error')");assert.match(await evaluate("document.querySelector('.launcher-update-job .update-error').textContent"),/Bağlantını/)
 await until("document.querySelector('.toast')");assert.match(await evaluate("document.querySelector('.toast').textContent"),/Güncelleme indirilemedi/)
 await button('Yeniden dene');await setUpdate({phase:'ready',percent:100,error:null})
 await until("[...document.querySelectorAll('.launcher-update-history button')].some(b=>b.textContent.includes('Yeniden başlat ve güncelle'))")
 assert.equal(await evaluate("document.querySelectorAll('.download-jobs .launcher-update-job').length"),0)
 await button('Yeniden başlat ve güncelle');await until("document.querySelector('.launcher-update-history .update-error')")
 assert.match(await evaluate("document.querySelector('.launcher-update-history .update-error').textContent"),/oyunu/)
 await shot('qa-update-ready')
 await setUpdate({phase:'current',version:null,error:null,lastInstalled:{version:'0.17.5',at:'2026-10-02T15:00:00Z'}});await until("document.querySelector('.download-history .launcher-update-history')")
 assert.match(await evaluate("document.querySelector('.download-history').textContent"),/başarıyla/)
 assert.equal(await evaluate("document.querySelectorAll('.download-jobs .launcher-update-job').length"),0)
 await button('Geçmişi temizle');await call('Page.reload');await until("document.querySelector('.side-nav')");await key('8');assert.equal(await evaluate("document.querySelectorAll('.launcher-update-history').length"),0)
 for(const language of ['tr','en','de','fr','ru','pl']){
   await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')");await key('1');assert.equal(await evaluate("!!document.querySelector('.home-update')"),false);await key('9');await button('Launcher')
   await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
   assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.launcher-update-settings button')].every(b=>b.scrollWidth<=b.clientWidth+1)"),language)
 }
 for(const page of ['4','5']){
   await key(page);await until("document.querySelector('.retained-page:not([hidden]) .server-row')")
   const row=await evaluate("(()=>{const p=document.querySelector('.retained-page:not([hidden]) .servers-list-panel').getBoundingClientRect(),r=document.querySelectorAll('.retained-page:not([hidden]) .server-row')[1].getBoundingClientRect();return {left:r.left,right:r.right,pLeft:p.left,pRight:p.right,x:r.left+2,y:r.top+5}})()")
   assert.ok(Math.abs(row.left-row.pLeft-1)<1&&Math.abs(row.pRight-row.right-1)<1)
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:row.x,y:row.y});await wait(220)
   assert.equal(await evaluate("getComputedStyle(document.querySelectorAll('.retained-page:not([hidden]) .server-row')[1]).backgroundColor"),'rgb(33, 38, 45)')
 }
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS manual current-version check, no homepage notes, bottom-bar Downloads navigation, completed history, progress, download error toast, cancel/retry, busy install notice and six-language layout')
} finally {socket.close()}
`
await new Function('assert', 'writeFileSync', 'return (async()=>{' + helpers + checks + '})()')(assert, writeFileSync)
