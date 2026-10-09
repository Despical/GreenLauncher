// Starts its own hidden renderer fixture and shuts it down. All account/profile
// data is synthetic; the real launcher and its persistent files are never loaded.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const port = 9256, origin = `http://127.0.0.1:${port}`
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let fixture, socket, id = 0, timer
const pending = new Map(), errors = [], output = []
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const key = ++id, timeout = setTimeout(() => { pending.delete(key); reject(Error(`CDP timed out: ${method}`)) }, 10_000)
  pending.set(key, { resolve, reject, timeout }); socket.send(JSON.stringify({ id: key, method, params }))
})
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const until = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(`!!(${expression})`)) return; await pause(70) } throw Error(`Timeout: ${expression}`) }
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await pause(120) }
const button = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('.analytics-page button')].find(b=>b.offsetParent&&b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing: '+${JSON.stringify(text)});b.click()})()`); await pause(120) }
const shot = async name => { await pause(150); const result = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`build/${name}.png`, Buffer.from(result.data, 'base64')) }
const metrics = () => evaluate("[...document.querySelector('.retained-page:not([hidden]) .analytics-page').querySelectorAll('.analytics-metric > strong')].map(e=>e.textContent)")
const hover = async (selector, index = 0) => {
  await evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].scrollIntoView({block:'center'})`)
  await pause(80)
  const point = await evaluate(`(()=>{const r=document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await until("document.querySelector('.analytics-tooltip')")
  const fits = await evaluate("(()=>{const r=document.querySelector('.analytics-tooltip').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()")
  assert.equal(fits, true, 'Hover tooltip fits inside the window')
}
try {
  let occupied = false
  try { occupied = (await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(500) })).ok } catch {}
  assert.equal(occupied, false, 'Isolated QA debug port is already in use')
  fixture = spawn(resolve('node_modules/electron/dist/electron.exe'), ['scripts/qa-ui-refresh-launch.cjs', '--qa-content', '--qa-running', '--qa-analytics'], { windowsHide: true, env: { ...process.env, GREEN_QA_DEBUG_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] })
  fixture.stdout.on('data', chunk => output.push(String(chunk))); fixture.stderr.on('data', chunk => output.push(String(chunk)))
  timer = setTimeout(() => { fixture.kill(); console.error('Analytics QA watchdog expired'); process.exit(1) }, 180_000)
  let tab
  for (let n = 0; n < 100; n++) {
    try { tab = (await (await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(500) })).json()).find(item => item.type === 'page'); if (tab) break } catch {}
    if (fixture.exitCode !== null) throw Error(output.join(''))
    await pause(100)
  }
  assert.ok(tab, 'Isolated Electron fixture did not start')
  socket = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails)
    const task = pending.get(data.id)
    if (task) { clearTimeout(task.timeout); pending.delete(data.id); data.error ? task.reject(Error(data.error.message)) : task.resolve(data.result) }
  }
  socket.onclose = () => { for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(Error('QA renderer closed')) } pending.clear() }
  await call('Runtime.enable'); await until("document.querySelector('.side-nav')")
  const stamp = new Date(), sessions = [], hour = 3_600_000
  const make = (id, days, hours, profileId = 'qa-profile') => {
    const start = new Date(stamp); start.setDate(start.getDate() - days); start.setHours(10, 0, 0, 0)
    if (days === 0) start.setTime(stamp.getTime() - (hours + 1) * hour)
    return { id, profileId, profileName: 'Historical name', versionId: '1.21.1-fabric', startedAt: start.toISOString(), endedAt: new Date(start.getTime() + hours * hour).toISOString(), durationMs: hours * hour }
  }
  for (let i = 1; i <= 12; i++) sessions.push(make(`history-${i}`, i, i % 3 + 1, i % 2 ? 'qa-profile' : 'qa-profile-1'))
  sessions.push(make('qa-instance-0', 0, 1), make('old', 130, 2), make('foreign', 1, 99, 'foreign-profile'))
  const save = values => evaluate(`window.launcher.saveSettings(${JSON.stringify(values)})`)
  await save({ language: 'tr', savePlaytime: true, qaPlaySessions: sessions, qaDownloads: [] })
  const owned = await evaluate('window.launcher.getState()')
  await evaluate(`window.launcher.saveProfile(${JSON.stringify({ ...owned.profiles[0], name: 'Hayatta kalma' })})`)
  await evaluate(`window.launcher.saveProfile(${JSON.stringify({ ...owned.profiles[1], name: 'Fabulously Optimized' })})`)
  await click('[data-page=analytics]'); await until("document.querySelector('.analytics-trend')")
  assert.deepEqual(await metrics(), ['25 sa 0 dk', '13', '13', '1 sa 55 dk'])
  assert.equal(await evaluate("document.querySelectorAll('.analytics-chart [role=button]').length"), 30)
  assert.equal(await evaluate("document.querySelectorAll('.analytics-ranking > button').length"), 2)
  assert.equal(await evaluate("document.querySelector('.analytics-page').textContent.includes('foreign')"), false)
  assert.equal(await evaluate("document.querySelectorAll('.analytics-session-row').length"), 8)
  assert.equal(await evaluate("document.querySelectorAll('.analytics-session-live').length"), 1)
  assert.equal(await evaluate("document.querySelectorAll('.analytics-calendar-grid button:not(:disabled)').length"), 365)
  assert.equal(await evaluate("document.querySelectorAll('.analytics-calendar-grid button').length"), 371)
  assert.equal(await evaluate("[...document.querySelectorAll('.analytics-calendar-grid button')].every(e=>getComputedStyle(e).visibility==='visible'&&e.getBoundingClientRect().width>0)"), true)
  assert.equal(await evaluate("document.querySelector('.analytics-calendar-footer > span').textContent"), '14 günde 27 sa 0 dk oynadın')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.analytics-session-row:last-child')).borderBottomWidth"), '1px')
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.analytics-streak')).color"), 'rgb(240, 164, 92)')
  assert.equal(await evaluate("!!document.querySelector('.analytics-calendar .analytics-panel-heading p')"), false)
  const zeroColors = await evaluate("[document.querySelector('.analytics-calendar-grid .outside'),document.querySelector('.analytics-calendar-grid button:not(:disabled)[data-level=\"0\"]')].map(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,border:s.borderColor,opacity:s.opacity}})")
  assert.deepEqual(zeroColors[0], zeroColors[1], 'Unplayed dates match the dark padding cells')
  assert.equal(await evaluate("(()=>{const p=document.querySelector('.analytics-footnote'),i=p.querySelector('svg').getBoundingClientRect(),s=p.querySelector('span'),r=s.getBoundingClientRect();return Math.abs(i.top+i.height/2-r.top-parseFloat(getComputedStyle(s).lineHeight)/2)<.6})()"), true, 'Info icon is centered on the first text line')
  assert.equal(await evaluate("!!document.querySelector('.analytics-chart-detail > strong,.analytics-calendar-summary')"), false)
  assert.equal(await evaluate("(()=>{const h=document.querySelector('.analytics-trend h3').getBoundingClientRect(),p=document.querySelector('.analytics-trend .analytics-panel-heading > span').getBoundingClientRect();return Math.abs(h.top-p.top)<=1})()"), true)
  assert.equal(await evaluate("['.analytics-trend .analytics-panel-heading > span','.analytics-history .analytics-panel-heading > span','.analytics-chart-detail > small','.analytics-streak','.analytics-calendar-footer','.analytics-session-head','.analytics-session-row','.analytics-footnote'].every(selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)>=13)"), true)
  await shot('qa-analytics-overview-1280')
  await button('Daha fazla göster'); assert.equal(await evaluate("document.querySelectorAll('.analytics-session-row').length"), 13)
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.analytics-session-row:last-child')).borderBottomWidth"), '0px')
  await button('Son 7 gün'); assert.deepEqual((await metrics()).slice(0, 3), ['13 sa 0 dk', '7', '7'])
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await hover('.analytics-chart [role=button]', 6)
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip').dataset.source"), 'chart')
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip strong').textContent"), '1 sa 0 dk')
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip').parentElement===document.body"), true)
  for (const index of [1, 6]) {
    await hover('.analytics-chart [role=button]', index)
    assert.equal(await evaluate(`(()=>{const b=document.querySelectorAll('.analytics-bar')[${index}].getBoundingClientRect(),t=document.querySelector('.analytics-tooltip').getBoundingClientRect();return Math.abs(b.top-t.bottom-10)<1})()`), true, 'Tooltip sits immediately above the real bar top')
  }
  const anchoredTip = await evaluate("document.querySelector('.analytics-tooltip').getBoundingClientRect().toJSON()")
  const hoveredColumn = await evaluate("document.querySelectorAll('.analytics-chart [role=button]')[6].getBoundingClientRect().toJSON()")
  await evaluate("window.__qaTipMutations=0;window.__qaTipObserver=new MutationObserver(changes=>window.__qaTipMutations+=changes.length);window.__qaTipObserver.observe(document.querySelector('.analytics-tooltip'),{attributes:true,childList:true,subtree:true,characterData:true})")
  for (const [x, y] of [[.2, .3], [.7, .6], [.4, .4]]) {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoveredColumn.left + hoveredColumn.width * x, y: hoveredColumn.top + hoveredColumn.height * y })
    await pause(30)
    assert.deepEqual(await evaluate("document.querySelector('.analytics-tooltip').getBoundingClientRect().toJSON()"), anchoredTip, 'Tooltip stays anchored while moving within the hovered column')
  }
  assert.equal(await evaluate('window.__qaTipMutations'), 0, 'Pointer movement within a column does not redraw the tooltip')
  await evaluate('window.__qaTipObserver.disconnect()')
  await shot('qa-analytics-refined-chart-1920')
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); await until("!document.querySelector('.analytics-tooltip')")
  const oldKey = sessions.find(session => session.id === 'old').startedAt
  const oldDate = new Date(oldKey), dayKey = `${oldDate.getFullYear()}-${String(oldDate.getMonth()+1).padStart(2,'0')}-${String(oldDate.getDate()).padStart(2,'0')}`
  await hover(`.analytics-calendar-grid [data-date="${dayKey}"]`)
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip').dataset.source"), 'calendar')
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip strong').textContent"), '2 sa 0 dk')
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip small').textContent"), '1 oturum')
  await shot('qa-analytics-refined-calendar-1920')
  await click(`.analytics-calendar-grid [data-date="${dayKey}"]`)
  assert.equal(await evaluate("!!document.querySelector('.analytics-history-filter .analytics-text-button')"), true, 'All sessions is beside the selected date')
  assert.equal(await evaluate("document.querySelectorAll('.analytics-session-row').length"), 1)
  assert.equal(await evaluate("document.querySelector('.analytics-session-row strong').textContent"), '2 sa 0 dk', 'Annual day drilldown includes sessions outside the seven-day chart filter')
  await evaluate("document.querySelector('.analytics-history').scrollIntoView({block:'center'})")
  await shot('qa-analytics-history-filter-1920')
  await button('Tüm oturumlar')
  await hover('.analytics-calendar-grid button:not(:disabled)[data-level="0"]')
  assert.equal(await evaluate("document.querySelector('.analytics-tooltip strong').textContent"), '0 dk 0 sn')
  await click('.analytics-calendar-grid button:not(:disabled)[data-level="0"]')
  assert.equal(await evaluate("document.querySelectorAll('.analytics-session-row').length"), 0)
  await button('Tüm oturumlar')
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await button('Son 90 gün'); assert.equal(await evaluate("document.querySelectorAll('.analytics-chart [role=button]').length"), 90)
  await button('Tüm zamanlar'); assert.deepEqual((await metrics()).slice(0, 3), ['27 sa 0 dk', '14', '14'])
  assert.ok(await evaluate("document.querySelectorAll('.analytics-chart [role=button]').length") < 30)
  await button('Son 30 gün'); await click('.analytics-ranking > button:first-child')
  await until("document.querySelector('.analytics-insights')")
  assert.equal(await evaluate("document.querySelector('.analytics-page').dataset.scope"), 'qa-profile')
  assert.deepEqual((await metrics()).slice(0, 3), ['13 sa 0 dk', '7', '7'])
  assert.equal(await evaluate("document.querySelector('.analytics-session-row').textContent.includes('Hayatta kalma')"), true)
  // The shared searchable profile picker closes on Escape and supports keyboard focus.
  await click('.analytics-profile-choice .dropdown-trigger'); await until("document.querySelector('.profile-picker-menu')")
  await evaluate("document.querySelector('.profile-picker-menu input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
  await until("!document.querySelector('.profile-picker-menu')")
  await button('Profil analizini aç'); await until("document.querySelector('.main-content.page-profile-analytics')")
  assert.equal(await evaluate("document.querySelector('.profile-workspace-nav [data-profile-page=profile-analytics]').getAttribute('aria-current')"), 'page')
  assert.equal(await evaluate("document.querySelector('.retained-page:not([hidden]) .analytics-page').dataset.scope"), 'qa-profile')
  assert.equal(await evaluate("!!document.querySelector('.retained-page:not([hidden]) .analytics-profile-filter')"), false)
  assert.equal(await evaluate("(()=>{const items=[...document.querySelectorAll('.profile-workspace-nav > button')].map(e=>e.textContent.trim());return items.indexOf('Analiz')+1===items.indexOf('Ekran görüntüleri')})()"), true)
  await shot('qa-analytics-profile-1280')
  await click('.profile-workspace-back'); await click('[data-page=analytics]')
  // Select today's heatmap cell; only the portion on that date should be shown.
  await evaluate("(()=>{const items=[...document.querySelector('.main-content.page-analytics .analytics-calendar-grid').querySelectorAll('button:not(:disabled)')];items.at(-1).click()})()")
  await until("document.querySelector('.main-content.page-analytics .analytics-session-head').textContent.includes('Bu gündeki süre')")
  assert.equal(await evaluate("document.querySelector('.main-content.page-analytics .analytics-history .analytics-session-row:last-of-type strong').textContent"), '1 sa 0 dk')
  await button('Tüm oturumlar')
  await evaluate("document.querySelector('.main-content.page-analytics .analytics-chart [role=button]').focus()")
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' })
  assert.equal(await evaluate("[...document.querySelector('.main-content.page-analytics .analytics-chart').querySelectorAll('[role=button]')].indexOf(document.activeElement)"), 1)
  for (const language of ['tr', 'en', 'de', 'fr', 'ru', 'pl']) {
    await save({ language }); await call('Page.reload'); await until("document.querySelector('[data-page=analytics]')")
    await click('[data-page=analytics]'); await until("document.querySelector('.analytics-trend')")
    assert.equal(await evaluate("document.querySelector('.analytics-page h2').textContent"), { tr: 'Analiz', en: 'Analytics', de: 'Statistiken', fr: 'Statistiques', ru: 'Статистика', pl: 'Statystyki' }[language])
    assert.equal(await evaluate("document.querySelector('.analytics-page').textContent.includes('Oyun süresi dağılımı')"), language === 'tr')
    for (const [width, height] of [[1080, 700], [1280, 800], [1920, 1080]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate("(()=>{const e=document.querySelector('.main-content');return e.scrollWidth<=e.clientWidth})()"), true, `${language} at ${width}px horizontal overflow`)
      assert.equal(await evaluate("[...document.querySelectorAll('.analytics-metric')].every(e=>e.scrollWidth<=e.clientWidth)"), true, `${language} metric overflow`)
      await pause(60)
      const axisSize = await evaluate("(()=>{const e=document.querySelector('.analytics-chart text');return parseFloat(getComputedStyle(e).fontSize)*e.getScreenCTM().a})()")
      assert.ok(Math.abs(axisSize-13)<.2, `${language} at ${width}px: chart labels should stay 13 screen pixels, got ${axisSize}`)
    }
  }
  await save({ language: 'tr' }); await call('Page.reload'); await until("document.querySelector('[data-page=analytics]')"); await click('[data-page=analytics]'); await until("document.querySelector('.analytics-trend')"); await button('Son 90 gün'); await call('Emulation.setDeviceMetricsOverride', { width: 1080, height: 700, deviceScaleFactor: 1, mobile: false })
  await evaluate("document.querySelector('.analytics-calendar').scrollIntoView({block:'center'})"); await shot('qa-analytics-calendar-1080')
  assert.equal(await evaluate("document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth"), true)
  // Checkpoint updates flow through launcher:state without a page reload.
  const updated = sessions.map(session => session.id === 'qa-instance-0' ? { ...session, endedAt: new Date(Date.parse(session.endedAt) + hour / 2).toISOString(), durationMs: 1.5 * hour } : session)
  await save({ qaPlaySessions: updated }); assert.equal((await metrics())[0], '25 sa 30 dk')
  await save({ savePlaytime: false }); await until("document.querySelector('.analytics-notice')")
  // Real backend isolation is covered in test-play-analytics; this fixture also
  // exercises switching accounts while the retained page remains mounted.
  const second = await evaluate("window.launcher.createOfflineAccount('AnalyticsTwo')")
  await evaluate(`window.launcher.selectAccount(${JSON.stringify(second.selectedAccountId)})`)
  await until("document.querySelector('.analytics-empty')")
  assert.equal((await metrics())[0], '0 dk 0 sn')
  assert.equal(await evaluate("document.querySelector('.analytics-page').textContent.includes('Hayatta kalma')"), false)
  await evaluate("window.launcher.selectAccount('qa-offline')"); await until("document.querySelector('.analytics-trend')")
  const multiYear = [make('year-old', 2400, 1), make('year-recent', 1, 1)]
  await save({ qaPlaySessions: multiYear }); await button('Tüm zamanlar')
  await until("document.querySelector('.analytics-trend p').textContent==='Yıllık oyun süren'")
  const years = await evaluate("[...document.querySelector('.analytics-chart svg').querySelectorAll('text[y=\"213\"]')].map(e=>e.textContent)")
  assert.equal(new Set(years).size, 3); assert.ok(years.every(year => /^\d{4}$/.test(year)))
  assert.equal(await evaluate("document.querySelector('.analytics-streak').classList.contains('is-active')"), false, 'One-day streak stays neutral')
  await save({ qaPlaySessions: [] }); await until("document.querySelector('.analytics-empty')"); await shot('qa-analytics-empty-1080')
  assert.equal(await evaluate("document.querySelectorAll('.analytics-calendar-grid button:not(:disabled)').length"), 365)
  assert.equal(await evaluate("document.querySelector('.analytics-streak').classList.contains('is-active')"), false, 'Zero-day streak stays neutral')
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log('PASS analytics totals, 365-day calendar, dark unplayed cells, anchored pointer/focus tooltips without redraws on movement, aligned info icon, constant-size chart labels, readable typography, orange streaks, sidebar order, history separators, account isolation, six languages and 1080/1280/1920 layouts')
} catch (error) {
  if (socket?.readyState === WebSocket.OPEN) { try { await shot('qa-analytics-failure') } catch {} }
  console.error(output.join('').slice(-3000)); throw error
} finally {
  clearTimeout(timer)
  if (socket?.readyState === WebSocket.OPEN) { try { await evaluate("window.launcher.windowAction('close')") } catch {} socket.close() }
  for (const task of pending.values()) { clearTimeout(task.timeout); task.reject(Error('QA finished')) }
  if (fixture && fixture.exitCode === null) { await pause(250); if (fixture.exitCode === null) fixture.kill() }
}
