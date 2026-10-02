import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const nbt=createRequire(import.meta.url)('prismarine-nbt')
const helpers=readFileSync('scripts/qa-servers-custom.mjs','utf8').split('try {')[0].replace(/^import[^\n]*\n/gm,'')
const checks=String.raw`
try {
  await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'}).then(()=>window.launcher.selectProfile('qa-profile'))")
  await call('Page.reload');await until("document.querySelector('.side-nav')");await key('4');await until("document.querySelector('.server-online.online')")
  assert.equal(await evaluate("document.querySelectorAll('.servers-sort-select').length"),0)
  assert.equal(await evaluate("document.querySelector('.servers-list-profile-select .dropdown-copy strong').textContent"),'Test World')
  assert.equal(await evaluate("document.querySelector('.server-join').disabled"),false)
  await click('.server-row:last-child .server-select')
  assert.equal(await evaluate("document.querySelector('.server-join').disabled"),true)
  await click('.server-join')
  await evaluate("document.querySelector('.server-row:last-child .server-select').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
  assert.equal(await evaluate("document.querySelectorAll('.server-join-dialog').length"),0)
  await shot('qa-profile-servers-offline')
  const chooseProfile=async name=>{await click('.servers-list-profile-select .dropdown-trigger');await until("document.querySelector('.profile-picker-menu')");await evaluate("[...document.querySelectorAll('.profile-picker-menu [role=option]')].find(e=>e.querySelector('strong').textContent==="+JSON.stringify(name)+").click()");await until("!document.querySelector('.servers-list-profile-select .dropdown-trigger').disabled")}
  await chooseProfile('Test World 2')
  assert.equal(await evaluate("document.querySelectorAll('.server-row').length"),0)
  await click('.servers-heading-actions button:last-child');await until("document.querySelector('.server-edit-dialog')")
  await input('.server-edit-dialog label:first-child input','Profile Two server');await input('.server-edit-dialog label:nth-child(2) input','play.second.example.org')
  await click('.server-edit-dialog .modal-primary');await until("document.querySelector('.server-online.online')")
  const state=await evaluate("window.launcher.getState()"),aFile=join(state.dataPath,'profiles','qa-profile','servers.dat'),bFile=join(state.dataPath,'profiles','qa-profile-1','servers.dat')
  const parse=file=>nbt.parseUncompressed(readFileSync(file))
  assert.equal(parse(bFile).value.servers.value.value[0].name.value,'Profile Two server')
  assert.equal((await evaluate("window.launcher.getServers('qa-profile')")).length,2)
  assert.equal((await evaluate("window.launcher.getServers('qa-profile-1')")).length,1)
  await click('.server-join');await until("document.querySelector('.server-join-dialog')")
  let race=parse(bFile);race.value.servers.value.value[0].ip.value='localhost:25567';writeFileSync(bFile,nbt.writeUncompressed(race))
  await click('.server-join-dialog .modal-primary');await until("document.querySelector('.server-join-dialog .server-form-error')||!document.querySelector('.server-join-dialog')")
  assert.equal((await evaluate("window.launcher.getState().then(s=>s.qaLaunches)")).length,0)
  if(await evaluate("!!document.querySelector('.server-join-dialog')")) {assert.equal(await evaluate("document.querySelector('.server-join-dialog .modal-primary').disabled"),true);await click('.server-join-dialog .modal-close')}
  race=parse(bFile);race.value.servers.value.value[0].ip.value='play.second.example.org';writeFileSync(bFile,nbt.writeUncompressed(race))
  await until("document.querySelector('.server-online.online')")
  await click('.server-details-actions button:nth-child(2)');await until("document.querySelector('.server-edit-dialog')")
  await input('.server-edit-dialog label:first-child input','Renamed from launcher');await click('.server-edit-dialog .modal-primary');await until("!document.querySelector('.server-edit-dialog')")
  assert.equal(parse(bFile).value.servers.value.value[0].name.value,'Renamed from launcher')
  await shot('qa-profile-servers-selected')
  await chooseProfile('Test World')
  let doc=parse(aFile);doc.value.servers.value.value[0].name.value='Renamed in Minecraft'
  doc.value.servers.value.value.push({name:{type:'string',value:'Added in Minecraft'},ip:{type:'string',value:'added.example.org'}});writeFileSync(aFile,nbt.writeUncompressed(doc))
  await until("[...document.querySelectorAll('.server-identity strong')].some(e=>e.textContent==='Added in Minecraft')")
  assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Renamed in Minecraft')
  doc=parse(aFile);doc.value.servers.value.value.splice(0,1);writeFileSync(aFile,nbt.writeUncompressed(doc))
  await until("document.querySelectorAll('.server-row').length===2")
  assert.equal(await evaluate("[...document.querySelectorAll('.server-identity strong')].some(e=>e.textContent==='Renamed in Minecraft')"),false)
  assert.equal(await evaluate("[...document.querySelectorAll('.server-identity strong')].some(e=>e.textContent==='Renamed from launcher')"),false)
  await chooseProfile('Test World 2');await until("document.querySelector('.server-online.online')")
  assert.equal(await evaluate("document.querySelector('.server-identity strong').textContent"),'Renamed from launcher')
  await click('.server-details-actions .danger');await until("document.querySelector('.server-delete-dialog')");await click('.server-delete-dialog .danger');await until("document.querySelectorAll('.server-row').length===0")
  assert.equal(parse(bFile).value.servers.value.value.length,0)
  console.log('PASS real profile servers.dat CRUD, independent profile picker, game-to-launcher live add/rename/delete polling, and disabled offline join including double-click')
  const headings={tr:'Sunucular',en:'Servers',de:'Server',fr:'Serveurs',ru:'Серверы',pl:'Serwery'}
  for(const [language,heading] of Object.entries(headings)) {
    await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')");await key('4');await until("document.querySelector('.servers-list-profile-select')&&!document.querySelector('.servers-list-profile-select .dropdown-trigger').disabled")
    await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
    assert.equal(await evaluate("document.querySelector('.servers-page .page-heading h2').textContent"),heading)
    assert.equal(await evaluate("(()=>{const w=document.querySelector('.servers-workspace').getBoundingClientRect(),p=document.querySelector('.servers-list-profile-select').getBoundingClientRect(),s=document.querySelector('.servers-toolbar').getBoundingClientRect();return w.right<=innerWidth&&p.right<=s.right&&document.documentElement.scrollWidth<=innerWidth})()"),true)
  }
  await evaluate("window.launcher.getState().then(async s=>{for(const p of s.profiles)await window.launcher.deleteProfile(p.id)})")
  await until("!document.querySelector('.statusbar-profile')")
  assert.equal(await evaluate("document.querySelector('.statusbar-end').textContent.includes('Minecraft')"),false)
  await shot('qa-profile-servers-no-profile-footer')
  assert.equal(errors.length,0,JSON.stringify(errors))
  console.log('PASS six localized profile-picker layouts and no Minecraft status label when no profile is selected')
} finally {socket.close()}
`
await new Function('assert','writeFileSync','readFileSync','join','nbt','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync,readFileSync,join,nbt)
