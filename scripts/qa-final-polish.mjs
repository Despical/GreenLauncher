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
const shot = async name => { await wait(250); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(`build/${name}.png`, Buffer.from(r.data, 'base64')) }
const input = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
const rect = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}})()`)

try {
  await send('Runtime.enable'); await send('Page.reload'); await until("!!document.querySelector('.home-profile-select')")
  assert.match(await evaluate("document.querySelector('.statusbar-profile').textContent"), /Minecraft.*Fabric.*Test World/)
  assert.equal(await evaluate("document.querySelector('.launch-panel h2').textContent"), 'Oyun profili')
  await shot('qa-final-home')
  await click('.home-profile-select .dropdown-trigger'); await until("!!document.querySelector('.profile-picker-menu input')")
  const bounds=await rect('.profile-picker-menu'); assert.ok(bounds.y>=0 && bounds.bottom<=await evaluate('innerHeight'))
  const inset=await evaluate("(()=>{const s=document.querySelector('.profile-picker-menu .dropdown-search-divider').getBoundingClientRect();const o=document.querySelector('.profile-picker-menu [role=option]').getBoundingClientRect();return o.top-s.bottom})()"); assert.ok(inset>=8)
  await wait(100); assert.equal(await evaluate("getComputedStyle(document.querySelector('.home-profile-select .lucide-chevron-down')).transform"), 'matrix(-1, 0, 0, -1, 0, 0)')
  await input('.profile-picker-menu input','fab'); await wait(100); assert.equal(await evaluate("document.querySelectorAll('.profile-picker-menu [role=option]').length"),1)
  await shot('qa-final-home-search'); await click('.profile-picker-menu [role=option]'); await wait(220)
  assert.match(await evaluate("document.querySelector('.statusbar-profile').textContent"),/Fabulously Optimized/)
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.home-profile-select .lucide-chevron-down')).transform"), 'matrix(1, 0, 0, 1, 0, 0)')
  checks.push('Home search, keyboard-ready portal, insets, arrow rotation and status profile selection')
  await nav('Ekran görüntüleri'); await click('.gallery-profile-select .dropdown-trigger'); await until("!!document.querySelector('.profile-picker-menu input')"); await input('.profile-picker-menu input','Test World 3'); await wait(100); assert.equal(await evaluate("document.querySelectorAll('.profile-picker-menu [role=option]').length"),1);await shot('qa-final-gallery-search'); await click('.profile-picker-menu [role=option]')
  checks.push('Gallery profile filter shares searchable inset dropdown')
  await nav('Profillerim'); await evaluate("document.querySelector('.profile-card:nth-child(3)').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await until("!!document.querySelector('.profile-information-empty-note')")
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.profile-information-empty-note')).borderTopWidth"),'1px');assert.equal(await evaluate("document.querySelectorAll('.profile-information-empty-note .lucide-info').length"),1);await shot('qa-final-empty-information');await click('.profile-information-dialog .modal-close')
  await evaluate("window.launcher.selectProfile('qa-profile')"); await nav('Ana Sayfa'); await click('.launch-profile-edit'); await until("!!document.querySelector('.profile-server-field input')")
  const gaps=await evaluate("(()=>{const a=document.querySelector('.profile-modal .form-grid > label input');const b=document.querySelector('.profile-server-field input');const c=document.querySelector('.profile-version-field .dropdown-trigger');return {font:getComputedStyle(b.parentElement).fontSize,other:getComputedStyle(a.parentElement).fontSize,margin:getComputedStyle(b).marginTop,otherMargin:getComputedStyle(a).marginTop,height:c.getBoundingClientRect().height,order:b.parentElement.nextElementSibling.className}})()")
  assert.equal(gaps.font,gaps.other);assert.equal(gaps.margin,gaps.otherMargin);assert.equal(gaps.height,58);assert.match(gaps.order,/profile-fullscreen-toggle/)
  await input('.profile-server-field input','play.example.org:25567');await button('Kaydet');await until("!document.querySelector('.profile-modal')")
  assert.equal(await evaluate("window.launcher.getState().then(s=>s.profiles.find(p=>p.id==='qa-profile').serverAddress)"),'play.example.org:25567')
  await click('.launch-profile-edit'); await click('.profile-version-select .dropdown-trigger');await until("!!document.querySelector('.profile-version-menu input')");await shot('qa-final-profile-version');await evaluate("document.querySelector('.profile-version-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await click('.profile-modal .modal-close')
  await evaluate("window.launcher.getState().then(s=>window.launcher.saveProfile({...s.profiles.find(p=>p.id==='qa-profile'),versionId:'b1.7.3',modLoader:undefined,modLoaderVersion:undefined}))");await wait(100);await click('.launch-profile-edit');assert.equal(await evaluate("document.querySelectorAll('.profile-server-field').length"),0);await click('.profile-modal .modal-close')
  await evaluate("window.launcher.getState().then(s=>window.launcher.saveProfile({...s.profiles.find(p=>p.id==='qa-profile'),versionId:'1.21.1',modLoader:'fabric',modLoaderVersion:'1.21.1-fabric'}))")
  checks.push('Server field typography, supported-version gating, persistence and taller version picker')
  await nav('Ayarlar');await button('Java');await until("!!document.querySelector('.java-preferences')");await shot('qa-final-java-general')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.java-preference-divider')).height"),'1px');await input('#java-custom-path','C:\\Java\\bin\\javaw.exe');assert.equal(await evaluate("document.querySelector('#java-custom-path').value"),'C:\\Java\\bin\\javaw.exe')
  await button('Kurulumlar');await until("document.querySelectorAll('.java-installations-list li').length===3");assert.equal(await evaluate("document.querySelectorAll('.java-installation-delete').length"),1);await shot('qa-final-java-installations');await click('.java-rescan');await until("!document.querySelector('.java-rescan').disabled")
  checks.push('Redesigned Java general and installations; editable path, separate memory, managed-only delete, rescan')
  await button('Depolama');await button('Yeniden tara');await until("document.querySelector('.toast')?.textContent.includes('Depolama taraması tamamlandı.')");await button('Temizlenecekleri gör');await until("!!document.querySelector('.cleanup-preview-modal')");assert.equal((await rect('.cleanup-preview-modal')).width,800);await shot('qa-final-cleanup-preview');await click('.cleanup-preview-modal .modal-close')
  checks.push('Storage rescan completion notification and 800px cleanup preview')
  await click('.launcher-brand-menu .brand');await until("!!document.querySelector('.launcher-links-menu')");await shot('qa-final-brand-menu');await button('Kaynak kodu');await until("window.launcher.getState().then(s=>s.qaExternalOpened.some(u=>u==='https://github.com/Despical/GreenLauncher'))")
  await click('.launcher-brand-menu .brand');await button('Hakkında');await until("!!document.querySelector('.launcher-about')");assert.equal(await evaluate("document.querySelectorAll('.launcher-links-menu').length"),0)
  checks.push('Launcher brand menu opens actual source URL and navigates to About')
  await click('.statusbar-changelog');await until("!!document.querySelector('.release-history-build')");assert.equal(await evaluate("getComputedStyle(document.querySelector('.release-history-build')).borderTopWidth"),'1px');await shot('qa-final-changelog')
  assert.equal(errors.length,0); console.log(JSON.stringify({passed:checks.length,checks,errors},null,2))
} finally { socket.close() }
