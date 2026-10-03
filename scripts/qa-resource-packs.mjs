import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const helpers=readFileSync('scripts/qa-servers-custom.mjs','utf8').split('try {')[0].replace(/^import[^\n]*\n/gm,'')
for (let attempt=0;attempt<100;attempt++) { try { if ((await (await fetch('http://127.0.0.1:9225/json/list')).json()).some(tab=>tab.type==='page')) break } catch {} await new Promise(resolve=>setTimeout(resolve,100)) }
const checks=String.raw`
try{
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'}).then(()=>window.launcher.selectProfile('qa-profile'))");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await nav('Kaynak paketleri');await until("document.querySelectorAll('.resource-pack-row').length===3")
 assert.equal(await evaluate("document.querySelector('.profile-sidebar')!==null"),true)
 assert.equal(await evaluate("document.querySelectorAll('.resource-packs-page .servers-profile-select,.resource-packs-page .profile-picker').length"),0)
 assert.equal(await evaluate("document.querySelector('.resource-enable[aria-checked=true]').getAttribute('aria-label')"),'Fresh Animations paketini etkinleştir')
 await click('.resource-enable');await until("document.querySelector('.resource-enable').getAttribute('aria-checked')==='false'")
 assert.equal((await evaluate('window.launcher.getState()')).qaResourceToggles[0].id,'qa-profile')
 await input('.resource-search input','Faithful');assert.equal(await evaluate("document.querySelectorAll('.resource-pack-row').length"),1);assert.equal(await evaluate("document.querySelector('.resource-installed-detail h3').textContent"),'Faithful 32x');await input('.resource-search input','');await shot('qa-resource-packs-installed')
 await evaluate("document.querySelector('.resource-mode-bar [role=tab]:last-child').click()");await until("document.querySelector('.resource-download-summary dd')?.textContent==='FreshAnimations_v1.10.0.zip'")
 assert.equal(await evaluate("[...document.querySelectorAll('.mods-source-nav button')].map(e=>e.textContent.trim()).join(',')"),'Modrinth,CurseForge')
 assert.equal(await evaluate("document.querySelector('.resource-download-summary').textContent.includes('Test World · Minecraft 1.21.1')"),true)
 assert.equal(await evaluate("document.querySelectorAll('.modal-backdrop').length"),0,'file review is inline')
 const request=(await evaluate('window.launcher.getState()')).qaResourceRequests.find(r=>r.channel==='launcher:search-mods');assert.equal(request.args[6],'resourcepack')
 await click('.resource-download-summary .dropdown-trigger');await until("document.querySelector('[role=option]')");await evaluate("[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes('beta')).click()");await until("document.querySelector('.resource-download-summary dd').textContent==='FreshAnimations_beta.zip'")
 await click('.resource-download-summary .dropdown-trigger');await until("document.querySelector('[role=option]')");await evaluate("[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes('1.10.0')).click()");await shot('qa-resource-packs-browse')
 await click('.resource-install-button');assert.equal(await evaluate("document.querySelector('.resource-install-button').disabled"),true);await until("document.querySelector('.resource-install-button').textContent.includes('Kurulu')")
 assert.equal((await evaluate('window.launcher.getState()')).qaResourceInstalls[0].id,'qa-profile')
 assert.equal((await evaluate('window.launcher.getState()')).qaResourceInstalls[0].provider,'modrinth')
 await click('.mods-load-more');await until("document.querySelectorAll('.mods-hit').length===18")
 await click('.mods-source-nav button:last-child');await until("document.querySelector('.provider-connection-state')");assert.equal(await evaluate("document.querySelectorAll('.resource-packs-page .mods-hit').length"),0,'keyless CurseForge makes no catalog requests')
 await evaluate("window.launcher.connectCurseForge('QA_ONLY_SUCCESS_VALUE_NOT_A_CREDENTIAL').then(()=>window.launcher.saveSettings({language:'tr'}))");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await nav('Kaynak paketleri');await until("document.querySelector('.resource-mode-bar')");await evaluate("document.querySelector('.resource-mode-bar [role=tab]:last-child').click()");await click('.mods-source-nav button:last-child');await until("document.querySelector('.resource-download-summary dd')?.textContent==='FreshAnimations_v1.10.0.zip'");assert.equal(await evaluate("document.querySelector('.resource-download-summary').textContent.includes('CurseForge')"),true)
 await evaluate("window.launcher.saveSettings({qaResource:{failInstall:true}})");await click('.resource-install-button');await until("document.querySelector('.toast')?.textContent.includes('Kurulum tamamlanamadı')");await until("!document.querySelector('.resource-install-button').disabled");await evaluate("window.launcher.saveSettings({qaResource:{failInstall:false}})")
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await evaluate("[...document.querySelectorAll('.profile-workspace-nav button')][3].click()");await until("document.querySelector('.resource-packs-page')")
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
  assert.equal(await evaluate("document.querySelector('.resource-packs-page').scrollWidth<=document.querySelector('.resource-packs-page').clientWidth"),true,language+' installed layout fits')
  await evaluate("document.querySelector('.resource-mode-bar [role=tab]:last-child').click()");await until("document.querySelector('.resource-download-summary')")
  assert.equal(await evaluate("document.querySelector('.resource-packs-page').scrollWidth<=document.querySelector('.resource-packs-page').clientWidth"),true,language+' catalog layout fits')
  assert.equal(await evaluate("document.querySelector('.resource-install-button').scrollWidth<=document.querySelector('.resource-install-button').clientWidth"),true,language+' install button fits')
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await click('.profile-workspace-back');await until("document.querySelector('.profile-card')");await evaluate("[...document.querySelectorAll('.profile-card')].find(e=>e.querySelector('h3').textContent==='Test World 2').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await nav('Kaynak paketleri');await until("document.querySelector('.resource-pack-row')?.textContent.includes('Other profile pack')")
 assert.equal(await evaluate("document.querySelectorAll('.resource-pack-row').length"),1,'installed list follows the managed profile')
 assert.equal(await evaluate("window.launcher.getState().then(s=>s.selectedProfileId)"),'qa-profile','management never changes the home profile')
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS resource packs installed/filter/toggle, inline provider/catalog/version/file review, owned-profile installs, pagination, unconfigured CurseForge, install failure/retry, six-language minimum layout and profile isolation; no real files downloaded')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
