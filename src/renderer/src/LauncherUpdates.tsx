import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { LauncherUpdate } from '../../shared/types'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import packageJson from '../../../package.json'
import './updates.css'

export function useLauncherUpdate() {
  const [update, setUpdate] = useState<LauncherUpdate>({ phase: 'idle', currentVersion: packageJson.version, portable: false })
  const revision = useRef(0)
  const [checkResult, setCheckResult] = useState<{ value: LauncherUpdate } | null>(null)
  useEffect(() => {
    const before = revision.current
    void window.launcher.getUpdate().then(value => { if (revision.current === before) setUpdate(value) }).catch(() => {})
    return window.launcher.on('update', value => { revision.current++; setUpdate(value) })
  }, [])
  const action = async (kind: 'check' | 'download' | 'cancel' | 'install') => {
    try {
      const value = await ({ check: window.launcher.checkUpdate, download: window.launcher.downloadUpdate, cancel: window.launcher.cancelUpdate, install: window.launcher.installUpdate })[kind]()
      revision.current++; setUpdate(value)
      if (kind === 'check') setCheckResult({ value })
    } catch (error) {
      if (kind === 'check') setCheckResult({ value: { ...update, phase: 'error', error: 'network' } })
      throw error
    }
  }
  return { update, action, checkResult }
}
type Controls = ReturnType<typeof useLauncherUpdate>
const hasRelease = (update: LauncherUpdate) => !!update.version && ['available', 'downloading', 'ready', 'error', 'checking'].includes(update.phase)

export function UpdatePanel({ controls: { update, action }, language, compact = false }: { controls: Controls; language: Language; compact?: boolean }) {
  const t = (source: string) => translate(language, source)
  const [pending, setPending] = useState(false)
  const run = async (kind: Parameters<Controls['action']>[0]) => {
    setPending(true)
    try { await action(kind) } catch { /* Main service reports recoverable errors through update state. */ }
    finally { setPending(false) }
  }
  const checking = update.phase === 'checking', downloading = update.phase === 'downloading', ready = update.phase === 'ready'
  const errors = { network: 'Güncellemeye ulaşılamadı. Bağlantını kontrol edip yeniden dene.', metadata: 'Bu sürümün güncelleme dosyaları eksik. Daha sonra yeniden dene.', checksum: 'İndirme doğrulanamadı. Yeniden indir.', install: 'Güncelleme kurulamadı. Yeniden dene.', busy: 'Güncellemeden önce oyunu ve devam eden işlemleri tamamla.' }
  const headline = checking ? t('Güncellemeler kontrol ediliyor...') : downloading ? t('Güncelleme indiriliyor...') : ready ? t('Güncelleme kurulmaya hazır') : update.phase === 'error' ? t('Kontrol tamamlanamadı') : update.phase === 'current' ? t('En son sürüm yüklü') : hasRelease(update) ? t('Yeni bir güncelleme var') : t('Yeni sürümleri takip et')
  return <div className="launcher-update-area"><section className={`launcher-update-panel ${compact ? 'compact' : ''}`} aria-label={t('Launcher güncellemeleri')}>
    <div className={`update-heading ${update.phase}`}><h3>{headline}</h3></div>
    {update.phase === 'disabled' ? <p className="update-description">{t('Güncellemeler kurulu Windows uygulamasında kullanılabilir.')}</p> : <>
      {update.phase === 'idle' && <p className="update-description">{t('Launcher açıldığında yeni sürümler otomatik kontrol edilir.')}</p>}
      {update.phase === 'current' && <p className="update-description">{t('Yeni bir sürüm çıktığında burada göreceksin.')}</p>}
      {update.error && <p className="update-error" role="status">{t(errors[update.error])}</p>}
      {downloading && <div className="update-progress"><progress max={100} value={update.percent ?? 0} aria-label={t('Güncelleme indiriliyor...')} /><span>{Math.floor(update.percent ?? 0)}% · {((update.transferred ?? 0) / 1048576).toFixed(1)} / {((update.total ?? 0) / 1048576).toFixed(1)} MB</span></div>}
      {hasRelease(update) && <p className="update-description"><span className="update-release-version">v{update.version}</span>{t(update.portable ? 'Bir kez kurulum yap; sonraki güncellemeler launcher içinden gelecek.' : 'Profillerin, hesapların ve dünyaların korunur.')}</p>}
      {!compact && update.notes && hasRelease(update) && <div className="update-notes"><h4>{t('Bu sürümde neler yeni?')}</h4><p>{update.notes}</p></div>}
      <div className="update-actions">
        {ready ? <button className="update-primary" disabled={pending} onClick={() => void run('install')}>{t(update.portable ? 'Kurulumu başlat' : 'Yeniden başlat ve güncelle')}</button> : downloading ? <button onClick={() => void run('cancel')}>{t('İndirmeyi iptal et')}</button> : hasRelease(update) && !checking ? <button className="update-primary" disabled={pending} onClick={() => void run('download')}>{t('Güncellemeyi indir')}</button> : null}
        <button className="update-check" disabled={pending || checking || downloading || ready} onClick={() => void run('check')}>{checking && <RefreshCw size={15} className="spin" />}{t('Kontrol et')}</button>
      </div>
    </>}
  </section>
    {update.checkedAt && !checking && <small className="update-last-check">{t('Son kontrol')} · <time dateTime={update.checkedAt}>{new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(update.checkedAt))}</time></small>}
  </div>
}

export function UpdateIndicator({ controls, language, onOpen }: { controls: Controls; language: Language; onOpen(): void }) {
  const { update } = controls, t = (source: string) => translate(language, source)
  if (!hasRelease(update)) return null
  const label = update.phase === 'ready' ? 'Güncelleme hazır' : update.phase === 'downloading' ? 'Güncelleme indiriliyor...' : 'Güncelleme var'
  return <button className={`statusbar-update ${update.phase}`} onClick={onOpen}><span className="update-dot" />{t(label)}{update.phase === 'downloading' ? ` ${Math.floor(update.percent ?? 0)}%` : ''}</button>
}

export function UpdateDialog({ controls, language, onClose }: { controls: Controls; language: Language; onClose(): void }) {
  return <AccountDialog title={translate(language, 'Launcher güncellemeleri')} description={translate(language, 'Bu sürümde neler yeni?')} closeLabel={translate(language, 'Kapat')} onClose={onClose}><UpdatePanel controls={controls} language={language} /></AccountDialog>
}

export function HomeUpdate({ controls, language }: { controls: Controls; language: Language }) {
  return hasRelease(controls.update) ? <div className="home-update"><UpdatePanel controls={controls} language={language} /></div> : null
}
