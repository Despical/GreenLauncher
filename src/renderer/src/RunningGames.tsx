import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, MonitorPlay, Play } from 'lucide-react'
import type { RunningInstance } from '../../shared/types'
import { AccountDialog } from './AccountControls'
import vanilla from '../assets/minecraft-release.png'
import optifine from '../assets/optifine-mark.png'
import fabric from '../assets/loaders/fabric.png'
import forge from '../assets/loaders/forge.svg'
import neoforge from '../assets/loaders/neoforge.svg'
import quilt from '../assets/loaders/quilt.svg'
import liteloader from '../assets/loaders/liteloader.svg'

type T = (source: string, values?: Record<string, string | number>) => string
const icons = { optifine, fabric, forge, neoforge, quilt, liteloader }
const names = { optifine: 'OptiFine', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', liteloader: 'LiteLoader' }

export function InstanceList({ instances }: { instances: RunningInstance[] }) {
  return <div className="running-instance-list">{instances.map(instance => <div className="running-instance" key={instance.id}><img src={instance.loader ? icons[instance.loader] : vanilla} alt={instance.loader ? names[instance.loader] : 'Minecraft'} /><div><strong>{instance.profileName}</strong><span>{instance.accountName} · {instance.loader ? names[instance.loader] : 'Minecraft'}</span><small>{instance.versionId}</small></div><span className="running-indicator" /></div>)}</div>
}

export function RunningPlayButton({ instances, disabled, preparing, onPlay, t, compact = false }: { instances: RunningInstance[]; disabled: boolean; preparing?: boolean; onPlay: () => void; t: T; compact?: boolean }) {
  const button = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const id = useId()
  const show = () => {
    window.clearTimeout(closeTimer.current)
    if (!instances.length || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const height = Math.min(340, 55 + instances.length * 80)
    setPosition({ left: Math.min(window.innerWidth - 352, Math.max(12, rect.left)), top: rect.bottom + height + 12 < window.innerHeight - 28 ? rect.bottom + 9 : Math.max(45, rect.top - height - 9) })
  }
  const hide = () => { closeTimer.current = window.setTimeout(() => setPosition(null), 100) }
  useEffect(() => {
    const close = () => setPosition(null)
    window.addEventListener('resize', close)
    return () => { window.clearTimeout(closeTimer.current); window.removeEventListener('resize', close) }
  }, [])
  return <><button ref={button} className={`${compact ? 'profile-play' : 'play-button'} ${instances.length ? 'has-running-games' : ''}`} disabled={disabled} aria-describedby={position && instances.length ? id : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setPosition(null); onPlay() }}>{preparing ? <LoaderCircle size={compact ? 16 : 19} className="spin" /> : instances.length ? <MonitorPlay size={compact ? 16 : 20} /> : <Play size={compact ? 16 : 19} fill="currentColor" />}{preparing ? t('Hazırlanıyor...') : instances.length ? t('Tekrar oyna') : compact ? t('Oyna') : t('OYNA')}</button>
    {position && instances.length > 0 && createPortal(<div id={id} role="tooltip" className="running-games-popover" style={position} onMouseEnter={() => window.clearTimeout(closeTimer.current)} onMouseLeave={hide}><h3>{t('Çalışan oyunlar ({count})', { count: instances.length })}</h3><InstanceList instances={instances} /></div>, document.body)}
  </>
}

export function LaunchConfirmation({ instances, t, onConfirm, onCancel, pending }: { instances: RunningInstance[]; t: T; onConfirm: () => void; onCancel: () => void; pending: boolean }) {
  return <AccountDialog title={t('Yeni bir oyun açılsın mı?')} description={t('Zaten çalışan oyun oturumların var. Yine de yeni bir oturum açmak istiyor musun?')} closeLabel={t('Kapat')} onClose={onCancel} locked={pending} icon={null} className="launch-confirm-dialog">
    <InstanceList instances={instances} />
    <div className="account-dialog-footer"><button type="button" className="account-cancel-button" onClick={onCancel} disabled={pending}>{t('Vazgeç')}</button><button type="button" className="account-create-button" onClick={onConfirm} disabled={pending}>{pending ? <LoaderCircle size={17} className="spin" /> : <Play size={17} />}{t('Yine de başlat')}</button></div>
  </AccountDialog>
}
