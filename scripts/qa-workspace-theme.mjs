import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
const root='.retained-page:not([hidden]) ', q=s=>'document.querySelector('+JSON.stringify(root+s)+')'
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await nav('Ayarlar');await until(q('.profile-icon-settings'))
 assert.equal(await evaluate(q('.profile-icon-settings')+'.previousElementSibling.classList.contains("profile-game-directory")'),true)
 await click(root+'.profile-icon-settings .profile-section-enable');await click(root+'.profile-icon-settings .dropdown-trigger');await until("document.querySelector('[role=option]')")
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.dropdown-menu')).backgroundColor"),'rgb(22, 27, 34)')
 assert.equal(await evaluate("(()=>{const options=[...document.querySelectorAll('[role=option]')];return options.find(e=>e.textContent.trim()==='OptiFine').querySelector('img').src.startsWith('data:image/png')})()"),true,'OptiFine uses the original official pixel icon')
 await evaluate("[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='OptiFine').click()");await click('.profile-settings-save-bar .save-confirm');await until("!document.querySelector('.profile-settings-save-bar')")
 assert.equal(await evaluate("document.querySelector('.profile-workspace-icon img').src.startsWith('data:image/png')"),true)
 const gap=await evaluate("(()=>{const identity=document.querySelector('.profile-workspace-label').getBoundingClientRect(),sep=document.querySelector('.profile-sidebar>.brand-separator').getBoundingClientRect();return sep.top-identity.bottom})()")
 assert.ok(gap>=11,'identity hover stays above separator')
 await call('DOM.enable');await call('CSS.enable');const documentNode=await call('DOM.getDocument');const backNode=await call('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'.profile-workspace-back'});await call('CSS.forcePseudoState',{nodeId:backNode.nodeId,forcedPseudoClasses:['hover']});await wait(220)
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.profile-workspace-back svg')).transform"),'matrix(1, 0, 0, 1, -3, 0)')
 await call('CSS.forcePseudoState',{nodeId:backNode.nodeId,forcedPseudoClasses:[]})
 for(const name of ['Modlar','Kaynak paketleri','Shader paketleri']){
  await nav(name);await until(q('.resource-incompatible-indicator'));assert.equal(await evaluate(q('.resource-incompatible-indicator')+'.textContent'),'Uyumlu olmayabilir')
  assert.equal(await evaluate('getComputedStyle('+q('.resource-incompatible-indicator')+').color'),'rgb(240, 136, 126)')
  assert.equal(await evaluate('getComputedStyle('+q('.resource-check-updates')+').backgroundColor'),'rgb(44, 109, 67)')
  assert.ok(await evaluate(q('.resource-supported-versions')+'.textContent.includes("1.21.1")'))
  await click(root+'.resource-pack-row:nth-child(3) .resource-pack-select');assert.equal(await evaluate(q('.resource-supported-versions')+'.textContent'),'1.20.4')
 }
 await nav('Sürüm');await evaluate("window.launcher.saveSettings({qaVersion:{locked:true}})");await until("document.querySelector('.profile-pack-controls')");await shot('qa-workspace-modpack-version')
 await evaluate("window.launcher.saveSettings({qaVersion:{noDates:true}})");await click('.profile-pack-check');await until("!document.querySelector('.profile-pack-check').disabled")
 assert.equal(await evaluate("document.querySelector('.profile-pack-controls>.primary').disabled"),false,'all catalog versions remain installable')
 assert.ok(await evaluate("document.querySelector('.profile-pack-latest').textContent.includes('Son çıkan sürüm:')"))
 await click('.profile-pack-controls .dropdown-trigger');await until("document.querySelector('[role=option]')");await evaluate("[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes('2.0')).click()")
 assert.equal(await evaluate("document.querySelector('.profile-pack-controls>.primary').disabled"),false,'a catalog version can be selected explicitly for a separate profile')
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await click('.profile-workspace-nav [data-profile-page=profile-version]');await until("document.querySelector('.profile-pack-controls')")
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
  assert.equal(await evaluate("document.querySelector('.profile-pack-section').scrollWidth<=document.querySelector('.profile-pack-section').clientWidth"),true,language+' pack panel fits')
  assert.equal(await evaluate("[...document.querySelectorAll('.profile-pack-controls button')].every(e=>e.scrollWidth<=e.clientWidth)"),true,language+' pack actions fit')
 }
 await evaluate("window.launcher.saveSettings({language:'tr',qaVersion:{navigate:'mods'}})");await until("document.querySelector('.mods-setup')")
 assert.equal(await evaluate("document.querySelector('.resource-packs-page[data-content-kind=mod]')===null"),true,'tray Mods opens the global catalog from a managed profile')
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.mods-setup')).backgroundColor"),'rgb(13, 17, 23)')
 await until("document.querySelector('.mods-welcome')");assert.equal(await evaluate("getComputedStyle(document.querySelector('.mods-welcome')).backgroundColor"),'rgb(13, 17, 23)')
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS original OptiFine, inset identity hover/animated back arrow, common dropdown and green colors, supported versions/red incompatibility in all content tables, unlocked pack controls and six-language pack layout')
} finally {socket.close()}
`
await new Function('assert', 'writeFileSync', 'return (async()=>{' + helpers + checks + '})()')(assert, writeFileSync)
