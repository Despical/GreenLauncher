import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { send, evaluate, close } from './qa-accounts-cdp.mjs'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const clickNav = async label => {
  await evaluate(`[...document.querySelectorAll('.side-nav button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(100)
    if (label === 'Ana Sayfa' || await evaluate(`document.querySelector('.content-page') !== null`)) break
  }
}
const pageBounds = () => evaluate(`(() => { const page = document.querySelector('.content-page'); const rect = page.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width } })()`)

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
  await clickNav('Sürümler')
  const versions = await pageBounds()
  await clickNav('Profillerim')
  assert.deepEqual(await pageBounds(), versions)
  await clickNav('Modlar')
  assert.deepEqual(await pageBounds(), versions)
  for (const label of ['Ekran görüntüleri', 'İndirmeler', 'Depolama', 'Ayarlar']) {
    await clickNav(label)
    assert.deepEqual(await pageBounds(), versions, label)
  }
  await evaluate(`[...document.querySelectorAll('.settings-tabs button')].find(button => button.textContent.trim() === 'Günlükler').click()`)
  await wait(200)
  assert.equal(await evaluate(`document.querySelector('.log-source-filter select') === null`), true)
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.log-record strong')).fontSize) >= 14`))
  await evaluate(`document.querySelector('.log-source-trigger').click()`)
  assert.ok(await evaluate(`document.querySelectorAll('.log-source-menu [role=option]').length > 0`))
  assert.equal(await evaluate(`document.querySelector('.log-copy-button') === null`), true)
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  writeFileSync('build/qa-layout-logs.png', Buffer.from(screenshot.data, 'base64'))
  await clickNav('Ana Sayfa')
  await evaluate(`document.querySelector('.hero-motion-toggle').click()`)
  await wait(300)
  assert.equal(await evaluate(`document.querySelector('.save-bar') === null`), true)
  await clickNav('Sürümler')
  await evaluate(`{ const trigger = document.querySelector('.version-filter-trigger'); if (trigger.getAttribute('aria-expanded') === 'false') trigger.click() }`)
  assert.equal(await evaluate(`document.querySelector('.version-filter-menu').textContent.includes('Filtreyi temizle')`), false)
  await clickNav('Modlar')
  await evaluate(`[...document.querySelectorAll('.mods-source-nav button')].find(button => button.textContent.trim() === 'Modrinth').click()`)
  await wait(200)
  const color = await evaluate(`getComputedStyle(document.querySelector('.mods-filter-button')).backgroundColor`)
  assert.equal(color, 'rgb(22, 27, 34)')
  console.log('PASS wide-page alignment, logs controls and type, hero toggle, filter controls')
} finally {
  close()
}
