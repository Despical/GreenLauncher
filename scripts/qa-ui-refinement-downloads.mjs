import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let tab
for (let i = 0; i < 100; i++) { try { tab = (await (await fetch('http://127.0.0.1:9225/json/list')).json()).find(item => item.type === 'page'); if (tab) break } catch {} await wait(100) }
assert.ok(tab)
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(resolve => socket.onopen = resolve)
let id = 0
const pending = new Map(), errors = [], checks = []
socket.onmessage = event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params); const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result) } }
const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })) })
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await wait(60) } throw Error(expression) }
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait(160) }
const nav = async text => { await evaluate(`[...document.querySelectorAll('.side-nav button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`); await wait(180) }
const shot = async name => { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(`build/${name}.png`, Buffer.from(result.data, 'base64')) }
const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
const selection = async (selector, parent) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
  await wait(200)
  const geometry = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),p=e.closest(${JSON.stringify(parent)}).getBoundingClientRect(),s=getComputedStyle(e);return {left:r.left-p.left,right:p.right-r.right,background:s.backgroundColor,shadow:s.boxShadow}})()`)
  assert.ok(Math.abs(geometry.left - geometry.right) < .6, JSON.stringify({ selector, geometry }))
  assert.equal(geometry.background, 'rgb(50, 73, 63)', selector)
  assert.equal(geometry.shadow, 'none', selector)
  const hover = await evaluate(`(()=>{const selected=document.querySelector(${JSON.stringify(selector)}),menu=selected.closest(${JSON.stringify(parent)}),other=[...menu.querySelectorAll('button')].find(b=>b!==selected&&!b.matches('[aria-selected=true],.selected,[aria-checked=true]'));if(!other)return null;other.scrollIntoView({block:'nearest'});const r=other.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  if(hover){await send('Input.dispatchMouseEvent',{type:'mouseMoved',...hover});await wait(200);const color=await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(parent)})?.querySelector('button:hover')).backgroundColor`);assert.equal(color,'rgb(38, 62, 50)',selector)}
  const search = await evaluate(`(()=>{const menu=document.querySelector(${JSON.stringify(selector)}).closest(${JSON.stringify(parent)}),search=menu.querySelector('.dropdown-search');if(!search)return null;const line=search.nextElementSibling,a=search.getBoundingClientRect(),b=line.getBoundingClientRect(),item=menu.querySelector('[role=option]')?.getBoundingClientRect();return {separator:line.getAttribute('role'),height:b.height,gap:b.top-a.bottom,clear:!item||item.top>=b.bottom}})()`)
  if(search){assert.equal(search.separator,'separator');assert.equal(search.height,1);assert.ok(search.gap<=8&&search.gap>=3&&search.clear,JSON.stringify(search))}
  checks.push({ selector, geometry, hover:!!hover, search })
}
try {
  await send('Runtime.enable'); await until("!!document.querySelector('.launch-controls')")
  for (const selector of ['.launch-field:first-child .dropdown-trigger','.launch-field:last-child .dropdown-trigger']) {
    await click(selector); await selection('.launch-field [aria-selected=true]', '.dropdown-menu'); await click(selector)
  }
  await click('.launch-field:last-child .dropdown-trigger'); await shot('qa-refined-home-dropdown'); await click('.launch-field:last-child .dropdown-trigger')
  await nav('Sürümler'); await click('.version-row:last-child .variant-trigger')
  assert.equal(await evaluate("document.querySelector('.variant-menu > button.selected strong').textContent"),'Minecraft')
  await selection('.variant-menu > button.selected','.variant-menu'); await shot('qa-refined-variant-default')
  await click('.variant-menu > button:last-child'); await click('.version-row:last-child .variant-trigger')
  assert.equal(await evaluate("document.querySelector('.variant-menu > button.selected strong').textContent"),'OptiFine')
  await click('.variant-trigger[aria-expanded=true]'); await click('.version-row:nth-child(2) .variant-trigger')
  assert.equal(await evaluate("document.querySelector('.variant-menu > button.selected strong').textContent"),'Minecraft')
  await click('.variant-trigger[aria-expanded=true]'); await click('.version-filter-trigger'); await selection('.version-filter-menu [aria-checked=true]', '.version-filter-menu'); await click('.version-filter-trigger')
  await nav('Modlar'); await until("!!document.querySelector('.mods-source-nav')"); await click('.mods-source-nav button:nth-of-type(2)'); await until("!!document.querySelector('.mods-favorite')")
  assert.equal(await evaluate("!!document.querySelector('.mods-type-tabs button:last-child svg')"),false)
  await click('.mods-type-tabs button:last-child'); await until("!!document.querySelector('.mods-favorites-empty')")
  assert.equal(await evaluate("!!document.querySelector('.mods-browser-body')"),false)
  assert.match(await evaluate("document.querySelector('.mods-favorites-empty').textContent"),/Henüz favorin yok.*Modrinth modlarını keşfet/)
  await shot('qa-refined-empty-favorites'); await click('.mods-favorites-empty button'); await until("!!document.querySelector('.mods-favorite')")
  assert.equal(await evaluate("document.querySelector('.mods-type-tabs button:first-child').getAttribute('aria-selected')"),'true')
  await click('.mods-favorite'); await click('.mods-type-tabs button:last-child'); await until("document.querySelectorAll('.mods-hit').length===1")
  await click('.mods-favorite'); await until("!!document.querySelector('.mods-favorites-empty')"); await click('.mods-favorites-empty button'); await until("!!document.querySelector('.mods-favorite')")
  for(const label of ['Profil','Minecraft sürümü','Mod yükleyicisi']) {
    const trigger=`.mods-select .dropdown-trigger[aria-label="${label}"]`
    await click(trigger); await selection('.mods-select.open [aria-selected=true]', '.dropdown-menu'); await click(trigger)
  }
  await click('.mods-filter-button'); await click('.mods-select .dropdown-trigger[aria-label="Kategori"]'); await selection('.mods-select.open [aria-selected=true]', '.dropdown-menu'); await shot('qa-refined-mod-dropdown'); await click('.mods-select.open .dropdown-trigger')
  await click('.mods-source-nav button:nth-of-type(4)'); await until("!!document.querySelector('.mods-favorite')"); await click('.mods-type-tabs button:last-child'); await until("!!document.querySelector('.mods-favorites-empty')")
  assert.match(await evaluate("document.querySelector('.mods-favorites-empty button').textContent"),/Technic paketlerini keşfet/)
  await click('.mods-favorites-empty button'); await until("!!document.querySelector('.mods-favorite')")
  await nav('Ekran görüntüleri')
  for(const selector of ['.gallery-profile-select .dropdown-trigger','.gallery-sort-select .dropdown-trigger']) { await click(selector); await selection('.library-toolbar [aria-selected=true]', '.dropdown-menu'); await click(selector) }
  await nav('Ayarlar'); await click('.settings-tabs button:nth-child(3)'); await click('.language-trigger'); await selection('.language-menu [aria-selected=true]','.language-menu'); await click('.language-trigger'); await click('.settings-tabs button:nth-child(4)'); await until("!!document.querySelector('.log-source-trigger')"); await click('.log-source-trigger'); await selection('.log-source-menu [aria-selected=true]', '.log-source-menu'); await click('.log-source-trigger')
  const original=await evaluate("window.launcher.getState().then(s=>s.selectedAccountId)")
  for(let i=0;i<6;i++) await evaluate(`window.launcher.createOfflineAccount('MenuQA${i}')`)
  await click('.account-tile'); await selection('.account-switcher-list button.selected','.account-switcher'); await shot('qa-refined-account-dropdown'); await click('.account-tile'); await evaluate(`window.launcher.selectAccount(${JSON.stringify(original)})`)
  await nav('İndirmeler'); await until("document.querySelectorAll('.download-job').length===3")
  assert.equal(await evaluate("!!document.querySelector('.download-overview')"),false)
  assert.equal(await evaluate("document.querySelectorAll('.download-job-progress').length"),3)
  await shot('qa-refined-downloads')
  await click('[data-job-id="qa-active"] .download-pause'); await until("document.querySelector('[data-job-id=qa-active]').classList.contains('paused')")
  await click('[data-job-id="qa-active"] .download-pause'); await until("!document.querySelector('[data-job-id=qa-active]').classList.contains('paused')")
  const points=await evaluate("(()=>{const a=document.querySelector('[data-job-id=qa-queued-two]').getBoundingClientRect(),b=document.querySelector('[data-job-id=qa-queued]').getBoundingClientRect();return {x:a.x+100,y:a.y+a.height/2,to:b.y+b.height/2}})()")
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:points.x,y:points.y,button:'left',clickCount:1})
  for(let i=1;i<=12;i++){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x,y:points.y+(points.to-points.y)*i/12,buttons:1,button:'left'});await wait(25)}
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.x,y:points.to,button:'left',clickCount:1})
  await until("document.querySelectorAll('.download-job.queued')[0].dataset.jobId==='qa-queued-two'")
  const key=async(name,code)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key:name,code});await send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code});await wait(180)}
  await evaluate("document.querySelector('[data-job-id=qa-queued] .download-drag-handle').focus()")
  await key(' ','Space');await key('ArrowUp','ArrowUp');await key(' ','Space')
  await until("document.querySelectorAll('.download-job.queued')[0].dataset.jobId==='qa-queued'")
  await click('.download-settings-trigger'); assert.equal(await evaluate("!!document.querySelector('.download-concurrency')"),false)
  const border=await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.download-settings-dialog [role=switch]'));return {top:s.borderTopWidth,bottom:s.borderBottomWidth}})()")
  assert.deepEqual(border,{top:'1px',bottom:'1px'})
  await evaluate("document.querySelector('.download-speed-field input').focus()")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.download-speed-field input')).outlineStyle"),'none')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.download-speed-field input')).boxShadow"),'none')
  await input('.download-speed-field input','1536'); await shot('qa-refined-download-settings'); await click('.download-settings-dialog .modal-actions button:last-child'); await until("!document.querySelector('.download-settings-dialog')")
  assert.equal(await evaluate("window.launcher.getState().then(s=>s.settings.downloadSpeedLimitKiB)"),1536)
  const layouts=[]
  for(const width of [1080,1280]) for(const language of ['tr','en','de','fr','ru','pl']) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:700,deviceScaleFactor:1,mobile:false});await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`);await wait(100)
    assert.equal(await evaluate("document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth"),true)
    await click('.download-settings-trigger')
    const fit=await evaluate("(()=>{const e=document.querySelector('.download-settings-dialog'),r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()")
    assert.equal(fit,true,`${width} ${language}`)
    await key('Escape','Escape'); await until("!document.querySelector('.download-settings-dialog')")
    assert.equal(await evaluate("document.activeElement.classList.contains('download-settings-trigger')"),true); layouts.push({width,language})
  }
  await send('Emulation.clearDeviceMetricsOverride');await evaluate("window.launcher.saveSettings({language:'tr'})")
  assert.deepEqual(errors,[])
  writeFileSync('build/qa-ui-refinement-results.json',JSON.stringify({passed:true,checks,layouts,emptyFavorites:true,variantDefaults:true,pointerAndKeyboardDrag:true,settingsBorderAndFocus:true},null,2))
  console.log('PASS unified dropdown selection and symmetric insets, vanilla/OptiFine defaults, empty favorites CTA, pointer and keyboard queue reordering, settings focus and borders, and 12 layouts')
} finally { socket.close() }
