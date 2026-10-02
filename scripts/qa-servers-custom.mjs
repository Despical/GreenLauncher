import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const tab = (await (await fetch('http://127.0.0.1:9225/json/list')).json()).find(item => item.type === 'page')
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(resolve => socket.onopen = resolve)
let id = 0
const pending = new Map(), errors = []
socket.onmessage = event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const task = pending.get(message.id); if (task) { pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result) } }
const call = (method, params = {}) => new Promise((resolve,reject) => { const key = ++id; pending.set(key,{resolve,reject}); socket.send(JSON.stringify({id:key,method,params})) })
const evaluate = async expression => { const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value }
const until = async expression => { for(let n=0;n<100;n++){if(await evaluate(`!!(${expression})`))return;await wait(60)}throw new Error('Timeout: '+expression) }
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait(180) }
const button = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.offsetParent&&b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button not found: '+${JSON.stringify(text)});b.click()})()`);await wait(180) }
const nav = async text => { await evaluate(`[...document.querySelectorAll('.side-nav button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);await wait(220) }
const input = async (selector,value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(100) }
const shot = async name => { await wait(180);const result=await call('Page.captureScreenshot',{format:'png'});writeFileSync('build/'+name+'.png',Buffer.from(result.data,'base64')) }
const key = async (key,ctrlKey=true) => { await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:${ctrlKey},bubbles:true}))`);await wait(180) }
try {
  await call('Runtime.enable'); await evaluate("window.launcher.saveSettings({language:'tr'}).then(()=>window.launcher.selectProfile('qa-profile'))"); await call('Page.reload');await until("!!document.querySelector('.side-nav')")
  const pages=['home','versions','profiles','servers','mods','gallery','downloads','settings']
  for(let i=0;i<pages.length;i++){await key(String(i+1));await until(`document.querySelector('.main-content').classList.contains('page-${pages[i]}')`)}
  await key('9');assert.equal(await evaluate("document.querySelector('.main-content').classList.contains('page-settings')"),true)
  console.log('PASS Ctrl+1 through Ctrl+8 follow the sidebar, Ctrl+9 has no extra action')
  await nav('Sunucular');await until("document.querySelectorAll('.server-row').length===2 && document.querySelector('.server-online.online')")
  assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Green Community')
  assert.match(await evaluate("document.querySelector('.server-motd').textContent"),/Green Community/)
  assert.equal(await evaluate("document.querySelector('.server-online small').textContent"),'17 / 80')
  assert.equal(await evaluate("document.querySelector('.server-facts dd').textContent"),'play.example.org:25565')
  assert.equal(await evaluate("document.querySelectorAll('.server-row .server-join,.server-row .server-refresh').length"),0)
  assert.ok(await evaluate("document.querySelector('.server-row').getBoundingClientRect().height")<=70)
  assert.equal(await evaluate("document.querySelectorAll('.servers-table-head span').length"),4)
  const drag = async (from,to) => {
    const positions=await evaluate("[...document.querySelectorAll('.server-select')].map(e=>{const r=e.getBoundingClientRect();return {x:r.left+70,y:r.top+r.height/2}})")
    const source=positions[from],target=positions[to]
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...source});await wait(80)
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...source})
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:source.x,y:source.y+15});await wait(130)
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...target});await wait(220)
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...target});await wait(320)
  }
  await drag(0,1);await until("document.querySelector('.server-identity strong').textContent==='Survival dünyam'")
  assert.equal((await evaluate("window.launcher.getServers()")).at(0).name,'Survival dünyam')
  await drag(0,1);await until("document.querySelector('.server-identity strong').textContent==='Green Community'")
  console.log('PASS compact neutral table, actions in the right panel and actual animated pointer reorder persisted')
  await shot('qa-servers-page')
  await button('Listeyi yenile');await until("[...document.querySelectorAll('.toast')].some(e=>e.textContent.includes('Sunucu listesi güncellendi.'))")
  await button('Sunucu ekle');await until("!!document.querySelector('.server-edit-dialog')");await key('1');assert.equal(await evaluate("document.querySelector('.main-content').classList.contains('page-servers')"),true)
  await input('.server-edit-dialog input:nth-of-type(1)','Yeni sunucu');await input('.server-edit-dialog label:nth-child(2) input','play.newserver.org:25568');await click('.server-resource-select .dropdown-trigger');await until("!!document.querySelector('.server-resource-select .dropdown-menu')");await button('Her zaman indir');await shot('qa-server-edit')
  await button('Kaydet');await until("document.querySelectorAll('.server-row').length===3")
  await until("document.querySelectorAll('.server-online.online').length===2")
  assert.equal((await evaluate("window.launcher.getServers()")).at(-1).resourcePacks,'enabled')
  await click('.servers-sort-select .dropdown-trigger');await button('Oyuncu sayısı: azalan');assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Yeni sunucu')
  await click('.servers-sort-select .dropdown-trigger');await button('Oyuncu sayısı: artan');assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Green Community')
  await click('.servers-sort-select .dropdown-trigger');await button('Sunucu adı: Z–A');assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Yeni sunucu')
  await click('.servers-sort-select .dropdown-trigger');await button('Sunucu adı: A–Z');assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Green Community')
  await click('.servers-sort-select .dropdown-trigger');await button('Özel sıralama')
  console.log('PASS sort menu changes visible order by player count and names; resource preference saves')
  await button('Sunucuyu düzenle');await input('.server-edit-dialog label:first-child input','Düzenlenmiş sunucu');await button('Kaydet');await until("document.querySelector('.server-details-identity h3').textContent==='Düzenlenmiş sunucu'")
  await button('Listeden kaldır');await until("!!document.querySelector('.server-delete-dialog')");await shot('qa-server-delete');await click('.server-delete-dialog .danger');await until("document.querySelectorAll('.server-row').length===2")
  console.log('PASS server page status, MOTD, refresh completion toast, add/edit and confirmation before removal')
  await click('.server-details .server-join');await until("!!document.querySelector('.server-join-dialog')");await click('.servers-profile-select .dropdown-trigger');await until("!!document.querySelector('.profile-picker-menu')");await shot('qa-server-profile-picker');await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await wait(100);await click('.server-join-dialog .modal-primary');await until("!document.querySelector('.server-join-dialog')")
  let launches=await evaluate("window.launcher.getState().then(s=>s.qaLaunches)");assert.equal(launches.at(-1).serverAddress,'play.example.org:25565');assert.equal(launches.at(-1).profileId,'qa-profile');assert.equal(launches.at(-1).serverPreference.resourcePacks,'prompt');assert.equal(launches.at(-1).serverPreference.name,'Green Community')
  await nav('Profillerim');await evaluate("document.querySelector('.profile-card').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:500,clientY:300}))");await until("!!document.querySelector('.profile-mods-folder')");assert.match(await evaluate("document.querySelector('.profile-mods-folder').title"),/mods$/);await shot('qa-profile-mod-folder');await click('.profile-mods-folder')
  await nav('Sürümler');await button('İstemci içe aktar');await until("document.querySelector('.version-row strong').textContent==='1.8.9-SPECIAL'");assert.equal(await evaluate("document.querySelectorAll('.version-row').length"),1);assert.equal(await evaluate("document.querySelector('.version-row img').naturalWidth"),512);assert.equal(await evaluate("document.querySelector('.version-main span:last-child').textContent"),'Özel istemci');await shot('qa-custom-client');const columns=await evaluate("(()=>{const h=document.querySelectorAll('.list-head>span');const r=document.querySelector('.version-row');return {heading:h[1].getBoundingClientRect().left,value:r.querySelector('.row-date>span').getBoundingClientRect().left,date:h[1].getBoundingClientRect().left,status:h[2].getBoundingClientRect().left,width:r.getBoundingClientRect().width}})()");assert.ok(Math.abs(columns.heading-columns.value)<1);assert.ok(columns.status-columns.date>170)
  console.log('PASS publication dates start exactly under their heading with more space before Status')
  await click('.version-filter-trigger');await until("!!document.querySelector('.version-filter-menu')");assert.equal(await evaluate("[...document.querySelectorAll('.version-filter-menu button')].some(b=>b.textContent.includes('Özel istemci'))"),true);await shot('qa-custom-filter');await click('.version-filter-trigger')
  console.log('PASS server join carries its address, mods folder context action and imported client has the Cracked Stone Bricks icon/filter')
  await nav('Ayarlar');await button('Java');await button('Kurulumlar');await button('Yeniden tara');await until("[...document.querySelectorAll('.toast')].some(e=>e.textContent.includes('Java taraması tamamlandı.'))");assert.equal(await evaluate("[...document.querySelectorAll('.settings-tabs button')].some(b=>b.textContent.trim()==='Hakkında')"),true)
  await nav('Sunucular');await evaluate("window.launcher.getState().then(async state=>{for(const p of state.profiles)await window.launcher.deleteProfile(p.id)})");await wait(150)
  await click('.server-details .server-join');await until("!!document.querySelector('.server-join-dialog input')");await input('.server-join-dialog input','NewPlayer');await shot('qa-server-offline-join');await click('.server-join-dialog .modal-primary');await until("!document.querySelector('.server-join-dialog')")
  launches=await evaluate("window.launcher.getState().then(s=>s.qaLaunches)");assert.equal(launches.at(-1).profileId,null);assert.equal(launches.at(-1).serverAddress,'play.example.org:25565');assert.equal(launches.at(-1).versionId,'1.21.1');assert.equal(await evaluate("window.launcher.getState().then(s=>s.profiles.length)"),0)
  console.log('PASS Java scan toast, About renamed, offline standalone server join without creating profiles')
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false});await shot('qa-servers-minimum')
  assert.equal(await evaluate("document.querySelector('.servers-workspace').getBoundingClientRect().right<=window.innerWidth"),true)
  assert.equal(await evaluate("document.querySelector('.side-nav').getBoundingClientRect().bottom < document.querySelector('.account-tile').getBoundingClientRect().top"),true)
  const headings={tr:'Sunucular',en:'Servers',de:'Server',fr:'Serveurs',ru:'Серверы',pl:'Serwery'}
  for(const [language,heading] of Object.entries(headings)) {
    await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`);await call('Page.reload');await until("!!document.querySelector('.side-nav')");await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false});await key('4');await until("!!document.querySelector('.servers-workspace')")
    assert.equal(await evaluate("document.querySelector('.servers-page .page-heading h2').textContent"),heading)
    const bounds=await evaluate("(()=>{const p=document.querySelector('.servers-page').getBoundingClientRect();const a=document.querySelector('.servers-heading-actions').getBoundingClientRect();const w=document.querySelector('.servers-workspace').getBoundingClientRect();return {right:Math.max(a.right,w.right),pageRight:p.right}})()");assert.ok(bounds.right<=bounds.pageRight+1)
    await click('.servers-heading-actions button:last-child');await until("!!document.querySelector('.server-edit-dialog')")
    assert.equal(await evaluate("(()=>{const d=document.querySelector('.server-edit-dialog').getBoundingClientRect();return [...document.querySelectorAll('.server-edit-dialog input,.server-edit-dialog .modal-actions button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=d.left&&r.right<=d.right})})()"),true)
    assert.equal(await evaluate("(()=>{const d=document.querySelector('.server-details').getBoundingClientRect();return [...document.querySelectorAll('.server-details-actions button')].every(e=>e.getBoundingClientRect().right<=d.right)})()"),true);await shot('qa-servers-'+language);await click('.server-edit-dialog .modal-close')
  }
  console.log('PASS six real localized server layouts and dialog controls at minimum window width')
  assert.equal(errors.length,0,JSON.stringify(errors))
  console.log('PASS minimum window layout and no renderer exceptions')
} finally { socket.close() }
