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
 for(const language of ['tr','en','de','fr','ru','pl']) {
  await evaluate(`window.launcher.saveSettings({language:'${language}'})`);await call('Page.reload');await until("document.querySelector('.side-nav')")
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false});await key('2');await until("document.querySelector('.version-row .release-link')")
  const measurements=await evaluate("(()=>{const heads=document.querySelectorAll('.list-head>span');const row=document.querySelector('.version-row');const value=row.querySelector('.row-date>span');const link=row.querySelector('.release-link');const range=document.createRange();range.selectNodeContents(value);return {heading:heads[1].getBoundingClientRect().left,date:value.getBoundingClientRect().left,textEnd:range.getBoundingClientRect().right,linkStart:link.getBoundingClientRect().left,status:heads[2].getBoundingClientRect().left,end:row.getBoundingClientRect().right,width:window.innerWidth}})()")
  assert.ok(Math.abs(measurements.heading-measurements.date)<1);assert.ok(measurements.linkStart-measurements.textEnd>=7);assert.ok(measurements.status-measurements.date>=160);assert.ok(measurements.end<=measurements.width)
  await shot('qa-version-columns-'+language)
 }
 console.log('PASS dates share heading alignment, translated date text never overlaps release links, Status has a clear gap, all six languages at 1080px')
}finally{socket.close()}
