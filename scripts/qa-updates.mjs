import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 await evaluate("window.launcher.saveSettings({language:'tr',qaUpdate:{phase:'current',version:null,error:null}})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 await key('1');assert.equal(await evaluate("!!document.querySelector('.statusbar-update')"),false)
 await key('9');await button('Hakkında');await until("document.querySelector('.launcher-update-panel')")
 assert.match(await evaluate("document.querySelector('.launcher-update-panel').textContent"),/En son sürümü/)
 await button('Güncellemeleri kontrol et');await until("document.querySelector('.update-last-check')")
 const setUpdate=async value=>await evaluate('window.launcher.saveSettings({qaUpdate:'+JSON.stringify(value)+'})')
 await setUpdate({phase:'available',version:'0.18.0',notes:'New release notes\nWorlds and servers improved.'})
 await key('1');await until("document.querySelector('.home-update')")
 assert.match(await evaluate("document.querySelector('.home-update .update-notes').textContent"),/New release notes/)
 await shot('qa-update-home')
 await click('.statusbar-update');await until("document.querySelector('.account-dialog .launcher-update-panel')")
 await button('Güncellemeyi indir');await until("document.querySelector('.account-dialog progress')")
 assert.equal(await evaluate("document.querySelector('.account-dialog progress').value"),42)
 await button('İndirmeyi iptal et');await until("window.launcher.getUpdate().then(s=>s.phase==='available')")
 await setUpdate({phase:'error',error:'network'});assert.match(await evaluate("document.querySelector('.account-dialog .update-error').textContent"),/Bağlantını/)
 await button('Güncellemeyi indir');await setUpdate({phase:'ready',percent:100,error:null})
 await until("[...document.querySelectorAll('.account-dialog button')].some(b=>b.textContent.includes('Yeniden başlat ve güncelle'))")
 await button('Yeniden başlat ve güncelle');await until("document.querySelector('.account-dialog .update-error')")
 assert.match(await evaluate("document.querySelector('.account-dialog .update-error').textContent"),/oyunu/)
 await shot('qa-update-ready')
 await click('.account-dialog button[aria-label="Kapat"]');await until("!document.querySelector('.account-dialog')")
 for(const language of ['tr','en','de','fr','ru','pl']){
   await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')");await key('1');await until("document.querySelector('.home-update')")
   await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
   assert.ok(await evaluate("document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.home-update button')].every(b=>b.scrollWidth<=b.clientWidth+1)"),language)
 }
 for(const page of ['4','5']){
   await key(page);await until("document.querySelector('.retained-page:not([hidden]) .server-row')")
   const row=await evaluate("(()=>{const p=document.querySelector('.retained-page:not([hidden]) .servers-list-panel').getBoundingClientRect(),r=document.querySelectorAll('.retained-page:not([hidden]) .server-row')[1].getBoundingClientRect();return {left:r.left,right:r.right,pLeft:p.left,pRight:p.right,x:r.left+2,y:r.top+5}})()")
   assert.ok(Math.abs(row.left-row.pLeft-1)<1&&Math.abs(row.pRight-row.right-1)<1)
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:row.x,y:row.y});await wait(220)
   assert.equal(await evaluate("getComputedStyle(document.querySelectorAll('.retained-page:not([hidden]) .server-row')[1]).backgroundColor"),'rgb(33, 38, 45)')
 }
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS manual current-version check, home release notes, bottom-bar dialog, progress, cancel/retry, busy install notice and six-language layout')
} finally {socket.close()}
`
await new Function('assert', 'writeFileSync', 'return (async()=>{' + helpers + checks + '})()')(assert, writeFileSync)
