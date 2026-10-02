import assert from 'node:assert/strict'
import {send,evaluate,shot,close} from './qa-accounts-cdp.mjs'
const wait=async expr=>{for(let n=0;n<100;n++){if(await evaluate(expr))return;await new Promise(r=>setTimeout(r,50))}throw Error(expr)}
const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await new Promise(r=>setTimeout(r,350))}
let checks=0
const check=async(name,expr)=>{assert.equal(await evaluate(expr),true,name);checks++;console.log('PASS',name)}
try{
 await send('Page.bringToFront');await send('Emulation.setFocusEmulationEnabled',{enabled:true})
 await wait("!!document.querySelector('.account-tile')")
 await click('.account-tile')
 await check('larger sidebar subtitle',"parseFloat(getComputedStyle(document.querySelector('.account-tile > div > span')).fontSize)===12")
 await check('larger switcher heading and count',"getComputedStyle(document.querySelector('.account-switcher-heading')).fontSize==='13px' && getComputedStyle(document.querySelector('.account-count')).fontSize==='12px'")
 await check('readable account types and Microsoft mark',"[...document.querySelectorAll('.account-switcher .account-identity small')].every(e=>getComputedStyle(e).fontSize==='12px') && document.querySelector('.account-switcher-list button:last-child small svg path').getAttribute('fill')==='#f25022'")
 await shot('qa-account-refine-menu')
 await click('.account-switcher-action:nth-of-type(2)')
 await check('header separator',"getComputedStyle(document.querySelector('.account-dialog-heading')).borderBottomWidth==='1px'")
 await check('select button replaced by account card',"!document.querySelector('.account-select-button') && document.querySelectorAll('.account-card-select').length===3")
 await click('.managed-account:nth-child(1) .account-card-select')
 await evaluate("document.querySelectorAll('.account-card-select')[1].click()")
 await wait("document.querySelector('.managed-account.selected strong').textContent==='Steve'")
 await check('card click selects account',"document.querySelector('.account-tile strong').textContent==='Steve'")
 await click('.managed-account.selected .account-remove-button')
 await check('trash does not select different account',"document.querySelector('.managed-account.selected strong').textContent==='Steve'")
 await shot('qa-account-refine-confirm')
 const closeAnimation=await evaluate("(async()=>{const r=document.querySelector('.account-remove-reveal.open');const full=r.getBoundingClientRect().height;r.querySelector('button').click();await new Promise(r=>setTimeout(r,90));return {full,mid:r.getBoundingClientRect().height,opacity:+getComputedStyle(r).opacity}})()")
 assert.ok(closeAnimation.mid>0 && closeAnimation.mid<closeAnimation.full && closeAnimation.opacity<1);checks++;console.log('PASS closing confirmation animates',closeAnimation)
 await new Promise(r=>setTimeout(r,300))
 await check('collapsed confirmation leaves tab order',"[...document.querySelectorAll('.account-remove-reveal')].every(r=>r.inert && r.getBoundingClientRect().height===0)")
 const openAnimation=await evaluate("(async()=>{document.querySelector('.managed-account.selected .account-remove-button').click();await new Promise(r=>setTimeout(r,70));const e=document.querySelector('.account-remove-reveal.open');return {height:e.getBoundingClientRect().height,opacity:+getComputedStyle(e).opacity}})()")
 assert.ok(openAnimation.height>0 && openAnimation.opacity>0 && openAnimation.opacity<1);checks++;console.log('PASS opening confirmation animates',openAnimation)
 await new Promise(r=>setTimeout(r,300))
 await evaluate("document.querySelector('.account-remove-reveal.open .account-confirm-danger').click()")
 await wait("!!document.querySelector('.managed-account-presence.leaving')")
 await check('successful deletion retains row for animation',"(async()=>!(await window.launcher.getState()).accounts.some(a=>a.name==='Steve') && !!document.querySelector('.managed-account-presence.leaving'))()")
 await wait("!document.querySelector('.managed-account-presence.leaving')")
 await check('deletion finishes and notifies with account name',"document.querySelectorAll('.account-card-select').length===2 && document.querySelector('.toast').textContent.includes('Steve hesabı silindi.')")
 await shot('qa-account-refine-deleted')
 await click('.account-dialog-heading button')
 await click('.account-tile');await click('.account-switcher-action:nth-of-type(1)')
 await check('profile offline message replaced',"document.querySelector('.account-page-note').textContent==='Çevrimdışı hesap ile çevrimiçi sunucu oturumlarına katılamazsın.'")
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate(`window.launcher.saveSettings({language:'${language}'})`);await send('Page.reload');await wait("!!document.querySelector('.account-tile')")
  await click('.account-tile');await click('.account-switcher-action:nth-of-type(2)')
  await check(language+' enlarged typography fits minimum window',"(()=>{const e=document.querySelector('.account-dialog');const r=e.getBoundingClientRect();return e.scrollWidth===e.clientWidth && r.top>=38 && r.bottom<=innerHeight-28 && [...e.querySelectorAll('.account-card-select,.account-provider-button')].every(b=>b.scrollWidth<=b.clientWidth+1)})()")
  if(language==='tr')await shot('qa-account-refine-manager-min')
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await send('Emulation.clearDeviceMetricsOverride');await send('Page.reload');await wait("!!document.querySelector('.account-tile')")
 await click('.account-tile');await click('.account-switcher-action:nth-of-type(2)');await shot('qa-account-refine-manager')
 console.log(`${checks} refinement checks passed`)
}finally{close()}
