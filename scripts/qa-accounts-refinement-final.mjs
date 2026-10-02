import assert from 'node:assert/strict'
import {send,evaluate,shot,close} from './qa-accounts-cdp.mjs'
const pause=()=>new Promise(r=>setTimeout(r,350))
const wait=async e=>{for(let n=0;n<100;n++){if(await evaluate(e))return;await new Promise(r=>setTimeout(r,50))}throw Error(e)}
try{
 await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true})
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate(`window.launcher.saveSettings({language:'${language}'})`);await send('Page.reload');await wait("!!document.querySelector('.account-tile')")
  await evaluate("document.querySelector('.account-tile').click()");await pause();await evaluate("document.querySelectorAll('.account-switcher-action')[1].click()");await pause()
  const metrics=await evaluate("(()=>{const e=document.querySelector('.account-dialog'),r=e.getBoundingClientRect(),note=document.querySelector('.account-security-note').getBoundingClientRect(),list=document.querySelector('.managed-account-list');return {overflow:e.scrollHeight-e.clientHeight,noteVisible:note.bottom<=r.bottom-10,widthOK:e.scrollWidth===e.clientWidth,listHeight:list.clientHeight}})()")
  assert.equal(metrics.overflow,0,language);assert.equal(metrics.noteVisible,true,language);assert.equal(metrics.widthOK,true,language)
  console.log('PASS',language,'minimum window',metrics)
  if(language==='tr')await shot('qa-account-refine-min-final')
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await send('Page.reload');await wait("!!document.querySelector('.account-tile')")
 await evaluate("window.launcher.createOfflineAccount('AnimTest')");await evaluate("document.querySelector('.account-tile').click()");await pause();await evaluate("document.querySelectorAll('.account-switcher-action')[1].click()");await pause()
 await evaluate("document.querySelector('.managed-account.selected .account-remove-button').click()");await pause()
 await evaluate("document.querySelector('.account-remove-reveal.open .account-confirm-danger').click()")
 await wait("!!document.querySelector('.managed-account-presence.leaving')")
 const midway=await evaluate("(async()=>{await new Promise(r=>setTimeout(r,80));const e=document.querySelector('.managed-account-presence.leaving');return {opacity:+getComputedStyle(e).opacity,height:e.getBoundingClientRect().height}})()")
 console.log('EXIT SAMPLE',midway);assert.ok(midway.opacity>0 && midway.opacity<1 && midway.height>0);console.log('PASS row exit animated',midway)
 await wait("!document.querySelector('.managed-account-presence.leaving')");await pause()
 assert.equal(await evaluate("document.activeElement.classList.contains('account-card-select')"),true)
 assert.equal(await evaluate("document.querySelector('.toast').textContent.includes('AnimTest hesabı silindi.')"),true)
 await shot('qa-account-refine-toast-final')
 await send('Emulation.clearDeviceMetricsOverride');await pause();await shot('qa-account-refine-final')
 console.log('PASS deletion focus restored and named notification shown')
}finally{close()}
