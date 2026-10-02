import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let tab
for (let i = 0; i < 100; i++) { try { tab = (await (await fetch('http://127.0.0.1:9225/json/list')).json()).find(item => item.type === 'page'); if (tab) break } catch {} await wait(100) }
const socket = new WebSocket(tab.webSocketDebuggerUrl)
await new Promise(resolve => socket.onopen = resolve)
let id = 0
const pending = new Map(), errors = []
socket.onmessage = event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params); const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result) } }
const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })) })
const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await wait(60) } throw Error(expression) }
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await wait(120) }
const nav = async text => { await evaluate(`[...document.querySelectorAll('.side-nav button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`); await wait(180) }
const shot = async name => { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); writeFileSync(`build/${name}.png`, Buffer.from(result.data, 'base64')) }
const input = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`)
try {
  await send('Runtime.enable')
  await until("!!document.querySelector('.launch-controls')")
  await click('.launch-field:last-child .dropdown-trigger')
  const gaps = await evaluate("(()=>{const menu=document.querySelector('.launch-field:last-child .dropdown-menu').getBoundingClientRect(),option=document.querySelector('.launch-field:last-child [aria-selected=true]').getBoundingClientRect();return {left:option.left-menu.left,right:menu.right-option.right}})()")
  assert.ok(Math.abs(gaps.left - gaps.right) < .5, JSON.stringify(gaps))
  await shot('qa-features-home-dropdown')
  await nav('Sürümler')
  const centering = await evaluate("(()=>{const b=document.querySelector('.release-link').getBoundingClientRect(),s=document.querySelector('.release-link svg').getBoundingClientRect();return {x:b.x+b.width/2-s.x-s.width/2,y:b.y+b.height/2-s.y-s.height/2}})()")
  assert.ok(Math.abs(centering.x) < .5 && Math.abs(centering.y) < .5, JSON.stringify(centering))
  await nav('Modlar'); await until("!!document.querySelector('.mods-source-nav')")
  await click('.mods-source-nav button:nth-of-type(2)')
  await until("!!document.querySelector('.mods-favorite')")
  assert.equal(await evaluate("document.querySelector('.mods-detail-actions').textContent.includes('Proje sayfası')"), false)
  await click('.mods-project-link')
  assert.equal(await evaluate("window.launcher.openExternal('https://modrinth.com/qa').then(result=>result.externalOpened.includes('https://modrinth.com/mod/qa-project'))"), true)
  await click('.mods-favorite'); assert.equal(await evaluate("document.querySelector('.mods-favorite').getAttribute('aria-pressed')"), 'true')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.mods-favorite svg')).animationName"), 'favorite-fill')
  await shot('qa-features-mod-favorite')
  await click('.mods-type-tabs button:last-child'); await until("!!document.querySelector('.mods-favorite')")
  assert.equal(await evaluate("document.querySelectorAll('.mods-hit').length"), 1)
  await send('Page.reload'); await until("!!document.querySelector('.side-nav')"); await nav('Modlar'); await until("!!document.querySelector('.mods-source-nav')"); await click('.mods-source-nav button:nth-of-type(2)'); await until("!!document.querySelector('.mods-favorite')"); assert.equal(await evaluate("document.querySelector('.mods-favorite').getAttribute('aria-pressed')"), 'true')
  await click('.mods-type-tabs button:nth-child(2)'); await until("document.querySelector('.mods-detail-title h3')?.textContent==='World Explorer Pack'")
  await click('.mods-favorite'); await click('.mods-type-tabs button:last-child'); await until("document.querySelectorAll('.mods-hit').length===2")
  await shot('qa-features-modrinth-favorites')
  await click('.mods-source-nav button:nth-of-type(4)'); await until("document.querySelector('.mods-detail-title h3')?.textContent==='Technic Adventure'")
  assert.equal(await evaluate("document.querySelector('.mods-type-tabs button:first-child').textContent"), 'Mod paketleri')
  await click('.mods-favorite'); await click('.mods-type-tabs button:last-child'); await until("document.querySelector('.mods-favorite')?.getAttribute('aria-pressed')==='true'")
  await shot('qa-features-technic-favorites')
  await click('.mods-favorite'); await until("document.querySelectorAll('.mods-hit').length===0")
  assert.match(await evaluate("document.querySelector('.mods-favorites-empty').textContent"), /Henüz favorin yok/)
  await nav('İndirmeler'); await until("document.querySelectorAll('.download-job').length===2")
  await shot('qa-features-downloads')
  await click('.download-job-actions button:first-child'); await until("!!document.querySelector('.download-job.paused')")
  await click('.download-job.paused .download-job-actions button:first-child'); await until("!document.querySelector('.download-job.paused')")
  await click('.download-job.queued .download-to-top'); assert.equal(await evaluate("window.launcher.getDownloads().then(d=>d.jobs.find(j=>j.phase==='queued').priority)"),101)
  await click('.download-settings-trigger')
  assert.equal(await evaluate("document.querySelector('.download-settings-dialog [role=switch]').getAttribute('aria-checked')"), 'false')
  await input('.download-speed-field input', '1.5'); await click('.download-settings-dialog [role=switch]')
  await shot('qa-features-download-settings')
  await click('.download-settings-dialog .modal-actions button:last-child'); await until("!document.querySelector('.download-settings-dialog')")
  const config = await evaluate("window.launcher.getState().then(state=>({limit:state.settings.downloadSpeedLimitKiB,pause:state.settings.pauseDownloadsWhilePlaying}))")
  assert.deepEqual(config, { limit: 1536, pause: true })
  const locales = []
  for (const width of [1080, 1280]) for (const language of ['tr', 'en', 'de', 'fr', 'ru', 'pl']) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false })
    await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`); await wait(100)
    await click('.download-settings-trigger')
    const fit = await evaluate("(()=>{const e=document.querySelector('.download-settings-dialog'),r=e.getBoundingClientRect();return {overflow:e.scrollWidth-e.clientWidth,inView:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,body:document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth}})()")
    assert.ok(fit.overflow <= 1 && fit.inView && fit.body, JSON.stringify({ width, language, fit }))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' }); await until("!document.querySelector('.download-settings-dialog')")
    assert.equal(await evaluate("document.activeElement.classList.contains('download-settings-trigger')"), true)
    locales.push({ width, language })
  }
  await evaluate("window.launcher.saveSettings({language:'tr'})")
  await send('Emulation.clearDeviceMetricsOverride'); await wait(150)
  await nav('Ana Sayfa'); await click('.account-tile'); await click('.account-switcher-action'); await until("!!document.querySelector('.skin-preview-actions button:not(:disabled)')"); await click('#capes-tab'); await click('.cape-card:nth-child(2)'); await click('.cape-view-switch button:last-child'); await wait(450)
  const resolution = await evaluate("(()=>{const canvas=document.querySelector('.skin-preview-stage canvas'),r=canvas.getBoundingClientRect();return {ratioX:canvas.width/r.width,ratioY:canvas.height/r.height}})()")
  assert.ok(resolution.ratioX >= 1.99 && resolution.ratioY >= 1.99)
  await shot('qa-features-elytra')
  assert.deepEqual(errors, [])
  writeFileSync('build/qa-features-results.json', JSON.stringify({ passed: true, gaps, centering, config, resolution, locales, favorites: 'Modrinth mod and pack, reload, Technic save and removal', downloads: 'pause, resume, prioritize and settings' }, null, 2))
  console.log('PASS favorites, links, centering, dropdown symmetry, downloads controls, persistent settings, 12 locale/width layouts and 2x Elytra rendering')
} finally { socket.close() }
