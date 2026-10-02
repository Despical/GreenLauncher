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


const disclosure=async selector=>{await until('!!document.querySelector('+JSON.stringify(selector)+')');const expanded=await evaluate('document.querySelector('+JSON.stringify(selector)+').getAttribute("aria-expanded")');if(expanded==='true')await click(selector);await click(selector);await wait(230);const open=await evaluate('getComputedStyle(document.querySelector('+JSON.stringify(selector)+').querySelector(".lucide-chevron-down,.lucide-chevron-up")).transform');assert.equal(open,'matrix(-1, 0, 0, -1, 0, 0)',selector+' open');await click(selector);await wait(230);assert.equal(await evaluate('getComputedStyle(document.querySelector('+JSON.stringify(selector)+').querySelector(".lucide-chevron-down,.lucide-chevron-up")).transform'),'matrix(1, 0, 0, 1, 0, 0)',selector+' closed');checks.push(selector)}
try {
  await send('Runtime.enable');await send('Page.reload');await until("!!document.querySelector('.home-profile-select')")
  await disclosure('.account-tile');await disclosure('.hero-current');await disclosure('.home-profile-select .dropdown-trigger')
  await nav('Sürümler');await disclosure('.version-filter-trigger');await disclosure('.variant-trigger')
  await nav('Ekran görüntüleri');await disclosure('.gallery-profile-select .dropdown-trigger');await disclosure('.gallery-sort-select .dropdown-trigger')
  await nav('Ayarlar');await button('Launcher');await disclosure('.language-trigger');await button('Günlükler');await disclosure('.journal-source-trigger');await disclosure('.journal-entry-trigger')
  await nav('Modlar');await until("[...document.querySelectorAll('button')].some(b=>b.getClientRects().length && b.textContent.trim()==='Modrinth')");await button('Modrinth');await until("!!document.querySelector('.mods-filter-button')");await disclosure('.mods-filter-button');await disclosure('.mods-select .dropdown-trigger')
  assert.equal(errors.length,0);console.log(JSON.stringify({passed:checks.length,checks,errors},null,2))
}finally{socket.close()}
