import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluate, send, shot, close } from './qa-accounts-cdp.mjs'
const wait = ms => new Promise(r => setTimeout(r, ms))
async function click(label) {
  await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('Missing '+${JSON.stringify(label)});b.click()})()`)
  await wait(180)
}
const noKey = process.argv.includes('--no-key')
try {
  await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 700, deviceScaleFactor: 1, mobile: false })
  await click('Modlar')
  for (const source of ['Technic', 'CurseForge', 'Modrinth', 'CurseForge', 'Technic', 'Özel', 'CurseForge']) {
    await click(source); await wait(220)
    if (source === 'Technic') assert.equal(await evaluate(`document.querySelectorAll('.mods-type-tabs').length`), 0)
  }
  // Switch while a delayed search is in flight; its result must be discarded.
  await click('Technic'); await wait(200)
  await evaluate(`(()=>{const input=document.querySelector('.mods-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'delayed');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await wait(380); await click('CurseForge'); await wait(600)
  const calls = JSON.parse(readFileSync('build/qa-source-requests.json', 'utf8'))
  assert.ok(calls.filter(c => c.kind.endsWith('versions')).length > 0)
  assert.ok(calls.every(c => c.valid !== false), 'No foreign identifiers sent to any provider')
  if (noKey) {
    assert.ok(!calls.some(c => c.source === 'curseforge'), 'No requests without app credentials')
    assert.equal(await evaluate(`document.querySelectorAll('.provider-key-label, .provider-connect-dialog').length`), 0)
    await shot('qa-0131-curseforge-unconfigured')
    console.log('PASS no-key source switches: zero CurseForge requests, no key prompt, no identifier errors')
  } else {
    assert.ok(calls.some(c => c.source === 'curseforge' && c.valid === true))
    console.log('PASS configured source switches and stale search result isolation')
  }
  await evaluate(`document.querySelector('.statusbar-changelog').click()`); await wait(250)
  assert.equal(await evaluate(`document.querySelectorAll('.changelog-dialog time').length`), 0)
  assert.equal(await evaluate(`document.querySelectorAll('.changelog-release-row').length`), 3)
  assert.ok(await evaluate(`!document.querySelector('.changelog-dialog').innerText.includes('Minecraft')`))
  assert.ok(await evaluate(`!document.querySelector('.changelog-dialog').innerText.includes('Güncel')`))
  await shot('qa-0131-changelog-list')
  await evaluate(`document.querySelector('.changelog-release-row').click()`); await wait(250)
  assert.equal(await evaluate(`document.querySelectorAll('.changelog-dialog time').length`), 1)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.changelog-back')).outlineOffset`), '-2px')
  await shot('qa-0131-changelog-detail')
  for (const language of ['en', 'de', 'fr', 'ru', 'pl', 'tr']) {
    await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`); await wait(80)
    assert.ok(await evaluate(`(()=>{const e=document.querySelector('[role=dialog]'),r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth+1})()`), language)
  }
  await click('Tüm sürümler')
  assert.equal(await evaluate(`document.activeElement.dataset.version`), '0.13.1')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await wait(220)
  assert.equal(await evaluate(`document.querySelectorAll('[role=dialog]').length`), 0)
  await click('Ayarlar'); await click('Günlükler'); await wait(200)
  const scrollbar = await evaluate(`(()=>{const e=document.querySelector('.error-log-list'),s=getComputedStyle(e);return {scroll:e.scrollHeight>e.clientHeight,width:s.scrollbarWidth,color:s.scrollbarColor}})()`)
  assert.ok(scrollbar.scroll); assert.equal(scrollbar.width, 'thin'); assert.notEqual(scrollbar.color, 'auto')
  await shot('qa-0131-error-scrollbar')
  console.log('PASS changelog list/detail, six languages, focus return, Escape close and themed log scrollbar')
} finally { close() }
