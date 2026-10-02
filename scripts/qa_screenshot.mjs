import { writeFileSync } from 'node:fs'

const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const tab = tabs.find(item => item.type === 'page' && item.title === 'Green Launcher') ?? tabs.find(item => item.type === 'page')
if (!tab) throw new Error('Launcher penceresi bulunamadı')
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let nextId = 0
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const onMessage = event => {
      const data = JSON.parse(event.data)
      if (data.id !== id) return
      socket.removeEventListener('message', onMessage)
      if (data.error) reject(new Error(data.error.message))
      else resolve(data.result)
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({ id, method, params }))
  })
}
if (process.argv[2]) {
  const evaluation = await send('Runtime.evaluate', { expression: process.argv[2], awaitPromise: true, returnByValue: true })
  if (evaluation.result?.value !== undefined) console.log(JSON.stringify(evaluation.result.value))
}
await new Promise(resolve => setTimeout(resolve, 500))
const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const path = process.argv[3] ?? 'build/qa-screen.png'
writeFileSync(path, Buffer.from(result.data, 'base64'))
console.log(path)
socket.close()
