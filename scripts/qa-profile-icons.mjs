import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
const root='.retained-page:not([hidden]) ', q=s=>'document.querySelector('+JSON.stringify(root+s)+')'
const save=async()=>{await click('.profile-settings-save-bar .save-confirm');await until("!document.querySelector('.profile-settings-save-bar')")}
const choose=async label=>{await click(root+'.profile-icon-settings .dropdown-trigger');await until("document.querySelector('[role=option]')");await evaluate('[...document.querySelectorAll("[role=option]")].find(e=>e.textContent.trim()==='+JSON.stringify(label)+').click()')}
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await nav('Ayarlar');await until(q('.profile-icon-settings'))
 const automatic=await evaluate("document.querySelector('.profile-workspace-icon img').src")
 assert.equal(await evaluate(q('.profile-icon-settings .dropdown-trigger')+'.disabled'),true)
 assert.equal(await evaluate(q('.profile-icon-settings .dropdown-trigger img')+'.src'),automatic,'default icon follows the installed loader')
 const alignment=await evaluate("(()=>{const s=document.querySelector('.profile-sidebar>.brand-separator').getBoundingClientRect(),b=document.querySelector('.profile-workspace-back').getBoundingClientRect(),a=document.querySelector('.profile-workspace-back svg').getBoundingClientRect(),i=document.querySelector('.profile-workspace-icon img').getBoundingClientRect(),p=document.querySelector('.profile-workspace-label').getBoundingClientRect();return {left:s.left,right:s.right,backLeft:b.left,backRight:b.right,arrow:a.left,icon:i.left,labelLeft:p.left,labelRight:p.right}})()")
 for(const key of ['backLeft','arrow','icon','labelLeft'])assert.ok(Math.abs(alignment[key]-alignment.left)<1,JSON.stringify(alignment))
 assert.ok(Math.abs(alignment.backRight-alignment.right)<1&&Math.abs(alignment.labelRight-alignment.right)<1,JSON.stringify(alignment))
 const accountStyle=()=>evaluate('(()=>{const b='+q('.profile-account-override .dropdown-trigger')+',s=b.querySelector("small"),i=s.querySelector("svg");return {disabled:b.disabled,text:s.textContent,color:getComputedStyle(s).color,opacity:getComputedStyle(i).opacity,filter:getComputedStyle(i).filter}})()')
 const disabled=await accountStyle();assert.equal(disabled.disabled,true);assert.ok(disabled.text.includes('Microsoft'));assert.equal(disabled.color,'rgb(110, 118, 129)');assert.equal(disabled.opacity,'0.45');assert.equal(disabled.filter,'grayscale(1)')
 await click(root+'.profile-account-override .profile-section-enable');const enabled=await accountStyle();assert.equal(enabled.disabled,false);assert.notEqual(enabled.color,disabled.color);assert.equal(enabled.opacity,'1');await click(root+'.profile-account-override .profile-section-enable')
 await click(root+'.profile-icon-settings .profile-section-enable');await choose('OptiFine');await save();assert.notEqual(await evaluate("document.querySelector('.profile-workspace-icon img').src"),automatic)
 await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await until(q('.profile-icon-settings'));assert.equal(await evaluate(q('.profile-icon-settings .dropdown-copy strong')+'.textContent'),'OptiFine')
 await choose('Özel görsel');await click(root+'.profile-icon-upload');await until(q('.profile-icon-preview>img')+'.naturalWidth===128');await save()
 const custom=await evaluate("document.querySelector('.profile-workspace-icon img').src");assert.ok(custom.startsWith('data:image/png;base64,'));assert.equal(await evaluate("document.querySelector('.profile-workspace-icon img').naturalWidth"),128)
 await click(root+'.profile-icon-settings .profile-section-enable');await save();assert.equal(await evaluate("document.querySelector('.profile-workspace-icon img').src"),automatic,'disabling customization restores automatic loader icon')
 assert.equal((await evaluate('window.launcher.getState()')).profiles.find(p=>p.id==='qa-profile').icon.image,custom,'custom image is kept while disabled')
 await click(root+'.profile-icon-settings .profile-section-enable');await save();assert.equal(await evaluate("document.querySelector('.profile-workspace-icon img').src"),custom)
 await shot('qa-custom-profile-icon')
 await nav('Sunucular');await until(q('.server-select'));await click(root+'.server-management-actions .danger');await until("document.querySelector('.server-delete-dialog')")
 assert.equal(await evaluate("document.querySelector('.server-delete-summary img').src === document.querySelector('.server-details-identity img').src"),true,'delete dialog shows the selected server’s own image')
 assert.equal(await evaluate("document.querySelector('.server-delete-summary img').draggable"),false);await shot('qa-server-own-delete-icon');await click('.server-delete-dialog .modal-close')
 const spacing=await evaluate('(()=>{const h=[...'+q('.servers-table-head')+'.children],a=h[1].getBoundingClientRect(),b=h[2].getBoundingClientRect();return b.x+b.width/2-a.x-a.width/2})()');assert.ok(spacing<=160)
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await click('.profile-workspace-nav [data-profile-page=profile-settings]');await until(q('.profile-icon-settings'))
  await call('Emulation.setDeviceMetricsOverride',{width:1080,height:800,deviceScaleFactor:1,mobile:false})
  assert.equal(await evaluate(q('.profile-icon-fields')+'.scrollWidth<='+q('.profile-icon-fields')+'.clientWidth'),true,language+' icon controls fit')
  assert.equal(await evaluate("document.querySelector('.profile-workspace-icon img').src"),custom,'saved custom icon survives '+language+' reload')
 }
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS disabled Microsoft subtitle/logo, separator-aligned profile identity/back button, automatic loader icon, preset/custom selection and save/reload/disable preservation, server-specific delete icon and compact player/address columns; six languages')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
