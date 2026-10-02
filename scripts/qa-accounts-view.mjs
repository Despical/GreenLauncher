import {send,evaluate,shot,close} from './qa-accounts-cdp.mjs'
await send('Page.bringToFront')
await send('Emulation.setFocusEmulationEnabled',{enabled:true})
await new Promise(r=>setTimeout(r,1200))
console.log(await evaluate('({dialog:document.querySelector("[role=dialog]")?.textContent,avatar:document.querySelector(".player-avatar img")?.naturalWidth})'))
await shot('qa-accounts-manager-visible')
close()
