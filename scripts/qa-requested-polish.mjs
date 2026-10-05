import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
const root='.retained-page:not([hidden]) ', q=s=>'document.querySelector('+JSON.stringify(root+s)+')'
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr',qaResource:{manyVersions:true},qaPolish:{resetGame:true,emptyLogs:false,failLogs:false}}).then(()=>window.launcher.selectProfile('qa-profile'))");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit')
 const menu=await evaluate("[...document.querySelectorAll('.profile-workspace-nav button')].map(e=>e.textContent)")
 assert.equal(menu[menu.indexOf('Modlar')-1],'Sürüm');assert.equal(menu[menu.indexOf('Diğer sistem kayıtları')+1],'Ayarlar')
 await nav('Minecraft günlüğü');await until(q('.minecraft-console-line'))
 assert.equal(await evaluate('getComputedStyle('+q('.minecraft-console')+').backgroundColor'),'rgb(13, 17, 23)')
 await evaluate(q('.minecraft-log-copy')+'.click()');await until(q('.minecraft-log-copy')+'.dataset.pending==="true"')
 assert.equal(await evaluate('getComputedStyle('+q('.minecraft-log-copy')+').cursor'),'pointer')
 await until(q('.minecraft-log-copy')+'.dataset.pending==="false"');await click(root+'.minecraft-log-clear');await until(q('.minecraft-console-empty'))
 assert.equal(await evaluate(q('.minecraft-log-bottom')+'.disabled'),true)
 assert.equal(await evaluate('getComputedStyle('+q('.minecraft-console')+').backgroundColor'),await evaluate('getComputedStyle('+q('.minecraft-console-empty')+').backgroundColor'))
 await shot('qa-requested-empty-console')
 await nav('Diğer sistem kayıtları');await until(q('.minecraft-console-line'));assert.equal(await evaluate("document.querySelector('.toast')?.textContent.includes('Kayıtlar yenilendi.')??false"),false)
 await click(root+'.system-log-picker .dropdown-trigger');await until("document.querySelector('.dropdown-search input')");assert.equal(await evaluate("document.querySelector('.dropdown-search input').placeholder"),'Kayıt ara');await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
 await evaluate(q('.page-heading .heading-action')+'.click()');await until(q('.system-log-loading'))
 assert.equal(await evaluate("document.querySelector('.toast')?.textContent.includes('Kayıtlar yenilendi.')??false"),false)
 await until("document.querySelector('.toast')?.textContent.includes('Kayıtlar yenilendi.')");assert.equal(await evaluate(q('.system-log-loading')+'===null'),true)
 await evaluate("window.launcher.saveSettings({qaPolish:{emptyLogs:true}})");await click(root+'.page-heading .heading-action');await until(q('.minecraft-console-empty'));assert.equal(await evaluate(q('.minecraft-log-bottom')+'.disabled'),true)
 await evaluate("window.launcher.saveSettings({qaPolish:{emptyLogs:false,failLogs:true}})");await click(root+'.page-heading .heading-action');await until(q('.minecraft-log-error'));assert.equal(await evaluate(q('.minecraft-console-line')+'===null'),true)
 await evaluate("window.launcher.saveSettings({qaPolish:{failLogs:false}})");await click(root+'.page-heading .heading-action');await until(q('.minecraft-console-line'))
 for(const name of ['Modlar','Kaynak paketleri','Shader paketleri']){
  await nav(name);await until(q('.resource-check-updates'));await click(root+'.resource-check-updates');await until(q('.supported-versions-toggle'))
  assert.equal(await evaluate(q('.supported-versions-toggle')+'.textContent'),'...')
  assert.ok(await evaluate(q('.supported-versions')+'.textContent.includes(", ...")'))
  const collapsed=await evaluate(q('.supported-versions')+'.getBoundingClientRect().height');assert.ok(collapsed<46)
  await click(root+'.supported-versions-toggle');assert.equal(await evaluate(q('.supported-versions-toggle')+'.getAttribute("aria-expanded")'),'true');assert.ok(await evaluate(q('.supported-versions')+'.getBoundingClientRect().height')>collapsed)
  await click(root+'.supported-versions-toggle')
  await click(root+'.resource-pack-row:nth-child(3) .resource-format');await until(q('.resource-update-summary')+'.textContent.includes("Kurulu sürüm")');assert.equal(await evaluate(q('.resource-incompatible-note')+'===null'),true)
  assert.equal(await evaluate(q('.resource-pack-row:nth-child(3)')+'.classList.contains("selected")'),true)
  await click(root+'.resource-pack-row:nth-child(2) .resource-provider');assert.equal(await evaluate(q('.resource-pack-row:nth-child(2)')+'.classList.contains("selected")'),true)
  await shot('qa-requested-'+name.replaceAll(' ','-'))
 }
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false});await wait(150)
  for(const page of ['servers','worlds']){
   await evaluate('document.querySelector('+JSON.stringify(page==='servers'?'.profile-workspace-nav button:nth-child(2)':'.profile-workspace-nav button:nth-child(1)')+').click()');await until(q('.server-row'))
   const alignment=await evaluate('(()=>{const h='+q('.table-identity-heading')+',r='+q(':is(.server-identity,.world-identity)')+';return {head:h.lastElementChild.getBoundingClientRect().left,name:r.querySelector("strong").getBoundingClientRect().left,image:h.firstElementChild.getBoundingClientRect().left,icon:r.querySelector(".server-icon").getBoundingClientRect().left}})()')
   assert.ok(Math.abs(alignment.head-alignment.name)<1,language+' '+page+' name aligns');assert.ok(Math.abs(alignment.image-alignment.icon)<1,language+' '+page+' image aligns')
   assert.equal(await evaluate(q('.servers-workspace')+'.scrollWidth<='+q('.servers-workspace')+'.clientWidth'),true)
  }
 }
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS sidebar order, empty/full console surface and bottom state, copy cursor during IPC, refresh completion/error/empty states, log search label, whole-row content selection, inline comma ellipsis and expansion, installed-version copy, six-language server/world header alignment; isolated fixtures')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
