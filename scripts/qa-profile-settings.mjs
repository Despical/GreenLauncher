import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
  await call('Runtime.enable'); await evaluate("window.launcher.saveSettings({language:'tr'}).then(()=>window.launcher.selectProfile('qa-profile'))")
  await call('Page.reload'); await until("document.querySelector('.launch-profile-edit')")
  const before = await evaluate("window.launcher.getState()")
  const brand = await evaluate("(()=>{const t=document.querySelector('.brand strong').getBoundingClientRect(),i=document.querySelector('.brand img').getBoundingClientRect();return {textX:t.left,textY:t.top,iconX:i.left,iconY:i.top}})()")
  await nav('Modlar'); await until("document.querySelector('.mods-field .mod-select,.mods-field .custom-dropdown')")
  assert.equal(await evaluate("!!document.querySelector('.profile-sidebar')"),false,'global catalog retains launcher menu')
  assert.equal(await evaluate("document.querySelectorAll('.mods-field').length"),3)
  await nav('Profillerim'); await until("document.querySelector('.profile-card')")
  await evaluate("document.querySelector('.profile-card').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
  await until("document.querySelector('.profile-sidebar')")
  assert.equal(await evaluate("document.querySelectorAll('.profile-information-dialog,.profile-workspace-footer,.sidebar .profile-play').length"),0)
  const identity = await evaluate("(()=>{const t=document.querySelector('.workspace-profile-select strong').getBoundingClientRect(),i=document.querySelector('.profile-workspace-icon img').getBoundingClientRect();return {textX:t.left,textY:t.top,iconX:i.left,iconY:i.top}})()")
  for(const key of ['textX','textY','iconX','iconY']) assert.ok(Math.abs(identity[key]-brand[key])<=1,JSON.stringify({key,brand,identity}))
  await click('.account-tile'); await until("document.querySelector('.account-switcher-menu')||document.querySelector('.account-switcher')")
  await click('.account-tile')
  const choose = async name => {await click('.workspace-profile-select .dropdown-trigger');await until("document.querySelector('.profile-picker-menu')");await evaluate("[...document.querySelectorAll('.profile-picker-menu [role=option]')].find(e=>e.querySelector('strong').textContent==="+JSON.stringify(name)+").click()");await wait(100)}
  await choose('Test World 2'); await nav('Ayarlar'); await until("document.querySelector('.profile-settings-page')")
  assert.equal(await evaluate("document.querySelectorAll('.profile-settings-page [role=tab]').length"),4)
  const tab = async name => {await evaluate("document.querySelector('.profile-settings-page #profile-settings-tab-"+name+"').click()");await wait(50)}
  for(const name of ['general','java','window','storage']) {
    await tab(name)
    assert.equal(await evaluate("document.querySelector('.profile-general-settings-link small').textContent"),'Buradaki ayarlar genel ayarları geçersiz kılar')
    await click('.profile-general-settings-link'); await until("document.querySelector('.page-settings')")
    const expected = name==='java'?'Java':name==='storage'?'Depolama':'Launcher'
    assert.equal(await evaluate("document.querySelector('.settings-page:not(.profile-settings-page) .settings-tabs [aria-selected=true]').textContent.trim()"),expected)
    await key('5'); await until("document.querySelector('.profile-sidebar')"); await nav('Ayarlar')
  }
  await tab('general'); await input('.profile-settings-page input','Second profile edited')
  await tab('java'); await input('.profile-settings-page input[type=number]:nth-of-type(1)','1024')
  await evaluate("(()=>{const e=document.querySelectorAll('.profile-settings-page input[type=number]')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'6144');e.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await input('.profile-settings-page .form-grid label:last-child input','-XX:+UseG1GC -Dprofile=second')
  await tab('window'); await input('.profile-settings-page .form-grid label:first-child input','1600'); await input('.profile-settings-page .form-grid label:nth-child(2) input','900')
  await click('.profile-settings-page [role=checkbox]')
  await tab('general'); assert.equal(await evaluate("document.querySelector('.profile-settings-page input').value"),'Second profile edited')
  assert.equal(await evaluate("window.launcher.getState().then(s=>s.profiles.find(p=>p.id==='qa-profile-1').memoryMb)"),4096,'draft remains unapplied')
  await click('.profile-settings-save-bar .save-confirm'); await until("!document.querySelector('.profile-settings-save-bar')")
  const saved = await evaluate("window.launcher.getState()"), edited=saved.profiles.find(p=>p.id==='qa-profile-1')
  assert.equal(edited.name,'Second profile edited');assert.equal(edited.memoryMb,6144);assert.equal(edited.minMemoryMb,1024)
  assert.equal(edited.width,1600);assert.equal(edited.height,900);assert.equal(edited.fullscreen,true);assert.equal(edited.jvmArgs,'-XX:+UseG1GC -Dprofile=second')
  assert.equal(saved.selectedProfileId,'qa-profile');assert.deepEqual(saved.settings,before.settings)
  assert.deepEqual(saved.profiles.find(p=>p.id==='qa-profile'),before.profiles.find(p=>p.id==='qa-profile'))
  await choose('Test World');await tab('java')
  await input('.profile-settings-page input[type=number]','8192'); await click('.profile-settings-save-bar .save-confirm')
  assert.equal(await evaluate("window.launcher.getState().then(s=>s.profiles.find(p=>p.id==='qa-profile').minMemoryMb)"),undefined)
  assert.equal(await evaluate("!!document.querySelector('.profile-settings-save-bar')"),true)
  await click('.profile-settings-save-bar button:not(.save-confirm)'); await until("!document.querySelector('.profile-settings-save-bar')")
  await evaluate("window.launcher.getState().then(async s=>{const p=s.profiles.find(p=>p.id==='qa-profile-1');await window.launcher.saveProfile({...p,modpack:{title:'Locked pack',projectId:'qa-pack',versionId:'qa-version',fileCount:1}});await window.launcher.selectProfile('qa-profile')})")
  await choose('Second profile edited'); await tab('general')
  assert.equal(await evaluate("document.querySelector('.profile-settings-page .profile-version-select .dropdown-trigger').disabled"),true)
  for(const language of ['tr','en','de','fr','ru','pl']) {
    await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit')
    await evaluate("document.querySelector('.profile-workspace-nav button:last-child').click()");await until("document.querySelector('.profile-settings-page')")
    for(const name of ['general','java','window','storage']) {
      await tab(name);await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
      assert.equal(await evaluate("document.querySelector('.profile-general-settings-link').scrollWidth<=document.querySelector('.profile-general-settings-link').clientWidth"),true)
      assert.equal(await evaluate("[...document.querySelectorAll('.profile-settings-page [role=tab]')].every(b=>b.scrollWidth<=b.clientWidth)"),true,language+' tabs fit')
    }
  }
  await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await evaluate("document.querySelector('.profile-workspace-nav button:last-child').click()");await until("document.querySelector('.profile-settings-page')")
  await shot('qa-profile-settings-general');await tab('java');await shot('qa-profile-settings-java')
  await click('.profile-workspace-back');await until("document.querySelector('.page-profiles')")
  for(const p of await evaluate("window.launcher.getState().then(s=>s.profiles)"))await evaluate('window.launcher.deleteProfile('+JSON.stringify(p.id)+')')
  await nav('Modlar');await until("document.querySelector('.mods-source-nav')")
  assert.equal(await evaluate("!!document.querySelector('.profile-sidebar')"),false,'catalog remains accessible with no profiles')
  assert.equal(errors.length,0,JSON.stringify(errors))
  console.log('PASS profile double-click, brand alignment, retained account switcher, global catalog with/without profiles, four settings tabs/general links, draft persistence, isolated profile save, home/global settings preservation, invalid memory, modpack lock and six-language minimum layout')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
