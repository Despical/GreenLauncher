import {evaluate,close} from './qa-accounts-cdp.mjs'
try {
 await evaluate("window.launcher.createOfflineAccount('AnimSample')")
 await new Promise(r=>setTimeout(r,200))
 await evaluate("document.querySelector('.managed-account.selected .account-remove-button').click()")
 await new Promise(r=>setTimeout(r,300))
 console.log(await evaluate("(async()=>{const row=document.querySelector('.managed-account.selected').closest('.managed-account-presence');const samples=[];const start=performance.now();row.querySelector('.account-confirm-danger').click();for(let i=0;i<22;i++){await new Promise(requestAnimationFrame);samples.push({t:Math.round(performance.now()-start),connected:row.isConnected,leaving:row.classList.contains('leaving'),opacity:getComputedStyle(row).opacity,height:row.getBoundingClientRect().height})}return samples})()"))
}finally{close()}
