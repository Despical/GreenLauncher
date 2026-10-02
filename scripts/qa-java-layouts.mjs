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


const layouts=[];
try {
  await send('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'})");await send('Page.reload');await until("!!document.querySelector('.side-nav')")
  await nav('Ayarlar');await button('Java');await until("!!document.querySelector('.java-preferences')")
  for(const width of [1080,1280])for(const language of ['tr','en','de','fr','ru','pl']){
    await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await send('Page.reload');await until("!!document.querySelector('.side-nav button')");await evaluate("document.querySelector('.side-nav button:last-child').click()");await until("!!document.querySelector('.settings-tabs')");await click('.settings-tabs button:nth-child(2)');await until("!!document.querySelector('.java-preferences')");if(language !== 'tr') assert.notEqual(await evaluate("document.querySelector('.java-settings-head p').textContent"),'Oyunun çalışacağı Java sürümünü ve varsayılan belleği yönet.')
    for(const tab of ['general','installations']){
      await click('#java-'+tab+'-tab');await until("!!document.querySelector('.java-preferences-body')");const layout=await evaluate("(()=>{const p=document.querySelector('.java-preferences');const nodes=[...p.querySelectorAll('button,input,label,h3,h4')];return {overflow:document.documentElement.scrollWidth>innerWidth,nodes:nodes.filter(e=>{let r=e.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth+1)}).map(e=>e.outerHTML)}})()");assert.equal(layout.overflow,false);assert.deepEqual(layout.nodes,[]);layouts.push({width,language,tab})
    }
  }
  await evaluate("window.launcher.saveSettings({language:'tr'})");await send('Emulation.clearDeviceMetricsOverride');console.log(JSON.stringify({passed:layouts.length,errors},null,2));assert.equal(errors.length,0)
}finally{socket.close()}
