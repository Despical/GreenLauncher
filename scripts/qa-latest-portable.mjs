import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

// Uses the actual portable EXE on port 9228. Leave its window open for review.
// Only navigate and check for updates; never change preferences or fixture state.
const helpers = readFileSync('scripts/qa-cape-final-portable.mjs', 'utf8').split(/try\s*\{\s*await send/)[0].replace(/^import[^\n]*\n/gm, '')
const checks = String.raw`
try {
 await send('Runtime.enable');await until("!!document.querySelector('.app-shell')")
 const before=await evaluate("window.launcher.getState().then(s=>JSON.stringify({settings:s.settings,accounts:s.accounts,profiles:s.profiles,selectedProfileId:s.selectedProfileId,selectedAccountId:s.selectedAccountId}))")
 await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'9',ctrlKey:true,bubbles:true}))")
 await until("!!document.querySelector('.settings-tabs')")
 await evaluate("document.querySelectorAll('.settings-tabs button')[0].click()")
 await until("!!document.querySelector('.launcher-update-settings')")
 await evaluate("document.querySelector('.launcher-update-settings').scrollIntoView({block:'end',behavior:'instant'})")
 assert.equal(await evaluate("document.querySelectorAll('.update-version').length"),0)
 assert.equal(await evaluate("document.querySelector('.launcher-update-settings .update-heading').textContent.includes('Güncelsin')"),false)
 await evaluate("document.querySelector('.launcher-update-settings .update-check').click()")
 await until("!document.querySelector('.launcher-update-settings .update-check').disabled")
 await until("!!document.querySelector('.toast')")
 const update=await evaluate("window.launcher.getUpdate()")
 assert.equal(update.phase,'current','live GitHub update check succeeds')
 assert.ok(update.checkedAt)
 const geometry=await evaluate("(()=>{const card=document.querySelector('.launcher-update-settings .launcher-update-panel'),stamp=document.querySelector('.launcher-update-settings .update-last-check');return {outside:!card.contains(stamp),below:stamp.getBoundingClientRect().top>=card.getBoundingClientRect().bottom,align:getComputedStyle(stamp).textAlign}})()")
 assert.deepEqual(geometry,{outside:true,below:true,align:'right'})
 const after=await evaluate("window.launcher.getState().then(s=>JSON.stringify({settings:s.settings,accounts:s.accounts,profiles:s.profiles,selectedProfileId:s.selectedProfileId,selectedAccountId:s.selectedAccountId}))")
 assert.equal(after,before,'existing preferences, accounts and profiles are preserved')
 assert.deepEqual(errors,[])
 const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
 writeFileSync('build/qa-latest-portable.png',Buffer.from(screenshot.data,'base64'))
 writeFileSync('build/qa-latest-portable.json',JSON.stringify({passed:true,window:tab.title,liveUpdateCheck:update.phase,version:update.currentVersion,lastCheckOutsideCard:true,userDataPreserved:true,rendererExceptions:errors},null,2))
 console.log('PASS latest portable EXE opens with redesigned update card, no version badge, successful live update check and toast, external right-aligned timestamp; preferences/accounts/profiles preserved; window left open')
}finally{socket.close()}
`
await new Function('assert','writeFileSync','return (async()=>{'+helpers+checks+'})()')(assert,writeFileSync)
