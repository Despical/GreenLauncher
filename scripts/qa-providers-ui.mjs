import {evaluate,send,shot,close} from './qa-accounts-cdp.mjs'
const pause = ms => new Promise(r=>setTimeout(r,ms))
async function click(text) { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button: '+${JSON.stringify(text)});b.click()})()`); await pause(350) }
try {
  await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled',{enabled:true})
  await send('Emulation.setDeviceMetricsOverride',{width:1080,height:700,deviceScaleFactor:1,mobile:false})
  await click('Ayarlar'); await click('Java'); await shot('qa-013-java-general')
  await click('Kurulumlar'); await pause(1200); await shot('qa-013-java-installations')
  await evaluate(`document.querySelector('.statusbar-changelog').click()`); await pause(350); await shot('qa-013-changelog')
  console.log('Changelog:',await evaluate(`document.querySelector('[role=dialog]').innerText`))
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'}); await pause(300)
  await click('Modlar'); await click('Technic'); await pause(4500); await shot('qa-013-technic')
  console.log('Technic:',await evaluate(`document.querySelector('.mods-page')?.innerText ?? document.body.innerText`))
  await click('CurseForge'); await shot('qa-013-curseforge')
  console.log('CurseForge:',await evaluate(`document.querySelector('.mods-page')?.innerText ?? document.body.innerText`))
} finally { close() }
