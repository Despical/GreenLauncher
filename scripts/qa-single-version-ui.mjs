import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const tab = (await (await fetch('http://127.0.0.1:9225/json/list')).json()).find(item => item.type === 'page')
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(resolve => socket.onopen = resolve)
let id = 0
const pending = new Map(), errors = [], checks = []
socket.onmessage = event => { const m = JSON.parse(event.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) } }
const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })) })
const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await wait(60) } throw Error(expression) }
const click = async selector => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});e.click()})()`); await wait(150) }
const button = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click()})()`); await wait(150) }
const nav = async text => { await evaluate(`[...document.querySelectorAll('.side-nav button')].find(e=>e.textContent.trim().toLocaleLowerCase('tr')===${JSON.stringify(text)}.toLocaleLowerCase('tr')).click()`); await wait(160) }
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(`build/${name}.png`, Buffer.from(r.data, 'base64')) }
const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
const rect = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}})()`)
const header = async () => {
  const geometry=await evaluate("(()=>{const e=document.querySelector('.modal .dialog-heading'),h=e.querySelector('h2').getBoundingClientRect(),p=e.querySelector('p').getBoundingClientRect(),c=e.querySelector('.modal-close').getBoundingClientRect(),s=getComputedStyle(e);return{gap:p.top-h.bottom,right:p.right,close:c.left,line:s.borderBottomWidth,padding:s.paddingBottom,margin:s.marginBottom,title:getComputedStyle(e.querySelector('h2')).fontSize,body:getComputedStyle(e.querySelector('p')).fontSize}})()")
  assert.equal(geometry.gap,6);assert.ok(geometry.right+19<=geometry.close);assert.equal(geometry.line,'1px');assert.equal(geometry.title,'21px');assert.equal(geometry.body,'14px');assert.equal(geometry.padding,'20px');assert.equal(geometry.margin,'20px')
}
try {
  await send('Runtime.enable');await send('Page.reload');await wait(200);await until("!!document.querySelector('.launch-controls')")
  assert.match(await evaluate('window.launcher.getState().then(s=>s.dataPath)'),/qa-ui-refresh-/)
  assert.equal(await evaluate("document.querySelectorAll('.launch-field').length"),1)
  await evaluate("window.launcher.saveProfile({id:'qa-profile',name:'Test World',versionId:'1.21.1',modLoader:'fabric',modLoaderVersion:'1.21.1-fabric',javaPath:'',memoryMb:4095,minMemoryMb:1024,width:1280,height:720})");await wait(120)
  await click('.launch-field .dropdown-trigger')
  assert.match(await evaluate("document.querySelector('.launch-field [role=option] small').textContent"),/3\.99 GB RAM/)
  await click('.launch-field [role=option]')
  await shot('qa-single-version-home')
  const initial=await evaluate('window.launcher.getState().then(s=>s.selectedProfileId)')
  await nav('Profillerim');await click('.profile-card:nth-child(2)')
  assert.equal(await evaluate('window.launcher.getState().then(s=>s.selectedProfileId)'),initial)
  assert.equal(await evaluate("!!document.querySelector('.profile-card.selected')"),false)
  assert.match(await evaluate("document.querySelector('.profile-stats').textContent"),/3\.99 GB RAM/)
  await evaluate("document.querySelector('.profile-card:nth-child(2)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await until("!!document.querySelector('.profile-information-mods li')")
  await header();assert.match(await evaluate("document.querySelector('.profile-information-dialog').textContent"),/1\.20\.4.*Fabric.*Fabulously Optimized.*Sodium/s)
  assert.equal(await evaluate('window.launcher.getState().then(s=>s.selectedProfileId)'),initial)
  await shot('qa-single-version-profile-info');await click('.profile-information-dialog .modal-close')
  await click('.profile-more');await button('Profili sil');await header();await shot('qa-single-version-delete-confirm');await click('.confirm-modal .modal-close')
  await click('.profile-more');await button('Profili düzenle');await header()
  assert.equal(await evaluate("document.querySelector('.profile-modal .dropdown-trigger').disabled"),false)
  await shot('qa-single-version-edit');await click('.profile-modal .modal-close')
  await button('Yeni profil');await header();assert.equal(await evaluate("document.querySelector('.profile-modal .dropdown-trigger').disabled"),false)
  await click('.profile-modal .dropdown-trigger');await until("document.querySelectorAll('.profile-version-menu [role=option]').length>1")
  await click('.profile-version-menu [role=option]:nth-child(2)');assert.match(await evaluate("document.querySelector('.profile-modal .dropdown-trigger').textContent"),/1\.20\.4/)
  await shot('qa-single-version-create');await click('.profile-modal .modal-close')
  await nav('Sürümler')
  const actions=await evaluate("document.querySelector('.version-row .row-actions').textContent;[...document.querySelectorAll('.version-row .row-actions button')].slice(0,2).map(e=>e.title)")
  assert.deepEqual(actions,['Profilsiz başlat','Sürümü kaldır'])
  await click('.version-row .row-actions button');await until('window.launcher.getState().then(s=>s.qaLaunches.length>0)')
  const launch=await evaluate('window.launcher.getState().then(s=>s.qaLaunches.at(-1))')
  assert.equal(launch.profileId,null);assert.equal(launch.versionId,'1.21.1')
  assert.equal(await evaluate('window.launcher.getState().then(s=>s.selectedProfileId)'),initial)
  const filterStyle=await evaluate("[document.querySelector('.filter-tabs'),document.querySelector('.search-box'),document.querySelector('.version-filter-trigger')].map(e=>[getComputedStyle(e).backgroundColor,getComputedStyle(e).borderColor])")
  assert.deepEqual(filterStyle[0],filterStyle[1]);assert.deepEqual(filterStyle[0],filterStyle[2]);await shot('qa-single-version-versions')
  checks.push('One home picker, two-decimal RAM, read-only profile double-click details, bound edit/new profile selector and standalone play action')
  await nav('Ekran görüntüleri');await until("!!document.querySelector('.gallery-sort-select')")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.gallery-sort-select .dropdown-trigger')).backgroundColor"),'rgb(22, 27, 34)');await shot('qa-single-version-gallery')
  await nav('Ayarlar');await button('Günlükler');await until("!!document.querySelector('.journal-entry')")
  assert.equal(await evaluate("!!document.querySelector('.log-browser')"),false)
  await click('.journal-entry-trigger');await until("!!document.querySelector('.journal-entry-detail')");await shot('qa-single-version-logs')
  await input('.journal-search input','Kayıt 24');await wait(100);assert.equal(await evaluate("document.querySelectorAll('.journal-entry').length"),1)
  await input('.journal-search input','');await wait(100)
  await button('Günlük dosyasını aç')
  await button('Hakkında');await until("!!document.querySelector('.launcher-about')");await shot('qa-single-version-about')
  for(const part of ['greenlauncher.org','github.com','Discord']) await evaluate(`[...document.querySelectorAll('.launcher-about-links button')].find(e=>e.textContent.includes(${JSON.stringify(part)})).click()`)
  const urls=await evaluate('window.launcher.getState().then(s=>s.qaExternalOpened)');assert.ok(urls.includes('https://greenlauncher.org'));assert.ok(urls.includes('https://discord.gg/uXVU8jmtpU'))
  const layouts=[]
  for(const width of [1080,1280]) for(const language of ['tr','en','de','fr','ru','pl']) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:780,deviceScaleFactor:1,mobile:false});await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`);await wait(100)
    assert.equal(await evaluate("document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth"),true)
    await evaluate("document.querySelector('.settings-tabs button:nth-child(4)').click()");await wait(100)
    assert.equal(await evaluate("document.querySelector('.journal-panel').scrollWidth<=document.querySelector('.journal-panel').clientWidth"),true)
    await evaluate("document.querySelector('.settings-tabs button:nth-child(5)').click()");await wait(100)
    if(language==='tr')await shot(`qa-single-version-about-${width}`)
    layouts.push({width,language})
  }
  await evaluate("window.launcher.saveSettings({language:'tr'})");await wait(100)
  await nav('İndirmeler');await until("!!document.querySelector('.download-history em')")
  assert.equal(await evaluate("document.querySelector('.download-history em').textContent"),'Başarıyla indirildi')
  await button('İndirme ayarları');await header();await shot('qa-single-version-download-dialog');await click('.download-settings-dialog .modal-close')
  await evaluate("document.querySelector('.download-history-heading').scrollIntoView({block:'center'});true");await shot('qa-single-version-downloads')
  checks.push('Shared confirmation/header spacing, neutral filter/gallery surfaces, searchable inline logs, About links, translated success wording; 2 widths x 6 languages')
  assert.equal(errors.length,0,JSON.stringify(errors));writeFileSync('build/qa-single-version-results.json',JSON.stringify({passed:true,checks,layouts},null,2));console.log(JSON.stringify({passed:true,checks,layouts},null,2))
} finally { socket.close() }
