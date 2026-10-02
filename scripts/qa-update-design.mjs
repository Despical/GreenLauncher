import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 const bounds = () => evaluate("(()=>{const group=document.querySelector('.main-content.page-versions > .content-page > .page-heading > .servers-heading-actions'),buttons=[...group.children].map(b=>{const r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}),page=document.querySelector('.main-content.page-versions > .content-page > .page-heading').getBoundingClientRect();return{display:getComputedStyle(group).display,buttons,left:page.left,right:page.right,bottom:page.bottom}})()")
 const verify = geometry => {assert.equal(geometry.display,'flex');assert.equal(geometry.buttons.length,2);const[a,b]=geometry.buttons;assert.ok(Math.abs(a.y-b.y)<1,JSON.stringify(geometry));assert.ok(b.x-a.right>=9,JSON.stringify(geometry));assert.ok(a.x>=geometry.left-1&&b.right<=geometry.right+1,JSON.stringify(geometry));assert.ok(a.bottom<=geometry.bottom+1&&b.bottom<=geometry.bottom+1)}
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')")
  assert.equal(await evaluate("[...document.styleSheets].some(s=>s.href&&s.href.includes('/servers-')&&s.href.endsWith('.css'))"),false,'server styles must still be unloaded')
  await key('2');await until("document.querySelector('.main-content.page-versions > .content-page > .page-heading > .servers-heading-actions')")
  for(const width of [960,1080,1280,1440]){await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await wait(100);verify(await bounds())}
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false});await wait(100)
  const before=await bounds();if(language==='tr')await shot('qa-heading-first-versions')
  await key('4');await until("document.querySelector('.servers-page .servers-heading-actions')")
  await key('2');const after=await bounds();verify(after);assert.deepEqual(after,before,'visiting Servers must not change Versions heading geometry')
 }
 await evaluate("window.launcher.saveSettings({language:'tr',qaUpdate:{phase:'current',version:null,error:null}})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await key('9');await button('Launcher');await until("document.querySelector('.launcher-update-settings')")
 const section = '.launcher-update-settings .launcher-update-panel'
 assert.equal(await evaluate("document.querySelector('.launcher-update-settings .update-heading h3').textContent"),'En son sürüm yüklü')
 assert.equal(await evaluate("document.querySelectorAll('.update-version').length"),0,'no current-version badge')
 assert.equal(await evaluate("document.querySelectorAll('.launcher-update-settings .update-heading svg,.launcher-update-settings .update-eyebrow,.launcher-update-settings .update-status-icon').length"),0)
 assert.doesNotMatch(await evaluate("document.querySelector('.launcher-update-settings .update-heading').textContent"),/Launcher güncellemeleri/)
 assert.match(await evaluate("getComputedStyle(document.querySelector('.launcher-update-settings .launcher-update-panel'),'::before').backgroundImage"),/update-night-coast/)
 await evaluate("document.querySelector('.launcher-update-settings').scrollIntoView({block:'center'})");await wait(150)
 const card=await evaluate("(()=>{const r=document.querySelector('.launcher-update-settings .launcher-update-panel').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()")
 const picture=await call('Page.captureScreenshot',{format:'png',clip:card});writeFileSync('build/qa-update-night-design.png',Buffer.from(picture.data,'base64'))
 await button('Kontrol et');await until("document.querySelector('.toast')");assert.match(await evaluate("document.querySelector('.toast').textContent"),/En son sürümü/)
 assert.equal(await evaluate("(()=>{const stamp=document.querySelector('.launcher-update-settings .update-last-check'),card=document.querySelector('.launcher-update-settings .launcher-update-panel');return !card.contains(stamp)&&stamp.getBoundingClientRect().top>=card.getBoundingClientRect().bottom&&getComputedStyle(stamp).textAlign==='right'})()"),true,'last check is outside the card at its lower right')
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await wait(120)
  for(const width of [960,1080,1280,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await wait(80)
   assert.equal(await evaluate("(()=>{const area=document.querySelector('.launcher-update-settings .launcher-update-area');return area.scrollWidth<=area.clientWidth})()"),true,'update card and timestamp fit in '+language+' at '+width)
  }
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await wait(100)
 for(const phase of ['available','downloading','ready','error','disabled']){
  await evaluate('window.launcher.saveSettings({qaUpdate:'+JSON.stringify({phase,version:phase==='disabled'?null:'0.18.0',error:phase==='error'?'network':null,percent:42,total:1000000,transferred:420000,notes:'Test release notes.'})+'})')
  await wait(100)
  assert.equal(await evaluate("document.querySelector('.launcher-update-settings').scrollWidth<=document.querySelector('.launcher-update-settings').clientWidth"),true)
  if(phase==='downloading')assert.equal(await evaluate("document.querySelector('.launcher-update-settings progress').value"),42)
 }
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS first-visit Versions actions before lazy server CSS, stable geometry after visiting Servers, six languages at four widths, dedicated night artwork, redesigned icon-free heading/actions, check toast and update states')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
