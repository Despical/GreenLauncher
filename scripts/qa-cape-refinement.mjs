import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
const wait=ms=>new Promise(r=>setTimeout(r,ms))
const tabs=await(await fetch('http://127.0.0.1:9225/json/list')).json()
const socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
await new Promise(r=>socket.onopen=r)
let id=0;const pending=new Map();const errors=[]
socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}))})
const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(100)}throw Error(expression)}
const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait(450)}
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`build/${name}.png`,Buffer.from(r.data,'base64'))}
const orientation=()=>evaluate(`({relative:Math.cos(window.qaViewer.playerWrapper.rotation.y-window.qaViewer.controls.getAzimuthalAngle()),polar:window.qaViewer.controls.getPolarAngle(),auto:window.qaViewer.autoRotate})`)
const drag=async(dx,dy=0)=>{const p=await evaluate(`(()=>{const r=document.querySelector('.skin-preview-stage canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+dx*i/8,y:p.y+dy*i/8,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1});await wait(150)}
try{
 await send('Runtime.enable');await send('Page.reload');await wait(250)
 await until("!!document.querySelector('.account-tile')")
 await click('.account-tile');await click('.account-switcher-action')
 await until("!!document.querySelector('.skin-preview-actions button:not(:disabled)')")
 await shot('qa-cape-refine-account')
 await click('#capes-tab')
 await until("document.querySelectorAll('.cape-card').length===4")
 await evaluate(`(()=>{const e=document.querySelector('.skin-preview-stage canvas');let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber'))];while(f){for(let h=f.memoizedState;h;h=h.next){if(h.memoizedState?.current?.playerWrapper){window.qaViewer=h.memoizedState.current;return true}}f=f.return}throw Error('viewer missing')})()`)
 await click('.cape-card:nth-child(2)')
 await click('.cape-apply-button')
 if(await evaluate("!!document.querySelector('.toast button')"))await click('.toast button')
 assert.ok((await orientation()).relative < -.999)
 for(const [dx,dy] of [[110,30],[-170,-60],[55,95]]){
  await click('.skin-preview-actions button:first-child');assert.ok((await orientation()).relative>.999,'flip to front')
  await drag(dx,dy)
  await click('.cape-card:nth-child(3)');let pose=await orientation();assert.ok(pose.relative<-.999,'cape faces camera after dragging');assert.ok(Math.abs(pose.polar-Math.PI/2)<.001)
  await click('.skin-preview-actions button:first-child');assert.ok((await orientation()).relative>.999)
  await click('.skin-preview-actions button:first-child');assert.ok((await orientation()).relative<-.999)
 }
 await click('.skin-preview-actions button:last-child');assert.equal((await orientation()).auto,true)
 await click('.cape-view-switch button:last-child');assert.equal((await orientation()).auto,false);assert.ok((await orientation()).relative<-.999)
 await click('.cape-view-switch button:first-child')
 await shot('qa-cape-refine-capes')
 await click('.cape-apply-button')
 assert.match(await evaluate("document.querySelector('.toast')?.textContent??''"),/Pelerin Minecraft hesabında güncellendi/)
 assert.equal(await evaluate("document.querySelector('.cape-card:nth-child(3) small')?.textContent"),'Etkin')
 assert.equal(await evaluate("document.querySelector('.cape-apply-button').disabled"),true)
 await shot('qa-cape-refine-toast')
 await evaluate("window.qaToast=document.querySelector('.toast');true")
 await click('.cape-card:nth-child(4)');assert.equal(await evaluate("document.querySelector('.cape-apply-button').disabled"),true)
 await click('.cape-card:first-child');assert.ok((await orientation()).relative>.999)
 assert.equal(await evaluate("!!document.querySelector('.cape-preview-toolbar')"),false)
 await click('.cape-apply-button');assert.equal(await evaluate("document.querySelector('.cape-card:first-child small')?.textContent"),'Etkin')
 assert.equal(await evaluate("document.querySelector('.toast')===window.qaToast"),false,'Repeated success restarts toast')
 await evaluate("document.querySelectorAll('.cape-card')[1].click();document.querySelectorAll('.cape-card')[2].click();document.querySelectorAll('.cape-card')[1].click()");await wait(450);assert.ok((await orientation()).relative<-.999,'rapid cape changes')
 await evaluate("document.querySelector('.skin-preview-actions button:first-child').click()");await wait(80);await drag(90,15);const interrupted=await evaluate("window.qaViewer.playerWrapper.rotation.y");await wait(450);assert.equal(await evaluate("window.qaViewer.playerWrapper.rotation.y"),interrupted,'Dragging cancels automatic turn')
 await click('.cape-card:nth-child(2)');assert.ok((await orientation()).relative<-.999,'Selection after interrupted turn')
 const layouts=[]
 for(const width of [1080,1280])for(const language of ['tr','en','de','fr','ru','pl']){
  await send('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
  await evaluate(`window.launcher.saveSettings({language:'${language}'})`);await wait(120)
  await click('.cape-card:nth-child(2)')
  const fit=await evaluate(`(()=>{const bad=[...document.querySelectorAll('.skin-preview-actions button,.cape-view-switch button,.cape-apply-button,.account-section-heading,.account-page-details')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>({class:e.className,text:e.textContent}));const a=document.querySelector('.cape-preview-toolbar').getBoundingClientRect(),b=document.querySelector('.skin-preview-stage').getBoundingClientRect();return {bad,inStage:a.left>=b.left&&a.right<=b.right,info:!!document.querySelector('.cape-info'),label:document.querySelector('#capes-panel').textContent.includes('Görünüm türü')}})()`)
  assert.deepEqual(fit.bad,[],`${width} ${language}`);assert.ok(fit.inStage);assert.equal(fit.info,false);assert.equal(fit.label,false);layouts.push({width,language})
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await wait(120)
 await send('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false});await wait(200);await shot('qa-cape-refine-minimum')
 assert.deepEqual(errors,[])
 writeFileSync('build/qa-cape-refine-results.json',JSON.stringify({passed:true,rotation:'drag, repeated selection, alternating faces, auto-rotation and elytra',apply:'success toast, active status, OptiFine disabled, cape removal',layouts},null,2))
 console.log('PASS orientation after actual pointer drags; front/back toggles; auto rotation; elytra; account update toast; removal; 12 locale/width layouts')
}finally{socket.close()}
