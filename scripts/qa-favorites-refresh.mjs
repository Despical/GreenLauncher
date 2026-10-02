import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
const helpers=readFileSync('scripts/qa-servers-custom.mjs','utf8').split('try {')[0].replace(/^import[^\n]*\n/gm,'')
const checks=String.raw`
try {
 await call('Runtime.enable');await call('Page.reload');await until("document.querySelector('.side-nav')");await nav('Modlar');await until("document.querySelector('.mods-source-nav')");await click('.mods-source-nav button:nth-of-type(2)');await until("document.querySelector('.mods-favorite')")
 await click('.mods-favorite');await until("document.querySelector('.mods-favorite').getAttribute('aria-pressed')==='true'")
 await button('Favoriler');await until("document.querySelector('.mods-hit').textContent.includes('876')")
 const favorite=await evaluate("document.querySelector('.mods-hit').textContent");assert.match(favorite,/Fresh catalog metadata/)
 const stored=await evaluate("window.launcher.getModFavorites()");assert.equal(stored[0].downloads,876543)
 await button('Modlar');await until("document.querySelector('.mods-hit').textContent.includes('876')");await until("document.querySelector('.mods-detail-top small').textContent.includes('876')")
 assert.ok(await evaluate("document.querySelector('.mods-hit').textContent.includes('876')"))
 await button('Favoriler');await until("document.querySelector('.mods-favorite')");await click('.mods-favorite');await until("document.querySelector('.mods-favorites-empty')")
 await shot('qa-0177-favorites-refreshed')
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS favorite metadata refresh event updates counts and descriptions, normal catalog uses the same count, details load after tab switches and removal stays removed')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
