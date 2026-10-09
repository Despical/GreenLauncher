// Owns an offscreen Electron fixture and its synthetic screenshot files.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const port = 9261, origin = `http://127.0.0.1:${port}`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let fixture, socket, id = 0, timer
const pending = new Map(), output = [], errors = []
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const key = ++id, timeout = setTimeout(() => { pending.delete(key); reject(Error(`CDP timed out: ${method}`)) }, 10_000)
  pending.set(key, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: key, method, params }))
})
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const until = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(`!!(${expression})`)) return; await pause(60) } throw Error(`Timeout: ${expression}`) }
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(100) }
const input = async value => { await evaluate(`(()=>{const e=document.querySelector('.screenshot-name-field input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`); await pause(50) }
const shot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`build/${name}.png`, Buffer.from(result.data, 'base64')) }
const gallery = async () => {
  await until("document.querySelector('.launch-profile-edit')")
  await click('.launch-profile-edit')
  await until("document.querySelector('.profile-workspace-nav')")
  await click('[data-profile-page=profile-analytics] + button')
  await until("document.querySelectorAll('.screenshot-card').length===2")
}
const open = async () => {
  await evaluate("document.querySelector('.screenshot-card').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:innerWidth-12,clientY:innerHeight-35}))")
  await until("document.querySelector('.screenshot-context-menu')")
  assert.equal(await evaluate("(()=>{const r=document.querySelector('.screenshot-context-menu').getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight})()"), true, 'Context menu fits at the window edge')
  await click('.screenshot-context-menu button:nth-of-type(3)')
  await until("document.querySelector('.screenshot-rename-dialog')")
  assert.equal(await evaluate("!!document.querySelector('.screenshot-context-menu')"), false)
}
try {
  let occupied = false
  try { occupied = (await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(500) })).ok } catch {}
  assert.equal(occupied, false, 'Isolated QA port is already occupied')
  fixture = spawn(resolve('node_modules/electron/dist/electron.exe'), ['scripts/qa-ui-refresh-launch.cjs', '--qa-content', '--qa-skin', '--qa-screenshot-rename'], { windowsHide: true, env: { ...process.env, GREEN_QA_DEBUG_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  fixture.stdout.on('data', chunk => output.push(String(chunk))); fixture.stderr.on('data', chunk => output.push(String(chunk)))
  timer = setTimeout(() => { fixture.kill(); console.error('Screenshot rename QA watchdog expired'); process.exit(1) }, 180_000)
  let tab
  for (let n = 0; n < 100; n++) {
    try { tab = (await (await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(500) })).json()).find(item => item.type === 'page'); if (tab) break } catch {}
    if (fixture.exitCode !== null) throw Error(output.join(''))
    await pause(100)
  }
  assert.ok(tab, 'Isolated renderer did not start')
  socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails)
    const task = pending.get(data.id)
    if (task) { clearTimeout(task.timeout); pending.delete(data.id); data.error ? task.reject(Error(data.error.message)) : task.resolve(data.result) }
  }
  await call('Runtime.enable'); await until("document.querySelector('.side-nav')")
  await gallery()
  const fixtureRoot = await evaluate('window.launcher.getState().then(s=>s.dataPath)')
  assert.ok(resolve(fixtureRoot).startsWith(resolve('build') + '\\'), 'Fixture files stay in the owned QA build directory')
  const directory = join(fixtureRoot, 'profiles', 'qa-profile', 'screenshots')
  const original = readFileSync(join(directory, 'QA screenshot.png'))
  await open(); await pause(80)
  assert.equal(await evaluate("document.activeElement===document.querySelector('.screenshot-name-field input')"), true)
  assert.equal(await evaluate("document.querySelector('.screenshot-name-field input').selectionEnd"), 'QA screenshot'.length)
  await shot('qa-screenshot-rename-dialog')
  await input('Yeni görüntü.png'); await click('.screenshot-rename-dialog .modal-primary')
  await until("!document.querySelector('.screenshot-rename-dialog')")
  assert.equal(await evaluate("document.querySelector('.screenshot-open strong').textContent"), 'Yeni görüntü.png')
  assert.equal(await evaluate("document.querySelector('.toast').textContent.includes('Ekran görüntüsü yeniden adlandırıldı.')"), true)
  assert.deepEqual(readFileSync(join(directory, 'Yeni görüntü.png')), original)
  await click('.screenshot-open'); await until("document.querySelector('.screenshot-viewer img')?.naturalWidth===64")
  await click('.screenshot-viewer button')
  await open(); await input('existing.png'); await click('.screenshot-rename-dialog .modal-primary')
  await until("document.querySelector('.screenshot-rename-error')")
  assert.equal(await evaluate("document.querySelector('.screenshot-rename-error').textContent"), 'Bu adla bir dosya zaten var.')
  await input('../escape.png'); await click('.screenshot-rename-dialog .modal-primary')
  assert.equal(await evaluate("document.querySelector('.screenshot-rename-error').textContent.includes('Geçerli bir dosya adı')"), true)
  await input('Yeni görüntü.jpg'); await click('.screenshot-rename-dialog .modal-primary')
  await until("document.querySelector('.screenshot-extension-confirm')")
  assert.equal(await evaluate("document.querySelectorAll('[aria-modal=true]').length"), 1, 'Extension confirmation stays inside the existing dialog')
  assert.equal(await evaluate("window.launcher.getState().then(s=>s.qaScreenshotRenames.length)"), 1, 'First Save does not rename a changed extension')
  await shot('qa-screenshot-rename-extension-confirm')
  await click('.screenshot-extension-confirm .secondary'); await until("!document.querySelector('.screenshot-extension-confirm')")
  assert.deepEqual(readFileSync(join(directory, 'Yeni görüntü.png')), original)
  await click('.screenshot-rename-dialog .modal-primary'); await click('.screenshot-extension-confirm .modal-primary')
  await until("!document.querySelector('.screenshot-rename-dialog')")
  assert.equal(await evaluate("document.querySelector('.screenshot-open strong').textContent"), 'Yeni görüntü.jpg')
  assert.deepEqual(readFileSync(join(directory, 'Yeni görüntü.jpg')), original)
  await click('.screenshot-open'); await until("document.querySelector('.screenshot-viewer img')?.naturalWidth===64"); await click('.screenshot-viewer button')
  for (const language of ['tr', 'en', 'de', 'fr', 'ru', 'pl']) {
    await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`)
    await call('Page.reload'); await gallery()
    await open()
    assert.equal(await evaluate("document.querySelector('.screenshot-rename-dialog h2').textContent"), { tr: 'Ekran görüntüsünü yeniden adlandır', en: 'Rename screenshot', de: 'Screenshot umbenennen', fr: 'Renommer la capture', ru: 'Переименовать снимок экрана', pl: 'Zmień nazwę zrzutu ekranu' }[language])
    await input('Test.png'); await click('.screenshot-rename-dialog .modal-primary')
    for (const [width, height] of [[1080, 700], [1280, 800]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate("(()=>{const e=document.querySelector('.screenshot-rename-dialog'),r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()"), true, `${language}: popup stays readable inside the window`)
      assert.equal(await evaluate("document.querySelectorAll('[aria-modal=true]').length"), 1)
    }
    await click('.screenshot-rename-dialog .modal-close')
  }
  await evaluate("window.launcher.saveSettings({language:'tr'})")
  await call('Page.reload'); await gallery()
  await open(); await input('Görüntü.txt'); await click('.screenshot-rename-dialog .modal-primary'); await click('.screenshot-extension-confirm .modal-primary')
  await until("document.querySelectorAll('.screenshot-card').length===1")
  assert.deepEqual(readFileSync(join(directory, 'Görüntü.txt')), original, 'Unsupported extension keeps the file and its bytes')
  assert.equal(await evaluate("document.querySelector('.toast').textContent.includes('yeniden adlandırıldı')"), true)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS real screenshot rename IPC and bytes, context menu, selected file stem, updated gallery/viewer, success toast, collision/path errors, inline extension confirmation/cancel/save, six languages and 1080/1280 layouts')
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) { try { await shot('qa-screenshot-rename-failure') } catch {} }
  console.error(output.join('').slice(-2000)); throw error
} finally {
  clearTimeout(timer)
  if (socket?.readyState === WebSocket.OPEN) { try { await evaluate("window.launcher.windowAction('close')") } catch {} socket.close() }
  for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(Error('QA finished')) }
  if (fixture && fixture.exitCode === null) { await pause(200); if (fixture.exitCode === null) fixture.kill() }
}
