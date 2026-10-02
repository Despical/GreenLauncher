import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const wait=ms=>new Promise(r=>setTimeout(r,ms))
let tab
for(let i=0;i<150;i++){try{tab=(await(await fetch('http://127.0.0.1:9228/json/list')).json()).find(t=>t.type==='page'&&t.title==='Green Launcher');if(tab)break}catch{}await wait(100)}
assert.ok(tab,'Portable app opens its main window')
const socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r)
let id=0;const pending=new Map();const errors=[]
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}))})
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(100)}throw Error(expression)}
try{
 await send('Runtime.enable');await until("!!document.querySelector('.app-shell')")
 // Packaged Windows builds resolve the OS roaming folder independently of APPDATA.
 // Keep this smoke test read-only; persistent writes are covered by isolated fixtures.
 const before=await evaluate("window.launcher.getState().then(s=>JSON.stringify(s.settings))")
 const settings=JSON.parse(before)
 const downloads=await evaluate("window.launcher.getDownloads().then(d=>({limit:d.speedLimitKiB,concurrency:d.concurrency,pause:d.pauseWhilePlaying}))")
 assert.equal(downloads.limit,settings.downloadSpeedLimitKiB??0)
 assert.equal(downloads.pause,settings.pauseDownloadsWhilePlaying===true)
 assert.ok(downloads.concurrency>=1&&downloads.concurrency<=8)
 await evaluate("document.querySelector('.side-nav button:has(.lucide-cloud-download)').click()")
 await until("!!document.querySelector('.download-settings-trigger')")
 assert.equal(await evaluate("!!document.querySelector('.download-overview')"),false)
 await evaluate("document.querySelector('.download-settings-trigger').click()")
 await until("!!document.querySelector('.download-settings-dialog')")
 assert.equal(await evaluate("!!document.querySelector('.download-concurrency')"),false)
 const border=await evaluate("(()=>{const s=getComputedStyle(document.querySelector('.download-settings-dialog [role=switch]'));return [s.borderTopWidth,s.borderBottomWidth]})()")
 assert.deepEqual(border,['1px','1px'])
 assert.equal(await evaluate("Number(document.querySelector('.download-speed-field input').value)"),downloads.limit)
 assert.equal(await evaluate("document.querySelector('.download-settings-dialog [role=switch]').getAttribute('aria-checked')"),String(downloads.pause))
 assert.ok(await evaluate("parseFloat(getComputedStyle(document.querySelector('.download-resume-note')).fontSize)>=13"))
 await evaluate("document.querySelector('.download-speed-field input').focus()")
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.download-speed-field input')).outlineStyle"),'none')
 const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
 writeFileSync('build/qa-refined-final-portable.png',Buffer.from(screenshot.data,'base64'))
 await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape'});await until("!document.querySelector('.download-settings-dialog')")
 assert.equal(await evaluate("document.activeElement.classList.contains('download-settings-trigger')"),true)
 assert.ok(await evaluate("window.launcher.getModFavorites().then(items=>Array.isArray(items))"))
 assert.equal(await evaluate("window.launcher.getState().then(s=>JSON.stringify(s.settings))"),before)
 assert.deepEqual(errors,[])
 writeFileSync('build/qa-refined-final-portable.json',JSON.stringify({passed:true,window:tab.title,renderer:true,automaticConcurrency:true,settingsBorderAndFocus:true,readOnly:true,preferencesPreserved:true,exceptions:errors},null,2))
 console.log('PASS final portable EXE opens; refreshed downloads UI, readable settings, complete borders, clean input focus and automatic concurrency work; existing preferences preserved; no renderer exceptions')
 await evaluate("document.querySelector('.side-nav button:has(.lucide-house)').click()")
 await evaluate("setTimeout(()=>window.launcher.windowAction('close'),100);true");await wait(200)
}finally{socket.close()}
