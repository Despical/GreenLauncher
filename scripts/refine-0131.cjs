const fs = require('node:fs')
const file = 'src/renderer/src/ModsPage.tsx'
let source = fs.readFileSync(file, 'utf8')
source = source.replace("import { AccountDialog } from './AccountControls'\n", '')
for (const name of ['connectionOpen', 'apiKey', 'connecting', 'connectionError']) source = source.replace(new RegExp('  const \\[' + name + ',[^\\n]+\\n'), '')
source = source.replace(/  const connect = async \(\) => \{[\s\S]+?\n  \}\n/, '')
source = source.replace(/    \{connectionOpen && <AccountDialog[\s\S]+?<\/AccountDialog>\}\n/, '')
const old = '<div className="provider-connection-state"><img src={curseforgeIcon} alt="" /><h3>{t(\'CurseForge bağlantısı\')}</h3><p>{t(\'CurseForge kataloğu için uygulama bağlantısını yapılandır.\')}</p><button className="heading-action primary" onClick={()=>setConnectionOpen(true)}>{t(\'Bağlantıyı yapılandır\')}</button></div>'
if (!source.includes(old)) throw Error('Expected connection state missing')
source = source.replace(old, '<div className="provider-connection-state"><img src={curseforgeIcon} alt="" /><h3>{t(\'CurseForge bağlantısı hazır değil\')}</h3><p>{t(\'Uygulama içi katalog bu sürümde kullanılamıyor. Modları ve paketleri resmî siteden inceleyebilirsin.\')}</p><button className="heading-action primary" onClick={()=>window.launcher.openExternal(\'https://www.curseforge.com/minecraft/search?class=mc-mods\').catch(error=>onNotice(String(error)))}>{t(\'CurseForge’da keşfet\')} <ArrowRight size={16}/></button></div>')
source = source.replace('<section className="mods-main">', '<section className={`mods-main ${source === \'curseforge\' && !connected ? \'provider-unavailable\' : \'\'}`}>')
source = source.replace('<div className="mods-type-row">', '<div className={`mods-type-row ${source === \'technic\' ? \'mods-type-count-only\' : \'\'}`}>')
// The outer condition already excludes Technic; retain exactly two meaningful tabs.
source = source.replace("{source !== 'technic' && <button role=\"tab\"", '<button role="tab"').replace("{t('Modlar')}</button>}<button", "{t('Modlar')}</button><button")
fs.writeFileSync(file, source)
const pkg = JSON.parse(fs.readFileSync('package.json','utf8')); pkg.version = '0.13.1'; fs.writeFileSync('package.json', JSON.stringify(pkg,null,2)+'\n')
