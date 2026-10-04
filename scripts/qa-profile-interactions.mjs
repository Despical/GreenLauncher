import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
const root='.retained-page:not([hidden]) ', q=s=>'document.querySelector('+JSON.stringify(root+s)+')'
try {
 await call('Runtime.enable');await evaluate("localStorage.removeItem('green-launcher.profile-tabs');window.launcher.saveSettings({language:'tr',qaResource:{checkDelay:650}})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')")
 await evaluate("document.querySelector('.launch-profile-edit').click()");await until("document.querySelector('.page-loading')")
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.page-loading')).borderTopStyle"),'none','cold lazy page has no dashed placeholder')
 assert.equal(await evaluate("document.querySelector('.retained-page:not([hidden]) .library-empty')===null"),true,'empty content card is never used as the loading frame')
 await until(q('.world-select'))
 assert.deepEqual(await evaluate("[...document.querySelectorAll('.profile-workspace-nav>button')].map(b=>b.textContent.trim())"),['Dünyalar','Sunucular','Modlar','Kaynak paketleri','Shader paketleri','Sürüm','Ayarlar','Ekran görüntüleri','Minecraft günlüğü','Diğer sistem kayıtları'])
 assert.equal(await evaluate("document.querySelector('.workspace-profile-select small')===null"),true,'compact identity shows only profile name')
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.profile-workspace-icon img')).width"),'28px')
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.workspace-profile-select strong')).fontSize"),'14px')
 await nav('Modlar');await until(q('.resource-pack-row'))
 await until("window.launcher.getState().then(s=>s.qaResourceRequests.some(r=>r.channel==='check-updates'&&r.kind==='mod'&&r.force===false))")
 await evaluate(q('.resource-check-updates')+'.click()');await until("document.querySelector('.toast>span')?.textContent.includes('Güncelleme kontrolü tamamlandı.')")
 assert.ok((await evaluate('window.launcher.getState()')).qaResourceRequests.some(r=>r.channel==='check-updates'&&r.kind==='mod'&&r.force===true),'manual check queued behind the automatic check actually runs')
 await until(q('.resource-enable')+'.disabled===false')
 const checkboxColors=await evaluate('[...document.querySelectorAll('+JSON.stringify(root+'.resource-enable')+')].map(e=>[getComputedStyle(e).opacity,getComputedStyle(e.querySelector(".profile-checkbox")).backgroundColor])')
 const during=await evaluate('(async()=>{'+q('.resource-enable')+'.click();await new Promise(r=>setTimeout(r,30));return [...document.querySelectorAll('+JSON.stringify(root+'.resource-enable')+')].map(e=>[getComputedStyle(e).opacity,getComputedStyle(e.querySelector(".profile-checkbox")).backgroundColor])})()')
 assert.deepEqual(during,checkboxColors,'all checkboxes retain color during another toggle')
 await until(q('.resource-enable')+'.disabled===false')
 assert.deepEqual((await evaluate('[...document.querySelectorAll('+JSON.stringify(root+'.resource-enable')+')].map(e=>[getComputedStyle(e).opacity,getComputedStyle(e.querySelector(".profile-checkbox")).backgroundColor])')).slice(1),checkboxColors.slice(1),'other rows stay visually unchanged after toggle')
 for(const name of ['Modlar','Kaynak paketleri','Shader paketleri']){
  await nav(name);await until(q('.resource-pack-row'));await until(q('.resource-check-updates')+'.disabled===false')
  await evaluate("document.querySelector('.toast button')?.click()");await click(root+'.resource-check-updates');await until("document.querySelector('.toast>span')?.textContent.includes('Güncelleme kontrolü tamamlandı.')")
  await evaluate("window.launcher.saveSettings({qaResource:{failCheck:true}})");await until(q('.resource-check-updates')+'.disabled===false');await click(root+'.resource-check-updates');await until("document.querySelector('.toast>span')?.textContent.includes('Ayrıntılar hata günlüğüne kaydedildi.')")
  assert.equal(await evaluate(q('.resource-update-summary')+'.dataset.updateStatus'),'error')
  await evaluate("window.launcher.saveSettings({qaResource:{failCheck:false}})")
 }
 await nav('Sunucular');await until(q('.server-select'))
 assert.equal(await evaluate(q('.servers-table-head>span')+'.textContent'),'Sunucu adı')
 assert.equal(await evaluate('(()=>{const a='+q('.servers-table-head>span')+',b='+q('.server-identity strong')+',r=document.createRange();r.selectNodeContents(a);return Math.abs(r.getBoundingClientRect().left-b.getBoundingClientRect().left)<1})()'),true,'name heading lines up with row name')
 assert.equal(await evaluate('getComputedStyle('+q('.server-address')+').textAlign'),'center')
 assert.equal(await evaluate(q('.server-identity .server-icon')+'.getBoundingClientRect().width'),42)
 const before=(await evaluate('window.launcher.getServers("qa-profile")')).map(s=>s.id)
 const row=await evaluate(q('.server-select')+'.getBoundingClientRect().toJSON()'), panel=await evaluate(q('.servers-list-panel')+'.getBoundingClientRect().toJSON()'), second=await evaluate(q('.server-row:nth-child(2) .server-select')+'.getBoundingClientRect().toJSON()')
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:row.x+100,y:row.y+30});await call('Input.dispatchMouseEvent',{type:'mousePressed',x:row.x+100,y:row.y+30,button:'left',clickCount:1})
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:row.x+120,y:row.y+40,button:'left',buttons:1});await until("document.querySelector('.server-drag-preview')")
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:panel.right+70,y:row.y+90,button:'left',buttons:1});await wait(80)
 assert.equal(await evaluate("document.querySelector('.server-drag-preview').closest('.servers-list-panel')===null"),true,'drag preview is outside the clipping table')
 assert.ok(await evaluate("document.querySelector('.server-drag-preview').getBoundingClientRect().right>"+(panel.right+40)),'drag preview remains visible past the table edge')
 await shot('qa-server-floating-drag')
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:second.x+100,y:second.y+second.height/2,button:'left',buttons:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:second.x+100,y:second.y+second.height/2,button:'left',clickCount:1});await until("!document.querySelector('.server-drag-preview')")
 await until('window.launcher.getServers("qa-profile").then(s=>s[0].id!=='+JSON.stringify(before[0])+')')
 assert.deepEqual((await evaluate('window.launcher.getServers("qa-profile")')).map(s=>s.id),before.reverse(),'floating preview retains persistent reorder behavior')
 await shot('qa-server-compact-icons')
 await nav('Sürüm');await until(q('.profile-version-current'))
 assert.equal(await evaluate('getComputedStyle('+q('.profile-version-current>small')+').fontSize'),'14px')
 assert.equal(await evaluate(q('.profile-version-current')+'.textContent.includes("Fabric") && '+q('.profile-version-current img')+'.src === '+q('.profile-version-section:nth-child(2) img')+'.src'),true,'current loader uses the same official Fabric image as its loader control')
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await until(q('.profile-version-current'))
  for(const width of [1080,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
   assert.equal(await evaluate('[...document.querySelectorAll('+JSON.stringify(root+'.profile-version-controls')+')].every(e=>{const a=e.children[0].getBoundingClientRect(),b=e.children[1].getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.bottom-b.bottom)<1&&e.scrollWidth<=e.clientWidth&&getComputedStyle(e.children[1]).backgroundColor==="rgb(44, 109, 67)"})'),true,language+' version controls align and retain green at '+width)
  }
  if(language==='tr')await shot('qa-profile-version-aligned-actions')
 }
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS cold-page loading without dashed frame, compact reordered sidebar, queued manual check/toasts in all 3 content pages, stable checkbox colors, out-of-table pointer drag and saved order, official loader icon and aligned green version controls in six languages')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
