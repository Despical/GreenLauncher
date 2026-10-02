import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 await evaluate("window.launcher.saveSettings({language:'tr',qaUpdate:{phase:'current',version:null,error:null}})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 await key('9');await button('Hakkında');assert.equal(await evaluate("!!document.querySelector('.launcher-update-panel')"),false)
 await button('Launcher');await until("document.querySelector('.launcher-update-settings')")
 assert.equal(await evaluate("document.querySelector('.launcher-update-settings').previousElementSibling.classList.contains('settings-panel')"),true)
 assert.match(await evaluate("document.querySelector('.launcher-update-settings').textContent"),/En son sürüm yüklü/)
 await evaluate("window.launcher.saveSettings({qaUpdate:{phase:'error',error:'metadata'}})")
 assert.match(await evaluate("document.querySelector('.launcher-update-settings .update-error').textContent"),/güncelleme dosyaları eksik/)
 await evaluate("window.launcher.saveSettings({qaUpdate:{phase:'current',error:null}})");await evaluate("document.querySelector('.launcher-update-settings').scrollIntoView({block:'center'})");await shot('qa-patch-launcher-settings')
 for(const page of ['4','5']){
   await key(page);await until("document.querySelectorAll('.retained-page:not([hidden]) .server-row').length===2")
   const geometry=await evaluate("(()=>{const page=document.querySelector('.retained-page:not([hidden])'),row=page.querySelector('.server-row:last-child'),heading=page.querySelector('.servers-table-head>span,.worlds-table-head>span'),icon=page.querySelector('.server-row .server-icon'),range=document.createRange();range.selectNodeContents(heading);const text=range.getBoundingClientRect(),i=icon.getBoundingClientRect(),r=row.getBoundingClientRect();return {aligned:Math.abs(text.left-i.left)<1,left:getComputedStyle(row).borderBottomLeftRadius,right:getComputedStyle(row).borderBottomRightRadius,list:getComputedStyle(page.querySelector('.servers-list')).borderBottomLeftRadius,x:r.left+2,y:r.top+r.height/2}})()")
   assert.equal(geometry.aligned,true);assert.equal(geometry.left,'9px');assert.equal(geometry.right,'9px');assert.equal(geometry.list,'9px')
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:geometry.x,y:geometry.y});await wait(220)
   await shot(page==='4'?'qa-patch-server-hover':'qa-patch-world-hover')
 }
 for(const language of ['tr','en','de','fr','ru','pl']){
   await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')")
   await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
   await click('.statusbar-changelog');await until("document.querySelector('.release-latest-badge')")
   const badge=await evaluate("(()=>{const b=document.querySelector('.release-latest-badge'),s=b.previousElementSibling,br=b.getBoundingClientRect(),sr=s.getBoundingClientRect();return {count:document.querySelectorAll('.release-latest-badge').length,left:!!b.closest('.release-history-navigation'),right:!!document.querySelector('.release-history-detail .release-latest-badge'),font:getComputedStyle(b).fontSize==='11px'&&getComputedStyle(s).fontSize==='15px',height:br.height<=sr.height,gap:br.left-sr.right,center:Math.abs((br.top+br.bottom)/2-(sr.top+sr.bottom)/2)<1,fit:b.closest('button').scrollWidth<=b.closest('button').clientWidth+1,version:s.textContent}})()")
   assert.equal(badge.count,1);assert.equal(badge.left,true);assert.equal(badge.right,false);assert.equal(badge.font,true);assert.equal(badge.center,true);assert.equal(badge.fit,true);assert.equal(badge.height,true);assert.equal(badge.gap,6);assert.equal(badge.version,'v0.17.4')
   if(language==='tr'||language==='ru')await shot('qa-patch-changelog-'+language)
   await evaluate("document.querySelectorAll('.release-history-version')[1].click()")
   assert.equal(await evaluate("document.querySelector('.release-latest-badge').previousElementSibling.textContent"),'v0.17.4')
   await input('.release-history-search input','0.16.0');assert.equal(await evaluate("document.querySelectorAll('.release-latest-badge').length"),0)
   await click('.changelog-dialog button[aria-label]');await until("!document.querySelector('.changelog-dialog')")
 }
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS separate bottom Launcher update box, no About duplication, metadata-specific error, rounded final world/server hover, exact heading/icon alignment, latest-only green badge with compact badge height and title alignment in six languages')
} finally {socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
