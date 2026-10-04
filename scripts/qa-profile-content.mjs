import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '').replace('await wait(100)', 'await wait(380)')
const checks = String.raw`
const base='.retained-page:not([hidden]) .resource-packs-page'
const q=selector=>'document.querySelector('+JSON.stringify(base+' '+selector)+')'
try {
 await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'}).then(()=>window.launcher.selectProfile('qa-profile'))");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit')
 assert.equal(await evaluate("[...document.querySelectorAll('.profile-workspace-nav button')].some(b=>['Kurulu modlar','Modrinth','CurseForge','Technic'].includes(b?.textContent.trim()))"),false,'profile sidebar has one Mods entry even for modpacks')
 for (const [name,kind,first,filename] of [['Modlar','mod','Sodium','Sodium_1.10.0.jar'],['Shader paketleri','shader','Complementary','Complementary_1.10.0.zip'],['Kaynak paketleri','resourcepack','Fresh Animations','FreshAnimations_v1.10.0.zip']]) {
  await nav(name);await until(q('h2')+'?.textContent==='+JSON.stringify(name));await until('document.querySelectorAll('+JSON.stringify(base+' .resource-pack-row')+').length===3')
  assert.equal(await evaluate(q('.page-heading .resource-check-updates')+'!==null'),true,'updates sit above the heading separator');
  assert.equal(await evaluate(q('.resource-mode-bar > span')+'===null'),true,'no redundant Minecraft/loader label');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-table-head')+').fontSize'),'13px');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-installed-detail dt')+').fontSize'),'13px');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-table-head > span:first-child')+').textAlign'),'center');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-table-head > span:nth-child(3)')+').textAlign'),'center');
  assert.equal(await evaluate('(()=>{const h='+q('.page-heading')+'.getBoundingClientRect(),b='+q('.resource-check-updates')+'.getBoundingClientRect(),d='+q('.page-heading p')+'.getBoundingClientRect();return b.bottom<=h.bottom&&Math.abs(b.bottom-d.bottom)<2})()'),true,'action aligned with description above separator');
  assert.equal(await evaluate('(()=>{const l='+q('.resource-installed-list')+'.getBoundingClientRect(),r='+q('.resource-installed-detail')+'.getBoundingClientRect();return Math.abs(r.top-l.top)<1})()'),true,'detail starts alongside table');
  await input(base+' .resource-search input',first);await until('document.querySelectorAll('+JSON.stringify(base+' .resource-pack-row')+').length===1');
  assert.equal(await evaluate('(()=>{const l='+q('.resource-installed-list')+'.getBoundingClientRect(),r='+q('.resource-pack-row')+'.getBoundingClientRect();return Math.abs(l.bottom-r.bottom)<=1})()'),true,'filtered list ends at the final row');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-pack-row')+').borderBottomLeftRadius'),'7px');
  assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(base+' .resource-provider img')+').length'),1,'provider cells use official logos');
  if(kind==='mod' && await evaluate(q('.resource-pack-icon img')+'!==null')) {
   await until(q('.resource-pack-icon img')+'.complete');assert.equal(await evaluate(q('.resource-pack-icon img')+'.naturalWidth>0'),true,'installed icon decodes');
   assert.equal(await evaluate(q('.resource-large-icon')+'===null'),true,'installed detail has no redundant large icon');
  }
  await click(base+' .resource-check-updates');await until(q('.resource-update-summary')+"?.getAttribute('data-update-status')==='update'");await click(base+' .resource-enable');await until(q('.resource-enable')+"?.getAttribute('aria-checked')==='false'");assert.equal(await evaluate(q('.resource-update-summary')+"?.getAttribute('data-update-status')"),'update','toggle retains update status immediately');assert.ok(await evaluate(q('.resource-format')+"?.textContent.includes('Güncelleme var')"),'toggle retains update badge')
  assert.equal(await evaluate('getComputedStyle('+q('.resource-pack-select')+').opacity'),'0.55','disabled content is dimmed');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-provider')+',"::before").width'),'1px','provider divider');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-provider')+',"::before").top'),'-12px','divider fills row padding');assert.equal(await evaluate('getComputedStyle('+q('.resource-format')+',"::before").width'),'1px','separator left of version values');assert.equal(await evaluate('getComputedStyle('+q('.resource-table-head > span:last-child')+',"::before").content'),'none','headers have no vertical lines');assert.equal(await evaluate('getComputedStyle('+q('.resource-check-updates')+').backgroundColor'),'rgb(45, 121, 80)','standard green update check');assert.equal(await evaluate('getComputedStyle('+q('.resource-update-button')+').backgroundColor'),'rgb(45, 121, 80)','standard green update action');assert.equal(await evaluate('(()=>{const r='+q('.resource-installed-detail')+'.getBoundingClientRect(),s='+q('.resource-update-summary')+'.getBoundingClientRect();return r.bottom-s.bottom<=17})()'),kind==='shader'?false:true,'compact detail footer');assert.equal(await evaluate(q('.resource-detail-separator')+'!==null'),true,'description separator');
  assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(base+' .resource-installed-detail dt svg')+').length'),4,'detail label icons');
  assert.equal(await evaluate('[...document.querySelectorAll('+JSON.stringify(base+' .resource-installed-detail dt')+')].every(e=>!e.textContent.endsWith(":"))'),true,'installed detail labels have no colons');
  assert.equal(await evaluate(q('.resource-detail-provider img')+'!==null'),true,'provider branding in details');
  const link=await evaluate(q('.resource-title-link')+'!==null');if(link){await click(base+' .resource-title-link');assert.equal((await evaluate('window.launcher.getState()')).qaResourceRequests.filter(r=>r.channel==='external-link').at(-1).url,kind==='resourcepack'?'https://modrinth.com/resourcepack/fresh-animations':'https://modrinth.com/mod/fixture')}
  for(const selector of ['.resource-file-link',...(link?['.resource-title-link']:[])]){const rect=await evaluate(q(selector)+'.getBoundingClientRect().toJSON()');await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+rect.width/2,y:rect.y+rect.height/2});assert.equal(await evaluate('getComputedStyle('+q(selector === '.resource-title-link' ? selector+' > span' : selector)+').textDecorationLine'),'underline','detail text links underline on hover');if(selector === '.resource-title-link')assert.equal(await evaluate('getComputedStyle('+q(selector+' svg')+').borderBottomWidth'),'0px','external icon is not underlined')}
  await click(base+' .resource-file-link');const reveal=(await evaluate('window.launcher.getState()')).qaResourceRequests.filter(r=>r.channel==='reveal-content').at(-1);assert.equal(reveal.kind,kind);assert.equal(reveal.id,'qa-profile');assert.ok(reveal.filename.endsWith(kind==='mod'?'.jar.disabled':'.zip'));
  await click(base+' .resource-check-updates');await until(q('.resource-update-summary')+"?.getAttribute('data-update-status')==='update'")
  assert.equal(await evaluate(q('.resource-format')+'?.textContent.includes('+JSON.stringify(kind==='resourcepack'?'1.9.0':'1.0')+')'),true,'installed version remains visible beside update indication');
  assert.equal(await evaluate(q('.resource-update-summary')+'?.textContent.includes('+JSON.stringify((kind==='resourcepack'?'1.9.0':'1.0')+' → 2.0')+')'),true)
  await shot('qa-profile-content-'+kind+'-installed')
  await until(q('.resource-update-button')+'?.disabled===false');await click(base+' .resource-update-button');await until(q('.resource-installed-detail dd:nth-child(4)')+"?.textContent==='2.0'")
  assert.equal(await evaluate(q('.resource-enable')+"?.getAttribute('aria-checked')"),'false','updates preserve disabled state')
  await click(base+' .resource-check-updates');await until(q('.resource-update-summary')+"?.getAttribute('data-update-status')==='current'")
  await input(base+' .resource-search input','Local');await until(q('.resource-update-summary')+"?.getAttribute('data-update-status')==='unknown'");assert.equal(await evaluate(q('.resource-update-button')+'===null'),true)
  await input(base+' .resource-search input','');await click(base+' .resource-mode-bar [role=tab]:last-child');await until(q('.resource-download-summary dd')+'?.textContent==='+JSON.stringify(filename))
  assert.equal(await evaluate('[...document.querySelectorAll('+JSON.stringify(base+' .mods-source-nav button')+')].map(b=>b?.textContent.trim()).join(",")'),'Modrinth,CurseForge')
  assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(base+' .mods-source-nav button img')+').length'),2,'catalog source buttons use provider icons');
  assert.equal(await evaluate("document.querySelectorAll('.modal-backdrop').length"),0)
  assert.equal(await evaluate(q('.mods-detail-meta')+'?.textContent.includes("CC-BY-NC")'),true,'license and update header');
  assert.equal(await evaluate('getComputedStyle('+q('.mods-detail-meta')+').borderTopWidth'),'1px');
  assert.equal(await evaluate('getComputedStyle('+q('.mods-detail-meta')+').borderBottomWidth'),'1px');
  assert.equal(await evaluate('getComputedStyle('+q('.mods-hit-copy small')+').color'),'rgb(169, 186, 196)','shared description color');
  assert.equal(await evaluate('getComputedStyle('+q('.mods-hit-copy em')+').color'),'rgb(136, 189, 160)','shared author and download color');
  assert.equal(await evaluate(q('.mods-source-nav')+'.getBoundingClientRect().height<200'),true,'compact source card');
  assert.equal(await evaluate('getComputedStyle('+q('.resource-install-button')+').backgroundColor'),'rgb(45, 121, 80)','shared green install action');
  assert.equal(await evaluate(q('.resource-install-button')+'.getBoundingClientRect().width<'+q('.mods-detail')+'.getBoundingClientRect().width/2'),true,'compact install action');
  assert.equal(await evaluate('(()=>{const a='+q('.resource-install-button')+'.getBoundingClientRect(),b='+q('.resource-download-summary')+'.getBoundingClientRect();return Math.abs(a.right-b.right)<2})()'),true,'install aligned right');
  assert.equal(await evaluate(q('.mods-load-more')+'===null'),true,'no manual pagination');
  assert.equal(await evaluate('(()=>{const a='+q('.resource-install-button')+'.getBoundingClientRect(),b='+q('.mods-detail')+'.getBoundingClientRect();return a.bottom<=b.bottom&&a.top>=b.top})()'),true,'install remains visible inside catalog detail');
  await evaluate('(()=>{const list='+q('.mods-results')+';list.scrollTop=list.scrollHeight;for(let i=0;i<5;i++)list.dispatchEvent(new Event("scroll"))})()');await until('document.querySelectorAll('+JSON.stringify(base+' .mods-hit')+').length===18');
  const pages=(await evaluate('window.launcher.getState()')).qaResourceRequests.filter(r=>r.channel==='launcher:search-mods'&&r.args[6]===kind&&r.args[4]===9);assert.equal(pages.length,1,'scroll requests coalesce');
  await shot('qa-profile-content-'+kind+'-browse');
  const last=(await evaluate('window.launcher.getState()')).qaResourceRequests.filter(r=>r.channel==='launcher:search-mods').at(-1);assert.equal(last.args[6],kind);if(kind==='mod')assert.equal(last.args[2],'fabric')
  await until(q('.resource-install-button'));await click(base+' .resource-install-button');await until(q('.resource-install-button')+"?.textContent.includes('Kurulu')")
  await click(base+' .resource-mode-bar [role=tab]:first-child');await until(q('.resource-pack-row'))
 }
 await nav('Shader paketleri');await input(base+' .resource-search input','');await until(q('.resource-pack-row'))
 await click(base+' .resource-enable:not([aria-checked=true])');await until('document.querySelectorAll('+JSON.stringify(base+' .resource-enable[aria-checked=true]')+').length===1')
 await evaluate("window.launcher.saveSettings({qaResource:{failCheck:true}})");await click(base+' .resource-check-updates');await until(q('.resource-update-summary')+"?.getAttribute('data-update-status')==='error'");assert.equal(await evaluate(q('.resource-update-summary')+"?.textContent.includes('Fixture provider unavailable')"),true);await evaluate("window.launcher.saveSettings({qaResource:{failCheck:false}})")
 for(const language of ['tr','en','de','fr','ru','pl']) {
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await call('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
  for(const [index,kind] of [[2,'mod'],[3,'resourcepack'],[4,'shader']]) {
   await evaluate('[...document.querySelectorAll(".profile-workspace-nav button")]['+index+'].click()');await until('document.querySelector('+JSON.stringify(base)+')?.getAttribute("data-content-kind")==='+JSON.stringify(kind))
   await until(q('.resource-pack-row'))
   assert.equal(await evaluate('document.querySelector('+JSON.stringify(base)+')?.scrollWidth<=document.querySelector('+JSON.stringify(base)+')?.clientWidth'),true,language+' '+kind+' installed fits')
   assert.equal(await evaluate(q('.resource-check-updates')+'?.scrollWidth<='+q('.resource-check-updates')+'?.clientWidth'),true,language+' update button fits')
   await click(base+' .resource-mode-bar [role=tab]:last-child');await until(q('.resource-download-summary'))
   assert.equal(await evaluate('document.querySelector('+JSON.stringify(base)+')?.scrollWidth<=document.querySelector('+JSON.stringify(base)+')?.clientWidth'),true,language+' '+kind+' browse fits')
   assert.equal(await evaluate('(()=>{const a='+q('.resource-install-button')+'.getBoundingClientRect(),b='+q('.mods-detail')+'.getBoundingClientRect();return a.bottom<=b.bottom&&a.top>=b.top})()'),true,language+' '+kind+' install visible')
  }
 }
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.launch-profile-edit')");await click('.launch-profile-edit');await click('.profile-workspace-back');await until("document.querySelector('.profile-card')");await evaluate("[...document.querySelectorAll('.profile-card')].find(e=>e.querySelector('h3')?.textContent==='Test World 2').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");await nav('Shader paketleri');await until(q('.resource-pack-row')+"?.textContent.includes('Other profile')");assert.equal(await evaluate('document.querySelectorAll('+JSON.stringify(base+' .resource-pack-row')+').length'),1);assert.equal(await evaluate('window.launcher.getState().then(s=>s.selectedProfileId)'),'qa-profile')
 await click('.profile-workspace-back');await until("document.querySelector('.profile-card')");await evaluate("[...document.querySelectorAll('.profile-card')].find(e=>e.querySelector('h3')?.textContent==='Test World').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await nav('Modlar')
 await evaluate("window.launcher.saveSettings({qaResource:{extraMods:24}})");await nav('Dünyalar');await nav('Modlar');await until('document.querySelectorAll('+JSON.stringify(base+' .resource-pack-row')+').length>=24')
 assert.equal(await evaluate('(()=>{const a='+q('.resource-installed-detail')+',b='+q('.resource-installed-list')+';return a.getBoundingClientRect().height < b.getBoundingClientRect().height/2})()'),true,'selected card stays content-sized beside a long mod list')
 await shot('qa-profile-mod-details-long-list')
 await evaluate("window.launcher.saveSettings({qaResource:{extraMods:0}})")
 const updateChecks=(await evaluate('window.launcher.getState()')).qaResourceRequests.filter(r=>r.channel==='check-updates');assert.ok(updateChecks.some(r=>r.force===false),'automatic checks request cached results');assert.ok(updateChecks.some(r=>r.force===true),'manual checks request fresh results')
 await click(base+' .resource-mode-bar [role=tab]:last-child');await until(q('.mods-source-nav'));await click(base+' .mods-source-nav > button:last-child');await until(q('.provider-connection-state'))
 assert.equal(await evaluate('getComputedStyle('+q('.provider-connection-state')+').backgroundColor'),'rgb(13, 17, 23)','unconfigured CurseForge uses the neutral dark surface')
 await click(base+' .provider-connection-state .heading-action');await until("document.querySelector('.provider-connect-dialog')")
 assert.equal(await evaluate("document.querySelectorAll('.provider-connect-dialog .account-dialog-symbol').length"),0,'no connection heading icon or background')
 assert.equal(await evaluate("document.querySelectorAll('.curseforge-connect-actions button').length"),1,'only the Connect action remains')
 assert.equal(await evaluate("document.querySelector('.provider-key-label input').type"),'password');assert.equal(await evaluate("document.querySelector('.curseforge-connect-actions button').disabled"),true)
 assert.equal(await evaluate("(()=>{const r=document.querySelector('.provider-connect-dialog').getBoundingClientRect(),b=document.querySelector('.curseforge-connect-actions button').getBoundingClientRect();return r.bottom-b.bottom<=18})()"),true,'compact connection footer')
 await shot('qa-curseforge-connection-polish')
 await input('.provider-key-label input','QA_REJECTED_VALUE_NOT_A_CREDENTIAL');await click('.curseforge-connect-actions button');await until("document.querySelector('.provider-connect-error')")
 assert.equal(await evaluate("document.querySelector('.provider-connect-error').textContent.includes('QA_REJECTED')"),false,'provider errors never echo credentials')
 for(const language of ['tr','en','de','fr','ru','pl']){await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');assert.equal(await evaluate("(()=>{const d=document.querySelector('.provider-connect-dialog'),r=d.getBoundingClientRect();return d.scrollWidth<=d.clientWidth&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"),true,language+' connection dialog fits')}
 await click('.provider-connect-dialog .modal-close');await until("!document.querySelector('.provider-connect-dialog')");await evaluate("window.launcher.saveSettings({language:'tr'})")
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS profile Mods/Resources/Shaders installed lists, disabled updates and unknown/error/current states, provider/version/file review, inline installs, single shader selection, six languages at 1080x700 and profile ownership; isolated in-memory catalogs')
} finally {socket.close()}
`
await new Function('assert', 'writeFileSync', 'return (async()=>{' + helpers + checks + '})()')(assert, writeFileSync)
