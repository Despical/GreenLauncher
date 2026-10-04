import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`

const root='.retained-page:not([hidden]) ',q=s=>'document.querySelector('+JSON.stringify(root+s)+')'
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr',qaResource:{manyVersions:true}}).then(()=>window.launcher.selectProfile('qa-profile'))");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit')
 for(const name of ['Modlar','Kaynak paketleri','Shader paketleri']){
  await nav(name);await until(q('.supported-versions-toggle'));assert.equal(await evaluate(q('.supported-versions-toggle')+'.getAttribute("aria-expanded")'),'false')
  assert.equal(await evaluate(q('.supported-versions-text')+'.scrollHeight>'+q('.supported-versions-text')+'.clientHeight'),true)
  await click(root+'.supported-versions-toggle');assert.equal(await evaluate(q('.supported-versions-toggle')+'.getAttribute("aria-expanded")'),'true');assert.equal(await evaluate(q('.supported-versions-text')+'.scrollHeight<='+q('.supported-versions-text')+'.clientHeight+1'),true)
  await click(root+'.supported-versions-toggle');await click(root+'.resource-pack-row:nth-child(3) .resource-pack-select');await until(q('.resource-incompatible-note'))
  assert.equal(await evaluate(q('.resource-incompatible-note')+'.parentElement.lastElementChild==='+q('.resource-incompatible-note')),true,'warning last in '+name)
  assert.equal(await evaluate('getComputedStyle('+q('.resource-incompatible-note')+').color'),'rgb(240, 136, 126)');assert.equal(await evaluate('getComputedStyle('+q('.resource-incompatible-note')+').borderTopWidth'),'1px')
 }
 await nav('Sürüm');await evaluate("window.launcher.saveSettings({qaVersion:{locked:true}})");await until(q('.profile-pack-controls'));await click(root+'.profile-pack-controls .dropdown-trigger');await until("document.querySelector('[role=option]')")
 assert.equal(await evaluate("document.querySelector('[role=option] small')===null"),true);assert.ok(await evaluate("document.querySelector('[role=option]').textContent.includes(' · ')"));await evaluate("document.querySelector('[role=option]').click()")
 await nav('Diğer sistem kayıtları');await until(q('.minecraft-console-line'));assert.equal(await evaluate('getComputedStyle('+q('.minecraft-log-upload-action')+').backgroundColor'),'rgb(44, 109, 67)')
 assert.ok(await evaluate(q('.system-log-picker')+'.getBoundingClientRect().width')<=271);assert.equal(await evaluate(q('.minecraft-log-search')+'.parentElement.className'),'minecraft-log-toolbar')
 assert.equal(await evaluate(q('.minecraft-log-actions')+'.parentElement.className'),'minecraft-log-footer');assert.equal(await evaluate(q('.minecraft-log-copy')+'.getBoundingClientRect().height'),38)
 assert.notEqual(await evaluate("document.querySelector('[data-profile-page=system-logs] svg').innerHTML"),await evaluate("document.querySelector('[data-profile-page=minecraft-log] svg').innerHTML"))
 await click(root+'.minecraft-log-upload-action');await until("document.querySelector('[role=dialog]')");assert.equal(await evaluate("document.querySelector('[role=dialog] .account-dialog-symbol')===null"),true);assert.ok(await evaluate("document.querySelector('[role=dialog] .modal-primary').getBoundingClientRect().width")<150);assert.equal(await evaluate("document.querySelector('[role=dialog] .modal-actions').lastElementChild.className"),'modal-primary');await click('[role=dialog] .secondary')
 await evaluate("window.launcher.saveSettings({qaVersion:{extraLogs:true}})");await click(root+'.page-heading .heading-action');await wait(250);await click(root+'.system-log-delete-all');await until("document.querySelector('.system-log-delete-list')")
 assert.equal(await evaluate("document.querySelectorAll('.system-log-delete-list li').length"),43);assert.equal(await evaluate("document.querySelector('.system-log-delete-list').scrollHeight>document.querySelector('.system-log-delete-list').clientHeight"),true);await shot('qa-log-delete-files');await click('[role=dialog] .secondary')
 await shot('qa-system-log-controls')
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false});await wait(120)
  assert.equal(await evaluate(q('.system-logs-page')+'.scrollWidth<='+q('.system-logs-page')+'.clientWidth'),true,language+' system logs fit');assert.equal(await evaluate('[...'+q('.minecraft-log-actions')+'.querySelectorAll("button")].every(e=>e.getBoundingClientRect().height===38)'),true)
 }
 await evaluate("window.launcher.saveSettings({language:'tr',qaVersion:{navigate:'mods'}})");await until("document.querySelector('.mods-welcome')")
 assert.equal(await evaluate("document.querySelector('.mods-source-foot')===null"),true);assert.ok(await evaluate("document.querySelector('.mods-source-nav').getBoundingClientRect().height")<300);assert.equal(await evaluate("getComputedStyle(document.querySelector('.mods-welcome')).backgroundColor"),'rgb(22, 27, 34)')
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS compact provider menu, two-line expandable supported versions in all content tables, bottom separated red warnings, single-line pack options, aligned archived/live log controls, compact iconless dialogs and scrollable delete list, shared empty-card surface, six-language minimum size')
} finally {socket.close()}
`
await new Function('assert', 'writeFileSync', 'return (async()=>{' + helpers + checks + '})()')(assert, writeFileSync)
