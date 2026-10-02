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
try {
  await send('Runtime.enable');await send('Page.reload');await until("!!document.querySelector('.launch-panel')");await wait(250)
  await shot('qa-refinements-home')
  await nav('Sürümler')
  checks.push(await evaluate("(()=>{const table=document.querySelector('.version-list').getBoundingClientRect(),date=document.querySelector('.list-head span:nth-child(2)').getBoundingClientRect();return {dateCenterOffset:(date.left+date.width/2)-(table.left+table.width/2),controls:[...document.querySelectorAll('.filter-tabs button,.version-search-tools input,.version-filter-trigger')].map(e=>({text:e.textContent,font:getComputedStyle(e).fontFamily,size:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height}))}})()"))
  await shot('qa-refinements-versions')
  await nav('Ekran görüntüleri');checks.push(await evaluate("[...document.querySelectorAll('.library-toolbar .dropdown-trigger')].map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e.querySelector('strong')).fontFamily,size:getComputedStyle(e.querySelector('strong')).fontSize}))"));await shot('qa-refinements-gallery')
  await nav('Profillerim');await click('.profile-more');await button('Profili düzenle');await click('.profile-version-select .dropdown-trigger');await until("!!document.querySelector('.profile-version-menu')");await wait(250)
  for(const height of [780,650]){
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height,deviceScaleFactor:1,mobile:false});await wait(100)
    if(!await evaluate("!!document.querySelector('.profile-version-menu')"))await click('.profile-version-select .dropdown-trigger')
    const bounds=await rect('.profile-version-menu');assert.ok(bounds.y>=0&&bounds.bottom<=height,JSON.stringify(bounds));checks.push({menuHeight:height,bounds});await shot(`qa-refinements-version-menu-${height}`)
    await click('.profile-version-menu [role=option]:nth-child(2)');assert.equal(await evaluate("!!document.querySelector('.profile-version-menu')"),false)
    await click('.profile-version-select .dropdown-trigger')
  }
  await click('.profile-version-menu [role=option]:first-child');await click('.profile-modal .modal-close');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:780,deviceScaleFactor:1,mobile:false})
  await evaluate("document.querySelectorAll('.profile-more')[1].click()");await button('Profili düzenle');assert.equal(await evaluate("document.querySelector('.profile-version-select button').disabled"),true);await click('.profile-modal .modal-close')
  await evaluate("document.querySelector('.profile-card:nth-child(2)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await until("!!document.querySelector('.profile-information-mods li')");await click('.profile-information-pack button');await until("window.launcher.getState().then(s=>s.qaExternalOpened.some(u=>u.includes('modrinth.com/modpack')))");await shot('qa-refinements-information');await click('.profile-information-dialog .modal-close')
  await evaluate("document.querySelector('.profile-card:nth-child(3)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await until("!!document.querySelector('.profile-information-empty-note')");assert.equal(await evaluate("!!document.querySelector('.profile-information-section h3 > span')"),false);await shot('qa-refinements-information-empty');await click('.profile-information-dialog .modal-close')
  await click('.statusbar-changelog');await until("!!document.querySelector('.release-history-version')");await wait(300);assert.equal(await evaluate("getComputedStyle(document.querySelector('.release-history-version')).borderTopWidth"),'0px');await shot('qa-refinements-changelog');await click('.release-history-version:nth-child(2)');assert.match(await evaluate("document.querySelector('.release-history-detail').textContent"),/genel akışı/);await click('.changelog-dialog .modal-close');await wait(250)
  await nav('Ayarlar');await button('Günlükler');await wait(250);await evaluate("document.querySelector('.journal-entry-trigger').scrollIntoView({block:'center'})");await wait(100)
  const log=await rect('.journal-entry-trigger');await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:log.x+30,y:log.y+20});checks.push(await evaluate("(()=>{const e=document.querySelector('.journal-entry'),b=e.querySelector('button'),r=e.getBoundingClientRect(),s=b.getBoundingClientRect();return{separatorGap:r.bottom-s.bottom,background:getComputedStyle(b).backgroundColor}})()"));await shot('qa-refinements-logs-hover')
  await button('Hakkında');await click('.launcher-about-facts button');await until("window.launcher.getState().then(s=>s.qaExternalOpened.includes('https://github.com/Despical'))");await evaluate("document.querySelector('.launcher-about-note').scrollIntoView({block:'nearest'})");await shot('qa-refinements-about-footer')
  await nav('İndirmeler');assert.equal(await evaluate("[...document.querySelectorAll('.download-job-icon img,.download-history-icon img')].every(e=>!e.draggable)"),true)
  await button('İndirme ayarları');assert.equal(await evaluate("document.querySelector('.download-settings-dialog').textContent.includes('Her indirme için ayrı uygulanır.')"),false);await shot('qa-refinements-download-settings')
  assert.equal(errors.length,0,JSON.stringify(errors));writeFileSync('build/qa-october-refinements-results.json',JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2))
} finally {socket.close()}
