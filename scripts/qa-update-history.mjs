import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers=readFileSync('scripts/qa-servers-custom.mjs','utf8').split('try {')[0].replace(/^import[^\n]*\n/gm,'')
const checks=String.raw`
try{
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 const notes='<h3>Playtime</h3><ul><li>Daily &amp; weekly history</li><li>Download fixes</li></ul><script>window.badNotes=true</script>'
 await evaluate('window.launcher.saveSettings('+JSON.stringify({language:'tr',qaUpdate:{phase:'available',currentVersion:'0.17.2',version:'0.18.0',notes,releasedAt:'2026-10-03T10:00:00Z',checkedAt:'2026-10-01T10:00:00Z',error:null}})+')')
 await call('Page.reload');await until("document.querySelector('.side-nav')");await key('1')
 assert.equal(await evaluate("document.querySelectorAll('.home-update,.main-content.page-home .launcher-update-panel').length"),0)
 await key('9');await button('Launcher');await until("document.querySelector('.update-last-check')")
 assert.equal(await evaluate("document.querySelectorAll('.update-notes').length"),0)
 const original=await evaluate("(()=>{const stamp=document.querySelector('.update-last-check');stamp.dataset.qaStable='yes';return stamp.textContent})()")
 assert.match(original,/01\.10\.2026 \d{2}:\d{2}$/)
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.update-last-check')).fontSize"),'12px')
 await evaluate("document.querySelector('.launcher-update-settings .update-check').click()");await wait(30)
 assert.equal(await evaluate("document.querySelector('.update-last-check').dataset.qaStable"),'yes')
 assert.equal(await evaluate("document.querySelector('.update-last-check').textContent"),original,'timestamp remains visible and stable while checking')
 await until("!document.querySelector('.update-check').disabled")
 assert.notEqual(await evaluate("document.querySelector('.update-last-check').textContent"),original)
 await shot('qa-update-clean-card')
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')")
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
  await click('.statusbar-changelog');await until("document.querySelector('.release-current-badge')")
  assert.equal(await evaluate("document.querySelector('.release-latest-badge').previousElementSibling.textContent"),'v0.18.0')
  assert.equal(await evaluate("document.querySelector('.release-current-badge').previousElementSibling.textContent"),'v0.17.2')
  const text=await evaluate("document.querySelector('.release-history-detail').textContent")
  assert.match(text,/Daily & weekly history/);assert.doesNotMatch(text,/<h3>|<li>|window.badNotes/)
  assert.equal(await evaluate("window.badNotes===true"),false)
  assert.equal(await evaluate("[...document.querySelectorAll('.release-latest-badge,.release-current-badge')].every(b=>{const s=b.previousElementSibling.getBoundingClientRect(),r=b.getBoundingClientRect();return Math.abs((s.top+s.bottom-r.top-r.bottom)/2)<1&&r.height<=s.height})"),true)
  assert.equal(await evaluate("document.querySelector('.changelog-dialog').scrollWidth<=document.querySelector('.changelog-dialog').clientWidth"),true)
  if(language==='tr')await shot('qa-remote-release-history')
  await click('.release-update-link');await until("document.querySelector('.account-dialog .launcher-update-panel')")
  assert.equal(await evaluate("document.querySelectorAll('.update-notes').length"),0)
  await evaluate("document.querySelector('.account-dialog .modal-close').click()");await until("!document.querySelector('.account-dialog')")
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 await evaluate("window.launcher.saveSettings({qaUpdate:{phase:'downloading',operation:'download',error:null}})")
 await evaluate("window.launcher.saveSettings({qaUpdate:{phase:'error',operation:'download',error:'network'}})")
 await until("document.querySelector('.toast')");assert.match(await evaluate("document.querySelector('.toast').textContent"),/Güncelleme indirilemedi/)
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS no homepage/card release notes, stable visible timestamp with leading-zero date and readable font, remote changelog-only inert notes, latest/current badges aligned in six languages, footer update link and asynchronous download error toast')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
