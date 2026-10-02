import assert from 'node:assert/strict'
import {evaluate,send,shot,close} from './qa-accounts-cdp.mjs'
const wait = ms => new Promise(r=>setTimeout(r,ms))
const click = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click()})()`); await wait(350) }
try {
  await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled',{enabled:true})
  await send('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
  await click('Technic'); await wait(2500)
  assert.ok(await evaluate(`document.querySelectorAll('.mods-hit').length > 0`))
  await evaluate(`document.querySelector('.main-content').scrollTop=9999;document.querySelector('.mods-detail').scrollTop=9999`)
  await shot('qa-013-technic-install-controls')
  await evaluate(`document.querySelector('button[aria-label="Paket sürümü"]').click()`); await wait(200)
  assert.ok(await evaluate(`document.querySelectorAll('[role=option]').length > 1`))
  await shot('qa-013-technic-version-menu')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'})
  await click('Filtreler')
  assert.ok(await evaluate(`!!document.querySelector('button[aria-label="Sırala"]')`))
  assert.ok(await evaluate(`!document.querySelector('button[aria-label="Kategori"]')`))
  await click('CurseForge'); await click('Bağlantıyı yapılandır')
  assert.equal(await evaluate(`document.querySelector('.provider-key-label input').type`),'password')
  assert.equal(await evaluate(`document.querySelector('.account-create-button').disabled`),true)
  await wait(300); await shot('qa-013-connection-min-size')
  await click('Vazgeç'); await wait(250)
  await evaluate(`document.querySelector('.statusbar-changelog').click()`); await wait(300)
  await evaluate(`document.querySelectorAll('.changelog-versions button')[1].click()`)
  assert.ok(await evaluate(`document.querySelector('.changelog-content').textContent.includes('0.12.2')`))
  for (const language of ['en','de','fr','ru','pl','tr']) {
    await evaluate(`window.launcher.saveSettings({language:${JSON.stringify(language)}})`); await wait(80)
    const layout = await evaluate(`(()=>{const e=document.querySelector('[role=dialog]'),r=e.getBoundingClientRect();return {inside:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,overflow:e.scrollWidth>e.clientWidth+1}})()`)
    assert.ok(layout.inside,language+' dialog bounds'); assert.equal(layout.overflow,false,language+' dialog overflow')
  }
  console.log('Provider controls, versions, filters, credential form, history switching and six-language dialog layout passed at 1080x700.')
} finally {close()}
