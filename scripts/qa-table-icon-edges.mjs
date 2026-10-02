import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const helpers = readFileSync('scripts/qa-servers-custom.mjs', 'utf8').split('try {')[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await call('Runtime.enable');await until("document.querySelector('.side-nav')")
 await evaluate("window.launcher.saveSettings({language:'tr'})");await call('Page.reload');await until("document.querySelector('.side-nav')")
 for(const page of ['4','5']){
  await key(page);await until("document.querySelectorAll('.retained-page:not([hidden]) .server-row').length===2")
  for(const width of [960,1080,1280,1440]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false});await wait(100)
   const rows=await evaluate("[...document.querySelectorAll('.retained-page:not([hidden]) .server-row')].map(row=>{const icon=row.querySelector('.server-icon').getBoundingClientRect(),r=row.getBoundingClientRect(),select=row.querySelector('.server-select,.world-select'),next=select.children[1].getBoundingClientRect();return {left:icon.left-r.left,top:icon.top-r.top,bottom:r.bottom-icon.bottom,width:icon.width,separatorGap:next.left-icon.right,radius:getComputedStyle(row).borderBottomLeftRadius}})")
   for(const row of rows){assert.equal(row.left,9);assert.equal(row.top,1);assert.equal(row.bottom,1);assert.equal(row.width,74);assert.ok(row.separatorGap>=14,JSON.stringify(row))}
   assert.equal(rows.at(-1).radius,'9px')
  }
  await shot(page==='4'?'qa-server-left-edge':'qa-world-left-edge')
 }
 assert.equal(errors.length,0,JSON.stringify(errors))
 console.log('PASS server/world icons have an 8px inner left inset, keep their full row height, stay clear of column separators and preserve last-row corners at four widths')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
