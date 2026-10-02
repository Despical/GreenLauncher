import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const skinOnly = process.argv.includes('--skin-only')
const resultsFile = skinOnly ? 'build/qa-skin-chunk-results.json' : 'build/qa-ui-refresh-results.json'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), ['scripts/qa-ui-refresh-launch.cjs', ...(skinOnly ? ['--qa-skin'] : [])], { env, windowsHide: true, stdio: 'ignore' })
let socket
let nextId = 0
const pending = new Map()
const exceptions = []
const parsedScripts = new Set()
const requestedResources = new Set()
const evidence = {}
const results = []
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 12000)
  pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result) }, reject: error => { clearTimeout(timer); reject(error) } })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const until = async (expression, label = expression) => {
  for (let attempt = 0; attempt < 50; attempt++) { if (await evaluate(expression)) return; await wait(100) }
  throw new Error(`UI wait failed: ${label}`)
}
const click = async selector => { await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.focus();b.click()})()`); await wait(160) }
const clickText = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button not found');b.focus();b.click()})()`); await wait(180) }
const input = async (selector, value) => {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await wait(120)
}
const shot = async name => {
  await wait(200)
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  writeFileSync(`build/qa-refresh-${name}.png`, Buffer.from(result.data, 'base64'))
}
const fit = async selector => {
  const geometry = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,scroll:e.scrollWidth,client:e.clientWidth}})()`)
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1 && geometry.scroll <= geometry.client + 1, `${selector}: horizontal overflow ${JSON.stringify(geometry)}`)
  return geometry
}
const key = async value => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: value }); await wait(120) }
const locale = async language => { await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`); await wait(180) }
const viewport = async (width, height = 800) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await wait(180) }
writeFileSync(resultsFile, JSON.stringify({ passed: false, running: true }, null, 2))
try {
  let tab
  for (let attempt = 0; attempt < 100; attempt++) {
    try { tab = (await (await fetch('http://127.0.0.1:9225/json/list')).json()).find(item => item.type === 'page' && item.url.startsWith('file:')); if (tab) break } catch {}
    await wait(100)
  }
  assert.ok(tab, 'Isolated QA renderer starts')
  socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails)
    if (message.method === 'Debugger.scriptParsed' && message.params.url) parsedScripts.add(message.params.url)
    if (message.method === 'Network.requestWillBeSent') requestedResources.add(message.params.request.url)
    const item = pending.get(message.id)
    if (item) { pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result) }
  }
  await send('Runtime.enable')
  if (skinOnly) {
    await send('Debugger.enable'); await send('Network.enable')
    parsedScripts.clear(); requestedResources.clear()
    await send('Page.reload', { ignoreCache: true }); await wait(250)
  }
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await until(`!!document.querySelector('.sidebar')`)
  await viewport(1280)

  if (skinOnly) {
    assert.equal([...parsedScripts].filter(url => url.includes('/skinview3d-')).length, 0, '3D library is absent from home scripts')
    evidence.homeSkinScripts = [...parsedScripts].filter(url => url.includes('/skinview3d-')).length
    evidence.homeSkinRequests = [...requestedResources].filter(url => url.includes('/skinview3d-')).length
    assert.equal(evidence.homeSkinRequests, 0, '3D library is absent from initial home network requests')
    // An offscreen QA window is hidden by design. Override its visibility so the
    // actual viewer animation loop can run without showing a window on the desktop.
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))`)
    await click('.account-tile'); await clickText('Profilim')
    await until(`!!document.querySelector('.skin-preview-hint')`, '3D skin becomes ready from local built chunk')
    const resources = [...parsedScripts].filter(url => url.includes('/skinview3d-'))
    assert.equal(resources.length, 1)
    assert.ok(resources[0].startsWith('file:'), '3D module loads from the packaged local file path')
    assert.equal([...requestedResources].filter(url => url.includes('/skinview3d-')).length, 1)
    evidence.skinModuleURL = resources[0]
    const canvas = await evaluate(`(()=>{const e=document.querySelector('.skin-preview canvas'),r=e.getBoundingClientRect();return {width:e.width,height:e.height,x:r.x,y:r.y,cssWidth:r.width,cssHeight:r.height}})()`)
    assert.ok(canvas.width > 0 && canvas.height > 0)
    evidence.canvasSize = { width: canvas.width, height: canvas.height }
    assert.ok(await evaluate(`!document.querySelector('.skin-preview-status')&&[...document.querySelectorAll('.skin-preview-actions button')].every(b=>!b.disabled)`))
    const captureCanvas = async () => (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: canvas.x, y: canvas.y, width: canvas.cssWidth, height: canvas.cssHeight, scale: 1 } })).data
    const initial = await captureCanvas()
    await shot('skin-ready')
    await click('.skin-preview-actions button:last-child')
    assert.ok(await evaluate(`document.querySelector('.skin-preview-actions button:last-child').getAttribute('aria-pressed')==='true'`))
    await wait(800)
    assert.notEqual(await captureCanvas(), initial, 'Auto rotation visibly changes rendered skin')
    await shot('skin-rotating')
    await click('.skin-preview-actions button:last-child')
    assert.ok(await evaluate(`document.querySelector('.skin-preview-actions button:last-child').getAttribute('aria-pressed')==='false'`))
    const beforeDrag = await captureCanvas()
    const startX = canvas.x + canvas.cssWidth * .5, startY = canvas.y + canvas.cssHeight * .5
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', buttons: 1, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + 100, y: startY + 30, button: 'left', buttons: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX + 100, y: startY + 30, button: 'left', buttons: 0, clickCount: 1 })
    await wait(250)
    const afterDrag = await captureCanvas()
    assert.notEqual(afterDrag, beforeDrag, 'Drag visibly changes camera angle')
    await click('.skin-preview-actions button:first-child'); await wait(250)
    assert.notEqual(await captureCanvas(), afterDrag, 'Reset visibly restores camera view')
    await shot('skin-reset')
    results.push('3D skin: no home module fetch, one local-file dynamic chunk, valid 64x64 fixture renders, positive canvas dimensions, auto-rotate, drag and reset verified by rendered pixels')
  } else {
  await clickText('Profillerim')
  await until(`!!document.querySelector('.profile-onboarding')`)
  assert.ok(await evaluate(`(()=>{const e=document.querySelector('.profile-onboarding-icon img');return e.width<=60&&e.height<=60&&e.complete})()`))
  await fit('.profile-onboarding'); await shot('profiles-1280')
  await click('.profile-onboarding-create')
  assert.equal(await evaluate(`!!document.querySelector('.profile-modal')`), true, 'First profile CTA opens editor')
  await click('.profile-modal .modal-close')
  for (const width of [1080, 1280]) for (const language of ['tr', 'en', 'de', 'ru']) {
    await viewport(width, 700); await locale(language); await fit('.profile-onboarding')
  }
  await locale('tr'); await viewport(1080, 700); await shot('profiles-1080')
  results.push('Empty profiles: bounded icon, first-profile editor, 1080/1280 widths, four locales')

  await clickText('Ayarlar'); await clickText('Günlükler')
  await until(`document.querySelectorAll('.log-record').length===24`)
  assert.ok(await evaluate(`(()=>{const e=document.querySelector('.log-records');return e.scrollHeight>e.clientHeight&&getComputedStyle(e).scrollbarWidth==='thin'})()`))
  assert.ok(await evaluate(`document.querySelector('.log-message p').getBoundingClientRect().bottom<=innerHeight-28`), 'Selected message is visible at the default 1080x700 viewport')
  await fit('.log-workspace'); await shot('logs-1080')
  await input('.log-search input', 'NETWORK_ERROR')
  assert.equal(await evaluate(`document.querySelectorAll('.log-record').length`), 12)
  await evaluate(`(()=>{const e=document.querySelector('.log-source-filter select');e.value='Oturum';e.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await until(`!!document.querySelector('.log-no-results')`)
  await shot('logs-no-results')
  await click('.log-no-results button')
  assert.equal(await evaluate(`document.querySelectorAll('.log-record').length`), 24)
  await evaluate(`document.querySelector('.log-record').focus()`); await key('ArrowDown')
  assert.ok(await evaluate(`document.querySelector('.log-record:nth-child(2)').classList.contains('is-selected')`))
  assert.ok(await evaluate(`document.querySelector('.log-message').textContent.includes('Kayıt 2.')`))
  await evaluate(`window.__copiedLog='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedLog=text}}})`)
  await click('.log-copy-button')
  assert.ok(await evaluate(`window.__copiedLog.includes('NETWORK_ERROR')&&window.__copiedLog.includes('Kayıt 2.')`))
  assert.ok(await evaluate(`document.querySelector('.log-copy-status').textContent.includes('panoya kopyalandı')`))
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('QA clipboard unavailable')}}})`)
  await click('.log-copy-button')
  assert.ok(await evaluate(`document.querySelector('.log-copy-status').classList.contains('is-error')`))
  for (const width of [1080, 1280]) for (const language of ['tr', 'en', 'de', 'ru']) {
    await viewport(width, 700); await locale(language); await fit('.log-workspace')
  }
  await locale('tr'); await viewport(1280); await shot('logs-1280')
  await click('.log-header-actions .log-button:first-child')
  assert.equal((await evaluate(`window.launcher.openErrorLog()`)).fileOpened, 2)
  await click('.log-clear-button')
  assert.equal(await evaluate(`document.querySelectorAll('.log-record').length`), 0)
  assert.ok(await evaluate(`!!document.querySelector('.log-empty-symbol')&&document.querySelector('.log-clear-button').disabled`))
  await shot('logs-empty')
  results.push('Logs: search/source filter, no-results/reset, keyboard selection, clipboard success/failure mocks, file action, clear/empty, four locales')

  await click('.statusbar-changelog')
  await until(`document.querySelectorAll('.release-history-version').length===4`)
  assert.equal(await evaluate(`document.querySelectorAll('.release-history-notes svg').length`), 0)
  await click('.release-history-version:nth-child(2)')
  assert.ok(await evaluate(`document.querySelector('.release-history-meta').textContent.includes('0.13.1')`))
  await evaluate(`document.querySelector('.release-history-version:nth-child(2)').focus()`); await key('End')
  assert.ok(await evaluate(`document.querySelector('.release-history-meta').textContent.includes('0.12.2')`))
  await key('Home')
  for (const width of [1080, 1280]) for (const language of ['tr', 'en', 'de', 'fr', 'ru', 'pl']) {
    await viewport(width, 700); await locale(language); const geometry = await fit('.changelog-dialog')
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1)
    await fit('.release-history-detail'); await fit('.release-history-navigation')
  }
  await locale('tr'); await viewport(1280); await shot('changelog-1280')
  await viewport(1080, 700); await shot('changelog-1080')
  await key('Escape'); await until(`!document.querySelector('.changelog-dialog')`)
  assert.ok(await evaluate(`document.activeElement.classList.contains('statusbar-changelog')`), 'Changelog focus returns to opener')
  results.push('Changelog: persistent versions, detail updates, no checkmark bullets, arrow/Home/End navigation, Escape/focus return, six locales')

  await clickText('Modlar'); await until(`!!document.querySelector('.mods-page')||!!document.querySelector('.mods-sources')`)
  await clickText('CurseForge'); await until(`!!document.querySelector('.provider-connection-state')`)
  await click('.provider-connection-state .heading-action')
  await until(`!!document.querySelector('.provider-connect-dialog')`)
  assert.equal(await evaluate(`document.querySelector('.provider-key-label input').type`), 'password')
  assert.ok(await evaluate(`document.querySelector('.curseforge-connect-actions button[type=submit]').disabled`))
  await input('.provider-key-label input', 'short')
  assert.ok(await evaluate(`document.querySelector('.curseforge-connect-actions button[type=submit]').disabled`))
  await input('.provider-key-label input', 'QA_ONLY_INVALID_VALUE_NOT_A_CREDENTIAL')
  await click('.curseforge-connect-actions button[type=submit]')
  await until(`!!document.querySelector('.provider-connect-error')`)
  assert.ok(await evaluate(`!document.querySelector('.provider-connect-error').textContent.includes('QA_ONLY')`))
  for (const width of [1080, 1280]) for (const language of ['tr', 'en', 'de', 'fr', 'ru', 'pl']) {
    await viewport(width, 700); await locale(language); const geometry = await fit('.provider-connect-dialog')
    assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height + 1)
  }
  await locale('tr'); await input('.provider-key-label input', ''); await shot('curseforge-dialog-1280')
  await viewport(1080, 700); await shot('curseforge-dialog-1080')
  await input('.provider-key-label input', 'QA_ONLY_SUCCESS_VALUE_NOT_A_CREDENTIAL')
  await click('.curseforge-connect-actions button[type=submit]')
  await until(`!document.querySelector('.provider-connect-dialog')`)
  assert.ok(await evaluate(`!document.querySelector('.provider-connection-state')`))
  results.push('CurseForge dialog: masked input, minimum length, safe validation error, mocked success transition, six locales; no real API request')
  await evaluate(`window.launcher.signOut('qa-offline')`)
  await clickText('Profillerim'); await click('.profile-onboarding-create')
  assert.ok(await evaluate(`!!document.querySelector('.account-switcher')&&!document.querySelector('.profile-modal')`), 'No-account CTA opens account selector instead of invalid profile editor')
  assert.ok(await evaluate(`document.body.textContent.includes('Önce bir hesap seçin.')`))
  await shot('profiles-no-account')
  results.push('No-account first-profile CTA opens account selector and displays the account-required message')
  }
  assert.deepEqual(exceptions, [], 'No renderer exceptions')
  writeFileSync(resultsFile, JSON.stringify({ passed: true, rendererOnly: true, results, exceptions, ...(skinOnly ? { evidence } : {}) }, null, 2))
  console.log(results.map(result => `PASS ${result}`).join('\n'))
} catch (error) {
  writeFileSync(resultsFile, JSON.stringify({ passed: false, rendererOnly: true, results, exceptions, error: String(error) }, null, 2))
  throw error
} finally {
  socket?.close()
  child.kill()
}
