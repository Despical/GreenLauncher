import { writeFileSync } from 'node:fs'
const tabs = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const tab = tabs.find(t => t.title === 'Green Launcher')
if (!tab) throw Error('QA window not found')
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let id = 0
const waiting = new Map()
socket.onmessage = event => { const data = JSON.parse(event.data); const p = waiting.get(data.id); if (p) { waiting.delete(data.id); data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result) } }
export const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; waiting.set(key,{resolve,reject}); socket.send(JSON.stringify({id:key,method,params})) })
export const evaluate = async expression => { const result = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue:true}); if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
export const shot = async name => { await new Promise(r=>setTimeout(r,300)); const result = await send('Page.captureScreenshot',{format:'png',fromSurface:false,captureBeyondViewport:false}); writeFileSync(`build/${name}.png`,Buffer.from(result.data,'base64')) }
export const close = () => socket.close()
if (process.argv[1]?.endsWith('qa-accounts-cdp.mjs')) { if(process.argv[2]) console.log(JSON.stringify(await evaluate(process.argv[2]))); if(process.argv[3]) await shot(process.argv[3]); close() }
