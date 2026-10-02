import { ArrowUpRight, Github, Info } from 'lucide-react'
import { translate, type Language } from './i18n'
import { DiscordIcon } from './DiscordIcon'
import logo from '../../../build/launcher-mark.png'
import landscape from '../assets/green-landscape.png'

export function AboutPanel({ version, language, onOpen }: { version: string; language: Language; onOpen: (url: string) => void }) {
  const t = (source: string) => translate(language, source)
  return <section className="settings-panel settings-tab-panel launcher-about" role="tabpanel">
    <header className="launcher-about-hero" style={{ backgroundImage: `linear-gradient(90deg,#141b24df,#141b24b9),url("${landscape}")` }}><img src={logo} alt="" draggable={false} /><div><h3>Green Launcher</h3><p>Minecraft: Java Edition</p></div></header>
    <p className="launcher-about-intro">{t('Green Launcher, Despical tarafından geliştirilmiş bağımsız bir Minecraft: Java Edition başlatıcısıdır.')}</p>
    <dl className="launcher-about-facts"><div><dt>{t('Geliştirici')}</dt><dd><button onClick={() => onOpen('https://github.com/Despical')}>Despical <ArrowUpRight size={15} /></button></dd></div><div><dt>{t('Uygulama sürümü')}</dt><dd>v{version}</dd></div><div><dt>{t('Lisans')}</dt><dd><button onClick={() => onOpen('https://www.gnu.org/licenses/gpl-3.0.html')}>GNU GPL v3 <ArrowUpRight size={14} /></button></dd></div></dl>
    <div className="launcher-about-links"><div><button onClick={() => onOpen('https://greenlauncher.org')}><img className="launcher-about-link-icon" src={logo} alt="" draggable={false} /><span><strong>{t('Web sitesi')}</strong><small>greenlauncher.org</small></span><ArrowUpRight size={18} /></button></div><div><button onClick={() => onOpen('https://github.com/Despical/GreenLauncher')}><Github size={24} /><span><strong>{t('Kaynak kodu')}</strong><small>github.com/Despical/GreenLauncher</small></span><ArrowUpRight size={18} /></button></div><div><button onClick={() => onOpen('https://discord.gg/uXVU8jmtpU')}><DiscordIcon className="launcher-about-link-icon" /><span><strong>{t('Discord topluluğu')}</strong><small>{t('Destek, duyurular ve topluluk.')}</small></span><ArrowUpRight size={18} /></button></div></div>
    <p className="launcher-about-note"><Info size={17} aria-hidden="true" /><span>{t('Green Launcher, Mojang Studios veya Microsoft ile bağlantılı değildir ve resmî bir Minecraft ürünü değildir.')}</span></p>
  </section>
}
