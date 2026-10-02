import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers=readFileSync('scripts/qa-servers-custom.mjs','utf8').split('try {')[0].replace(/^import[^\n]*\n/gm,'')
const checks=String.raw`
try {
  await call('Runtime.enable');await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.side-nav')")
  for(const width of [1920,1280,1080]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false})
    await key('8');await button('Java');await button('Genel')
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.java-memory-scale span')].map(e=>e.textContent)"),['1 GB','4 GB','8 GB','12 GB','16 GB'])
    for(const gb of [4,8,12]) {
      const position=await evaluate('(()=>{const e=[...document.querySelectorAll(".java-memory-scale span")].find(e=>e.textContent==='+JSON.stringify(gb+' GB')+');const r=e.getBoundingClientRect();const i=document.querySelector(".java-memory-range").getBoundingClientRect();return {x:r.left+r.width/2,y:i.top+i.height/2}})()')
      await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...position});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...position});await wait(150)
      assert.equal(await evaluate("Number(document.querySelector('.java-memory-range').value)"),gb*1024,'Slider tick '+gb+'GB at '+width+'px')
    }
    await shot('qa-memory-scale-'+width)
  }
  console.log('PASS physical slider clicks at 4, 8 and 12 GB across three window widths')
  await button('Günlükler');await until("document.querySelectorAll('.journal-entry').length>2")
  await click('.journal-entry:nth-of-type(1) .log-record');await click('.journal-entry:nth-of-type(2) .log-record')
  assert.equal(await evaluate("document.querySelectorAll('.journal-entry.expanded').length"),2)
  await shot('qa-logs-multiple-expanded');await click('.journal-entry:nth-of-type(1) .log-record')
  assert.equal(await evaluate("document.querySelectorAll('.journal-entry.expanded').length"),1)
  console.log('PASS independent log expansion and collapse')
  await key('3');await until("[...document.querySelectorAll('.profile-version')].some(e=>e.textContent.includes('2 mod'))")
  const emptyName=await evaluate("window.launcher.getState().then(s=>s.profiles.find(p=>p.id==='qa-profile-2').name)")
  assert.equal(await evaluate("[...document.querySelectorAll('.profile-card')].find(e=>e.querySelector('h3').textContent==="+JSON.stringify(emptyName)+").querySelector('.profile-version').textContent.includes(' mod')"),false)
  await shot('qa-profile-card-mod-counts')
  console.log('PASS real fixture mod count on profile cards with no zero-mod suffix')
  for(const width of [1920,1280,1080]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await key('4');await until("document.querySelector('.server-motd>span')")
    const table=await evaluate("(()=>{const heads=[...document.querySelectorAll('.servers-table-head>span')],cells=[...document.querySelector('.server-select').children];const icon=cells[0].querySelector('.server-icon').getBoundingClientRect();return {heading:heads[0].textContent,headX:heads[0].getBoundingClientRect().left,iconX:icon.left,headSeparators:heads.slice(1).map(e=>getComputedStyle(e,'::before').content),separators:cells.slice(1).map(e=>{const s=getComputedStyle(e,'::before'),r=e.getBoundingClientRect(),b=e.closest('button').getBoundingClientRect();return {top:s.top,bottom:s.bottom,width:s.width,cellTop:r.top,cellBottom:r.bottom,rowTop:b.top,rowBottom:b.bottom}}),address:cells.at(-1).classList.contains('server-address'),inset:cells.at(-1).getBoundingClientRect().right-cells.at(-1).clientLeft,overflow:document.documentElement.scrollWidth>innerWidth}})()")
    assert.equal(table.heading,'Sunucu adı ve ikonu');assert.ok(Math.abs(table.headX+14-table.iconX)<1);assert.ok(table.headSeparators.every(s=>s==='none'));assert.ok(table.address&&!table.overflow)
    assert.ok(table.separators.every(s=>s.top==='-1px'&&s.bottom==='-1px'&&s.width==='1px'&&Math.abs(s.cellTop-s.rowTop)<1&&Math.abs(s.cellBottom-s.rowBottom)<1))
    await shot('qa-server-table-full-lines-'+width)
    await click('.server-management-actions button:nth-child(2)');await until("document.querySelector('.server-edit-dialog')");await click('.server-resource-select .dropdown-trigger');await until("document.querySelector('.server-resource-menu')")
    const dropdown=await evaluate("(()=>{const menu=document.querySelector('.server-resource-menu'),last=menu.querySelector('[role=option]:last-child'),r=last.getBoundingClientRect(),m=menu.getBoundingClientRect();return {portalled:!menu.closest('.account-dialog'),position:getComputedStyle(menu).position,weight:getComputedStyle(last.querySelector('strong')).fontWeight,triggerWeight:getComputedStyle(document.querySelector('.server-resource-select strong')).fontWeight,visible:last.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)),top:m.top,bottom:m.bottom,viewport:innerHeight}})()")
    assert.equal(dropdown.portalled,true);assert.equal(dropdown.position,'fixed');assert.equal(dropdown.weight,'500');assert.equal(dropdown.triggerWeight,'500');assert.ok(dropdown.visible&&dropdown.top>=0&&dropdown.bottom<=dropdown.viewport,JSON.stringify(dropdown))
    await shot('qa-server-resource-menu-'+width);await click('.server-resource-menu [role=option]:last-child');await until("!document.querySelector('.server-resource-menu')");await click('.server-edit-dialog .modal-close')
  }
  console.log('PASS icon/name at left, address at right, uninterrupted row separators and uncut medium-weight resource-pack menu')
  assert.equal(errors.length,0,JSON.stringify(errors))
} finally { socket.close() }
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
