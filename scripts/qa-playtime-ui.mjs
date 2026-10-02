import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 await evaluate("window.launcher.saveSettings({language:'tr',qaPlaySessions:[],qaDownloads:[],qaActivity:{kind:'idle',label:'Hazır'},qaUpdate:{phase:'current',version:null,error:null}})");await evaluate("window.launcher.selectProfile('qa-profile')");await call('Page.reload');await until("document.querySelector('.statusbar-download')")
 const appearance=()=>evaluate("(()=>{const s=getComputedStyle(document.querySelector('.statusbar-download'));return {font:s.font,color:s.color,background:s.backgroundColor,cursor:s.cursor,padding:s.padding,margin:s.margin}})()")
 const normal=await appearance();assert.equal(await evaluate("document.querySelector('.statusbar-download').textContent"),'Başlatmaya hazır')
 const end='2026-10-02T13:47:00.000Z'
 const sessions=[{id:'recent',profileId:'qa-profile',profileName:'Test World',versionId:'26.3',startedAt:'2026-10-02T13:45:21.000Z',endedAt:end,durationMs:99_000}]
 await evaluate('window.launcher.saveSettings('+JSON.stringify({qaPlaySessions:sessions})+')');await call('Page.reload');await until("document.querySelector('.statusbar-playtime')")
 assert.equal(await evaluate("document.querySelector('.statusbar-playtime').textContent"),'Başlatmaya hazır, en son 02.10.2026 16:47 tarihinde 1 dk 39 sn süreyle oynandı (toplam 1 dk 39 sn)')
 assert.deepEqual(await appearance(),normal,'history inherits exactly the ordinary status text appearance')
 assert.equal(await evaluate("document.querySelector('.statusbar-playtime').tagName"),'SPAN')
 assert.equal(await evaluate("document.querySelector('.statusbar-playtime').tabIndex"),-1)
 await click('.statusbar-playtime');assert.equal(await evaluate("!!document.querySelector('.account-dialog,.playtime-dialog')"),false)
 const r=await evaluate("(()=>{const r=document.querySelector('.statusbar-playtime').getBoundingClientRect();return {x:r.left+50,y:r.top+r.height/2}})()")
 await call('Input.dispatchMouseEvent',{type:'mouseMoved',...r});await wait(220);assert.deepEqual(await appearance(),normal,'hover does not change status text')
 await shot('qa-0173-plain-footer')
 await click('.statusbar-profile');await until("document.querySelector('.main-content.page-profiles')")
 await evaluate("document.querySelector('.profile-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await until("document.querySelector('.profile-information-dialog')")
 assert.equal(await evaluate("document.querySelectorAll('.profile-playtime-link').length"),0)
 assert.equal(await evaluate("document.querySelector('.profile-information-dialog').textContent.includes('Oyun süresi istatistikleri')"),false)
 await shot('qa-0173-profile-information');await click('.profile-information-dialog .modal-close')
 await evaluate("window.launcher.selectProfile('qa-profile-1')");await until("!document.querySelector('.statusbar-playtime')");await call('Page.reload');await until("document.querySelector('.statusbar-profile')")
 assert.equal(await evaluate("window.launcher.getState().then(s=>s.selectedProfileId)"),'qa-profile-1')
 assert.equal(await evaluate("document.querySelector('.statusbar-download').textContent"),'Başlatmaya hazır')
 await evaluate("window.launcher.selectProfile('qa-profile')");await call('Page.reload');await until("document.querySelector('.statusbar-playtime')")
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.statusbar-playtime')")
  assert.match(await evaluate("document.querySelector('.statusbar-playtime').textContent"),/\(.*\)$/)
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.statusbar-playtime')).font===getComputedStyle(document.querySelector('.statusbar')).font"),true)
  await click('.statusbar-profile');await until("document.querySelector('.main-content.page-profiles')")
  assert.equal(await evaluate("document.querySelectorAll('.playtime-dialog,.profile-playtime-link').length"),0)
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.statusbar-playtime')")
 await evaluate("window.launcher.saveSettings({qaDownloads:[{id:'qa-active',title:'Minecraft QA',phase:'downloading',downloadedBytes:100,totalBytes:1000,bytesPerSecond:10,priority:0,forLaunch:false}]})");await until("!document.querySelector('.statusbar-playtime')");assert.match(await evaluate("document.querySelector('.statusbar-download').textContent"),/Minecraft QA/)
 await evaluate("window.launcher.saveSettings({qaDownloads:[],qaActivity:{kind:'launching',label:'Oyun başlatılıyor'}})");await until("!document.querySelector('.statusbar-playtime')");assert.match(await evaluate("document.querySelector('.statusbar-download').textContent"),/Oyun başlatılıyor/)
 await evaluate("window.launcher.saveSettings({qaActivity:{kind:'idle',label:'Hazır'},qaUpdate:{phase:'downloading',percent:42}})");await until("!document.querySelector('.statusbar-playtime')");assert.match(await evaluate("document.querySelector('.statusbar-download').textContent"),/Güncelleme indiriliyor.*42/)
 await evaluate("window.launcher.saveSettings({qaUpdate:{phase:'current'}})");await key('9');await button('Launcher');await until("document.querySelector('.launcher-update-settings')")
 assert.equal(await evaluate("document.querySelector('.main-content.page-settings').textContent.includes('Oyun süresi istatistikleri')"),false)
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS exact plain footer text and unchanged font, no click/hover/menu, last selected profile restored on reload, profile shortcut, removed information entry, six languages and download/launch/update priority')
} finally {socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
