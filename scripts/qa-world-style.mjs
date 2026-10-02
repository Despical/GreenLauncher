import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 const style = selector => evaluate('(()=>{const s=getComputedStyle(document.querySelector('+JSON.stringify(selector)+'));return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,color:s.color}})()')
 for(const language of ['tr','en','de','fr','ru','pl']){
  await evaluate('window.launcher.saveSettings({language:'+JSON.stringify(language)+'})');await call('Page.reload');await until("document.querySelector('.side-nav')")
  for(const width of [960,1080,1280,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
   await key('4');await until("document.querySelector('.retained-page:not([hidden]) .server-online small')")
   const prefix='.retained-page:not([hidden]) '
   const players=await style(prefix+'.server-online small'),address=await style(prefix+'.server-address')
   const primary=await style(prefix+'.server-player-count dd'),secondary=await style(prefix+'.server-address-detail dd')
   const playerWidth=await evaluate("document.querySelector('.retained-page:not([hidden]) .server-online').getBoundingClientRect().width")
   await key('5');await until("document.querySelector('.retained-page:not([hidden]) .world-select')")
   assert.deepEqual(await style(prefix+'.world-select>span:nth-child(2)'),players)
   assert.deepEqual(await style(prefix+'.world-select>span:nth-child(3)'),address)
   assert.deepEqual(await style(prefix+'.world-select>span:nth-child(4)'),address)
   assert.deepEqual(await style(prefix+'.server-facts>div:first-child dd'),primary)
   assert.deepEqual(await style(prefix+'.server-facts>div:nth-child(2) dd'),secondary)
   assert.deepEqual(await style(prefix+'.server-facts>div:nth-child(3) dd'),secondary)
   assert.deepEqual(await style(prefix+'.server-facts>div:nth-child(4) dd'),secondary)
   const columns=await evaluate("(()=>{const row=document.querySelector('.retained-page:not([hidden]) .world-select'),cells=[...row.children].map(e=>e.getBoundingClientRect().width),panel=row.closest('.servers-list-panel');return {cells,fits:row.getBoundingClientRect().right<=panel.getBoundingClientRect().right+1}})()")
   assert.equal(columns.cells[1],playerWidth,language+' game mode matches player column at '+width)
   assert.ok(columns.cells[2]>=136&&columns.cells[3]>=82)
   assert.ok(columns.fits,language+' world columns fit at '+width)
   if(language==='tr'&&width===1440)await shot('qa-world-matching-type')
  }
  await key('9');await click('[role=tab]:last-child');await until("document.querySelector('.launcher-update-panel')")
  const landscape=await evaluate("(()=>{const card=document.querySelector('.launcher-update-panel'),s=getComputedStyle(card,'::before');return {width:parseFloat(s.width),height:parseFloat(s.height),cardWidth:card.clientWidth,cardHeight:card.clientHeight,background:s.backgroundSize}})()")
  assert.equal(landscape.width,landscape.cardWidth);assert.equal(landscape.height,landscape.cardHeight)
  assert.match(landscape.background,/cover/)
  if(language==='tr'){await evaluate("document.querySelector('.launcher-update-settings').scrollIntoView({block:'end'})");await shot('qa-about-full-landscape')}
 }
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS world/table and sidebar typography matches servers, game/player widths match, wider metadata fits four widths in six languages, About landscape fills its entire card')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
