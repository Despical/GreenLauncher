import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
const root='.retained-page:not([hidden]) ', q=s=>'document.querySelector('+JSON.stringify(root+s)+')'
const workspaceNav=async name=>{await evaluate('[...document.querySelectorAll(".profile-workspace-nav button")].find(b=>b.textContent.trim()==='+JSON.stringify(name)+').click()');await wait(80)}
const choose=async name=>{await click('.profile-workspace-back');await until("document.querySelector('.profile-card')");await evaluate('[...document.querySelectorAll(".profile-card")].find(e=>e.querySelector("h3").textContent==='+JSON.stringify(name)+').dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');await until("document.querySelector('.workspace-profile-select strong').textContent==="+JSON.stringify(name))}
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit')
 for(const [name,kind] of [['Modlar','mod'],['Kaynak paketleri','resourcepack'],['Shader paketleri','shader']]){
  await workspaceNav(name);await until(q('.resource-pack-row'))
  for(const width of [1080,1280,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
   assert.equal(await evaluate('(()=>{const c=getComputedStyle('+q('.resource-pack-row')+').gridTemplateColumns.split(" ");return c[2]===c[3]})()'),true,kind+' equal metadata widths at '+width)
  }
  assert.ok(await evaluate(q('.resource-installed-detail > p')+'?.textContent.length>0'),kind+' installed description')
  await until(q('.resource-update-summary')+'.dataset.updateStatus==="update"')
  const colors=await evaluate('(()=>{const b='+q('.resource-update-button')+',c='+q('.resource-check-updates')+';return [b,c].map(e=>[getComputedStyle(e).backgroundColor,getComputedStyle(e).opacity])})()')
  const during=await evaluate('(async()=>{'+q('.resource-enable')+'.click();await new Promise(r=>setTimeout(r,20));return ['+q('.resource-update-button')+','+q('.resource-check-updates')+'].map(e=>[getComputedStyle(e).backgroundColor,getComputedStyle(e).opacity])})()')
  assert.deepEqual(during,colors,kind+' update actions retain color during activation')
  await until(q('.resource-enable')+'.disabled===false')
  const samples=await evaluate('(async()=>{const a=[];for(let i=0;i<30;i++){a.push(['+q('.resource-update-button')+','+q('.resource-check-updates')+'].map(e=>[getComputedStyle(e).backgroundColor,getComputedStyle(e).opacity]));await new Promise(r=>setTimeout(r,50))}return a})()')
  for(const sample of samples)assert.deepEqual(sample,colors,kind+' automatic checks do not flash update controls')
 }
 await choose('Test World 2');await workspaceNav('Shader paketleri');await until(q('.resource-pack-row')+'.textContent.includes("Other profile")')
 await evaluate("window.launcher.saveSettings({qaResource:{listDelay:800}})");await choose('Test World')
 for(const name of ['Modlar','Kaynak paketleri','Shader paketleri']){
  await workspaceNav(name)
  assert.ok(await evaluate(q('.resource-pack-row')+'!==null'),name+' cached list visible immediately after remount')
  assert.equal(await evaluate(q('.resource-empty')+'===null'),true,name+' no empty/loading flash on cached entry')
  assert.equal(await evaluate(q('.resource-update-summary')+'.dataset.updateStatus'),'update',name+' cached updates retained')
 }
 await evaluate("window.launcher.saveSettings({qaResource:{listDelay:0}})")
 for(const name of ['Dünyalar','Sunucular']){
  await workspaceNav(name);await until(q(name==='Dünyalar'?'.world-select':'.server-select'))
  assert.equal(await evaluate(q('.servers-toolbar')+'.closest(".servers-list-panel")===null'),true,name+' search outside table box')
  assert.equal(await evaluate('getComputedStyle('+q('.servers-list-panel')+').backgroundColor'),'rgb(22, 27, 34)')
  assert.equal(await evaluate('getComputedStyle('+q('.servers-list-panel')+').borderRadius'),'8px')
  assert.equal(await evaluate('(()=>{const a='+q('.servers-toolbar')+'.getBoundingClientRect(),b='+q('.servers-list-panel')+'.getBoundingClientRect(),c='+q('.server-details')+'.getBoundingClientRect();return b.top>=a.bottom+13&&Math.abs(b.top-c.top)<1})()'),true,name+' search above aligned list and detail cards')
  await shot(name==='Dünyalar'?'qa-worlds-content-frame':'qa-servers-content-frame')
 }
 await workspaceNav('Ayarlar');await until(q('.profile-account-override'))
 await evaluate(q('.profile-account-override')+'.scrollIntoView({block:"center"})');await wait(100)
 await click('.profile-account-override .profile-section-enable');await click('.profile-account-override .dropdown-trigger');await until("document.querySelector('.profile-account-menu .player-avatar img')?.naturalWidth>0")
 assert.equal(await evaluate("(()=>{const r=document.querySelector('.profile-account-menu').getBoundingClientRect();return r.top>=40&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()"),true,'skin account menu fits beside its visible trigger')
 await shot('qa-profile-account-picker-visible');await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
 await evaluate(q('.profile-playtime-settings')+'.scrollIntoView({block:"center"})');await shot('qa-profile-general-switch-cards')
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS installed content caches survive profile remounts, scoped ownership, three equal-width tables, activation/automatic checks retain button colors, descriptions, standalone world/server search, and visible skin account picker')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
