import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),nbt=require('prismarine-nbt'),zlib=require('node:zlib')
const helpers=readFileSync('scripts/qa-servers-custom.mjs','utf8').split('try {')[0].replace(/^import[^\n]*\n/gm,'')
const checks=String.raw`
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.side-nav')");await key('5');await until("document.querySelectorAll('.world-select').length===2")
 const state=await evaluate("window.launcher.getState()"),directory=join(state.dataPath,'profiles','qa-profile','saves'),read=id=>nbt.parseUncompressed(zlib.gunzipSync(readFileSync(join(directory,id,'level.dat'))))
 assert.equal(await evaluate("document.querySelectorAll('.worlds-table-head span').length"),4)
 assert.equal(await evaluate("document.querySelector('.world-join').disabled"),false)
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.world-select')).cursor"),'pointer')
 const geometry=await evaluate("(()=>{const r=document.querySelector('.world-select').getBoundingClientRect(),i=document.querySelector('.world-identity .server-icon').getBoundingClientRect();return {row:r.height,icon:i.height,left:r.left===i.left,top:r.top===i.top}})()")
 assert.deepEqual(geometry,{row:66,icon:66,left:true,top:true});await shot('qa-worlds-list')
 await click('.world-join');await until("window.launcher.getState().then(s=>s.qaLaunches.length>0)")
 assert.equal((await evaluate("window.launcher.getState().then(s=>s.qaLaunches.at(-1))")).worldId,'Adventure')
 const manage=async label=>{await evaluate("[...document.querySelectorAll('.world-management-actions button')].find(b=>b.textContent.trim()==="+JSON.stringify(label)+").click()");await wait(200)}
 await manage('Adını değiştir');await until("document.querySelector('.server-edit-dialog input')");await input('.server-edit-dialog input','Yeni dünya adı');await click('.server-edit-dialog .modal-primary');await until("!document.querySelector('.server-edit-dialog')")
 assert.equal(read('Adventure').value.Data.value.LevelName.value,'Yeni dünya adı')
 await manage('Simgeyi sıfırla');await until("document.querySelector('.world-details-identity img').src.includes('minecraft-server-default')&&!document.querySelector('.worlds-page .servers-heading-actions button:first-child').disabled")
 assert.equal(existsSync(join(directory,'Adventure','icon.png')),false)
 assert.match(await evaluate("document.querySelector('.world-details-identity img').src"),/minecraft-server-default/)
 await click('.world-select[aria-label="Yaratıcı dünyam"]');assert.equal(await evaluate("[...document.querySelectorAll('.world-action-pair')].find(b=>b.textContent.trim()==='Seedi kopyala').disabled"),false);await manage('Seedi kopyala')
 assert.equal(await evaluate("window.launcher.getState().then(s=>s.qaExternalOpened.includes('seed:-9223372036854775808'))"),true)
 await manage('Kopyala');await until("document.querySelectorAll('.world-select').length===3")
 const copy=await evaluate("window.launcher.getWorlds('qa-profile').then(w=>w.find(i=>i.id==='Creative (1)'))")
 assert.equal(copy.name,'Yaratıcı dünyam (kopya)');assert.equal(read('Creative (1)').value.Data.value.LevelName.value,copy.name)
 const chooseProfile=async name=>{await click('.worlds-page .servers-list-profile-select .dropdown-trigger');await until("document.querySelector('.profile-picker-menu')");await evaluate("[...document.querySelectorAll('.profile-picker-menu [role=option]')].find(e=>e.querySelector('strong').textContent==="+JSON.stringify(name)+").click()");await until("!document.querySelector('.worlds-page .servers-list-profile-select .dropdown-trigger').disabled")}
 await chooseProfile('Test World 2');assert.equal(await evaluate("document.querySelectorAll('.world-select').length"),0)
 await click('.worlds-page .servers-heading-actions button:last-child');await until("document.querySelectorAll('.world-select').length===1")
 assert.equal(await evaluate("document.querySelector('.world-identity strong').textContent"),'Elle eklenen dünya')
 assert.ok(existsSync(join(state.dataPath,'Imported world','level.dat')))
 await manage('Klasörü göster');assert.equal(await evaluate("window.launcher.getState().then(s=>s.qaExternalOpened.some(p=>p.endsWith('qa-profile-1'+String.fromCharCode(92)+'saves'+String.fromCharCode(92)+'Imported world')))"),true)
 await manage('Sil');await until("document.querySelector('.server-edit-dialog')");assert.match(await evaluate("document.querySelector('.server-edit-dialog').textContent"),/geri dönüşüm/);await click('.server-edit-dialog .danger');await until("document.querySelectorAll('.world-select').length===0")
 assert.ok(existsSync(join(state.dataPath,'recycle','Imported world','level.dat')))
 assert.equal((await evaluate("window.launcher.getWorlds('qa-profile')")).length,3)
 console.log('PASS world UI direct join, actual NBT rename, reset to Minecraft default icon, exact seed copy, duplicate, manual import, folder opening and recycle-bin deletion')
 await chooseProfile('Test World 3');await until("document.querySelector('.world-join')")
 assert.equal(await evaluate("document.querySelector('.world-join').disabled"),true);assert.match(await evaluate("document.querySelector('.world-launch-note').textContent"),/1.20/)
 const before=(await evaluate("window.launcher.getState().then(s=>s.qaLaunches.length)"));await evaluate("document.querySelector('.world-select').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");assert.equal(await evaluate("window.launcher.getState().then(s=>s.qaLaunches.length)"),before)
 await chooseProfile('Test World');await until("document.querySelectorAll('.world-select').length===3")
 const external=read('Adventure');external.value.Data.value.LevelName.value='Oyunda değiştirilen dünya';writeFileSync(join(directory,'Adventure','level.dat'),zlib.gzipSync(nbt.writeUncompressed(external)))
 await until("[...document.querySelectorAll('.world-identity strong')].some(e=>e.textContent==='Oyunda değiştirilen dünya')")
 console.log('PASS profile separation, legacy direct join disabled including double-click, and game-side world rename appears automatically')
 const names={tr:'Dünyalar',en:'Worlds',de:'Welten',fr:'Mondes',ru:'Миры',pl:'Światy'}
 for(const [language,heading] of Object.entries(names)) {
   await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')");await key('5');await until("document.querySelectorAll('.world-select').length===3")
   assert.equal(await evaluate("document.querySelector('.worlds-page h2').textContent"),heading)
   for(const width of [1080,1280,1600]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    const fits=await evaluate("(()=>{const workspace=document.querySelector('.worlds-page .servers-workspace').getBoundingClientRect(),panel=document.querySelector('.worlds-page .servers-list-panel').getBoundingClientRect(),row=document.querySelector('.world-select').getBoundingClientRect(),picker=document.querySelector('.worlds-page .servers-list-profile-select').getBoundingClientRect();return {page:document.documentElement.scrollWidth<=innerWidth,workspace:workspace.right<=innerWidth,row:row.right<=panel.right,picker:picker.right<=panel.right,buttons:[...document.querySelectorAll('.world-management-actions button')].every(b=>b.scrollWidth<=b.clientWidth+1)}})()")
    const layout=await evaluate("(()=>{const rows=[...document.querySelectorAll('.world-select>span+span')],header=[...document.querySelectorAll('.worlds-table-head>span+span')],facts=[...document.querySelectorAll('.worlds-page .server-facts>div')].map(e=>e.getBoundingClientRect()),pairs=[...document.querySelectorAll('.world-action-pair')].map(e=>{const b=e.getBoundingClientRect(),i=e.querySelector('svg').getBoundingClientRect();return {x:i.left-b.left,y:i.top-b.top,height:b.height}});return {rows:rows.every(e=>getComputedStyle(e,'::before').width==='1px'&&getComputedStyle(e,'::before').content!=='none'),header:header.every(e=>getComputedStyle(e,'::before').content==='none'),factIcons:document.querySelectorAll('.worlds-page .server-facts dt svg').length===4,fullRow:(()=>{const r=document.querySelector('.worlds-page .server-row').getBoundingClientRect(),p=document.querySelector('.worlds-page .servers-list-panel').getBoundingClientRect();return Math.abs(r.left-p.left-1)<1&&Math.abs(p.right-r.right-1)<1})(),identity:document.querySelectorAll('.world-details-identity h3').length===1&&document.querySelectorAll('.world-details-identity>div>span').length===0,facts:facts.every((r,i)=>i===0||r.top>=facts[i-1].bottom)&&facts.every(r=>Math.abs(r.left-facts[0].left)<1),icons:pairs.every(p=>Math.abs(p.x-pairs[0].x)<1&&Math.abs(p.y-(p.height-16)/2)<1)}})()")
    assert.ok(Object.values(layout).every(Boolean),JSON.stringify({language,width,layout}))
    assert.ok(Object.values(fits).every(Boolean),JSON.stringify({language,width,fits}));if(width===1080)await shot('qa-worlds-'+language+'-1080')
   }
 }
 console.log('PASS six languages at three window sizes with no page, table, profile picker or action-button overflow')
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 const pages=['home','versions','profiles','servers','worlds','mods','gallery','downloads','settings']
 for(let i=0;i<pages.length;i++){await key(String(i+1));await until("document.querySelector('.main-content').classList.contains('page-"+pages[i]+"')")}
 await key('5');await evaluate("window.launcher.getState().then(async s=>{for(const p of s.profiles)await window.launcher.deleteProfile(p.id)})")
 await until("document.querySelector('.worlds-profile-required')")
 assert.equal(await evaluate("[...document.querySelectorAll('.worlds-page .servers-heading-actions button')].every(b=>b.disabled)"),true)
 await key('4');await until("document.querySelector('.servers-page:not(.worlds-page) h3')?.textContent==='Önce bir profil oluştur'")
 assert.equal(await evaluate("document.querySelectorAll('.servers-page:not(.worlds-page) .servers-workspace').length"),0)
 assert.equal(await evaluate("document.querySelector('.servers-page:not(.worlds-page) .servers-heading-actions button:last-child').disabled"),true)
 await shot('qa-servers-profile-required');await click('.servers-page:not(.worlds-page) .servers-empty .secondary');await until("document.querySelector('.profile-modal')")
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS Ctrl+1 through Ctrl+9 follow the sidebar; no-profile server/world guidance blocks adding and offers profile creation')
} finally {socket.close()}
`
await new Function('assert','writeFileSync','readFileSync','existsSync','join','nbt','zlib','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync,readFileSync,existsSync,join,nbt,zlib)
