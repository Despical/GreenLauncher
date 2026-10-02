import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, FileText, Github, Info } from 'lucide-react'
import { translate, type Language } from './i18n'
import { DiscordIcon } from './DiscordIcon'
import logo from '../../../build/launcher-mark.png'

export function LauncherMenu({ language, version, onAbout, onOpen }: { language: Language; version: string; onAbout: () => void; onOpen: (url: string) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const t = (source: string) => translate(language, source)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const external = (url: string) => { setOpen(false); onOpen(url) }
  return <div className="launcher-brand-menu" ref={root}>
    <button ref={trigger} type="button" className="brand" aria-label="Green Launcher" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()) } }}><img src={logo} alt="" draggable={false} /><div><strong>Green</strong><span>Launcher</span></div></button>
    {open && <div className="launcher-links-menu" role="menu" aria-label="Green Launcher" onKeyDown={event => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]')); const index = items.indexOf(document.activeElement as HTMLButtonElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }}>
      <div className="launcher-links-heading"><strong>Green Launcher</strong><span>v{version} · Despical</span></div><div className="launcher-links-divider" role="separator" />
      <button role="menuitem" onClick={() => external('https://greenlauncher.org')}><img className="launcher-community-icon" src={logo} alt="" draggable={false} /><span>{t('Web sitesi')}</span><ArrowUpRight size={15} /></button>
      <button role="menuitem" onClick={() => external('https://discord.gg/uXVU8jmtpU')}><DiscordIcon size={18} className="launcher-community-icon" /><span>{t('Discord topluluğu')}</span><ArrowUpRight size={15} /></button>
      <div className="launcher-links-divider" role="separator" />
      <button role="menuitem" onClick={() => external('https://github.com/Despical/GreenLauncher')}><Github size={17} /><span>{t('Kaynak kodu')}</span><ArrowUpRight size={15} /></button>
      <button role="menuitem" onClick={() => external('https://www.gnu.org/licenses/gpl-3.0.html')}><FileText size={17} /><span>{t('Lisans')}</span><ArrowUpRight size={15} /></button>
      <button role="menuitem" onClick={() => { setOpen(false); onAbout() }}><Info size={17} /><span>{t('Hakkında')}</span></button>
    </div>}
  </div>
}
