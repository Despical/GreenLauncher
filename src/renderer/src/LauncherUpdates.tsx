import { useEffect, useRef, useState } from 'react'
import { Clock3, Gauge, RefreshCw, TrendingUp } from 'lucide-react'
import type { LauncherUpdate } from '../../shared/types'
import { translate, type Language } from './i18n'
import packageJson from '../../../package.json'
import launcherIcon from '../../../build/launcher-mark.png'
import './updates.css'

export function useLauncherUpdate() {
  const [update, setUpdate] = useState<LauncherUpdate>({ phase: 'idle', currentVersion: packageJson.version, portable: false })
  const revision = useRef(0)
  const [checkResult, setCheckResult] = useState<{ value: LauncherUpdate } | null>(null)
  const [failure, setFailure] = useState<{ value: LauncherUpdate } | null>(null)
  const previous = useRef<LauncherUpdate | null>(null)
  useEffect(() => {
    const before = revision.current
    void window.launcher.getUpdate().then(value => { if (revision.current === before) setUpdate(value) }).catch(() => {})
    return window.launcher.on('update', value => {
      revision.current++; setUpdate(value)
      if (value.error && ['download', 'install'].includes(value.operation ?? '') && (previous.current?.error !== value.error || previous.current?.phase !== value.phase)) setFailure({ value })
      previous.current = value
    })
  }, [])
  const action = async (kind: 'check' | 'download' | 'cancel' | 'install') => {
    try {
      const value = await ({ check: window.launcher.checkUpdate, download: window.launcher.downloadUpdate, cancel: window.launcher.cancelUpdate, install: window.launcher.installUpdate })[kind]()
      revision.current++; setUpdate(value)
      if (kind === 'check') setCheckResult({ value })
    } catch (error) {
      if (kind === 'check') setCheckResult({ value: { ...update, phase: 'error', error: 'network' } })
      else if (kind !== 'cancel') setFailure({ value: { ...update, phase: 'error', error: kind === 'install' ? 'install' : 'network', operation: kind } })
      throw error
    }
  }
  return { update, action, checkResult, failure }
}

export function updateErrorText(update: LauncherUpdate) {
  const errors = { network: 'Güncellemeye ulaşılamadı. Bağlantını kontrol edip yeniden dene.', metadata: 'Bu sürümün güncelleme dosyaları eksik. Daha sonra yeniden dene.', checksum: 'İndirme doğrulanamadı. Yeniden indir.', install: 'Güncelleme kurulamadı. Yeniden dene.', busy: 'Güncellemeden önce oyunu ve devam eden işlemleri tamamla.' }
  return update.error === 'network' && update.operation === 'download' ? 'Güncelleme indirilemedi. Bağlantını kontrol edip yeniden dene.' : errors[update.error ?? 'network']
}

export function updateCheckDate(value: string) {
  const date = new Date(value), two = (part: number) => String(part).padStart(2, '0')
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}
export type UpdateControls = ReturnType<typeof useLauncherUpdate>
type Controls = UpdateControls
const hasRelease = (update: LauncherUpdate) => !!update.version && ['available', 'downloading', 'ready', 'installing', 'error', 'checking'].includes(update.phase)

export function UpdatePanel({ controls: { update, action }, language, onNotes, onDownloads }: { controls: Controls; language: Language; onNotes(): void; onDownloads(): void }) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [pending, setPending] = useState(false)
  const run = async (kind: Parameters<Controls['action']>[0]) => {
    setPending(true)
    try { await action(kind) } catch { /* Main service reports recoverable errors through update state. */ }
    finally { setPending(false) }
  }
  const checking = update.phase === 'checking', downloading = update.phase === 'downloading', ready = update.phase === 'ready'
  const headline = checking ? t('Güncellemeler kontrol ediliyor...') : downloading ? t('Güncelleme indiriliyor...') : ready ? t('Güncelleme kurulmaya hazır') : update.phase === 'error' ? t(update.operation === 'download' ? 'Güncelleme indirilemedi' : 'Kontrol tamamlanamadı') : update.phase === 'current' ? t('En son sürüm yüklü') : hasRelease(update) ? t('Yeni bir güncelleme var') : t('Yeni sürümleri takip et')
  return <div className="launcher-update-area"><section className="launcher-update-panel" aria-label={t('Launcher güncellemeleri')}>
    <div className={`update-heading ${update.phase}`}><h3>{headline}</h3></div>
    {hasRelease(update) && <button type="button" className="update-notes-link" onClick={onNotes}>{t('v{version} sürümünün güncelleme notlarını görmek için tıkla', { version: update.version! })}</button>}
    {update.phase === 'disabled' ? <p className="update-description">{t('Güncellemeler kurulu Windows uygulamasında kullanılabilir.')}</p> : <>
      {update.phase === 'idle' && <p className="update-description">{t('Launcher açıldığında yeni sürümler otomatik kontrol edilir.')}</p>}
      {update.phase === 'current' && <p className="update-description">{t('Yeni bir sürüm çıktığında burada göreceksin.')}</p>}
      {update.error && <p className="update-error" role="status">{t(updateErrorText(update))}</p>}
      <div className="update-actions">
        {hasRelease(update) && <button className="update-primary" disabled={update.phase === 'installing'} onClick={() => { onDownloads(); if (!checking && !downloading && !ready && update.phase !== 'installing') void run('download') }}>{t(downloading || ready || update.phase === 'installing' || checking ? 'İndirmelerde görüntüle' : 'Güncellemeyi indir')}</button>}
        <button className="update-check" disabled={pending || checking || downloading || ready} onClick={() => void run('check')}>{checking && <RefreshCw size={15} className="spin" />}{t('Kontrol et')}</button>
      </div>
    </>}
  </section>
    {update.checkedAt && <small className="update-last-check">{t('Son kontrol')} · <time dateTime={update.checkedAt}>{updateCheckDate(update.checkedAt)}</time></small>}
  </div>
}

export function UpdateIndicator({ controls, language, onOpen }: { controls: Controls; language: Language; onOpen(): void }) {
  const { update } = controls, t = (source: string) => translate(language, source)
  if (!hasRelease(update)) return null
  const label = update.phase === 'installing' ? 'Güncelleme uygulanıyor...' : update.phase === 'ready' ? 'Güncelleme hazır' : update.phase === 'downloading' ? 'Güncelleme indiriliyor...' : 'Güncelleme var'
  return <button className={`statusbar-update ${update.phase}`} onClick={onOpen}><span className="update-dot" />{t(label)}{update.phase === 'downloading' ? ` ${Math.floor(update.percent ?? 0)}%` : ''}</button>
}

export function updateDownloadVisible(update: LauncherUpdate) { return hasRelease(update) && !['ready','installing'].includes(update.phase) && !(update.phase === 'error' && update.operation === 'install' && update.downloadedAt) }
export function UpdateHistoryActions({ controls: { update, action }, language }: { controls: Controls; language: Language }) {
  const [pending, setPending] = useState(false)
  const run = async () => { setPending(true); try { await action(update.phase === 'error' ? 'download' : 'install') } catch {} finally { setPending(false) } }
  return <div className="launcher-update-history-actions">{update.error && <small className="update-error" role="status">{translate(language,updateErrorText(update))}</small>}<div className="update-actions"><button className="update-primary" disabled={pending || update.phase === 'installing'} onClick={()=>void run()}>{translate(language,update.phase === 'installing' ? 'Güncelleme uygulanıyor...' : update.phase === 'error' ? 'Yeniden dene' : 'Yeniden başlat ve güncelle')}</button></div></div>
}
export function LauncherUpdateDownload({ controls: { update, action }, language }: { controls: Controls; language: Language }) {
  const t = (source: string) => translate(language, source)
  const [pending, setPending] = useState(false)
  if (!updateDownloadVisible(update)) return null
  const downloading = update.phase === 'downloading' || update.phase === 'checking' && update.operation === 'download'
  const percent = Math.max(0,Math.min(100,Math.floor(update.percent ?? 0)))
  const bytes = (value: number) => value < 1048576 ? `${(value/1024).toFixed(1)} KB` : `${(value/1048576).toFixed(1)} MB`
  const remaining = downloading ? Math.min(359999,update.estimatedSeconds ?? 0) : 0
  const time = remaining ? `${Math.floor(remaining/3600).toString().padStart(2,'0')}:${Math.floor(remaining%3600/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}` : '—'
  const run = async (kind: 'download' | 'cancel' | 'install') => { setPending(true); try { await action(kind) } catch {} finally { setPending(false) } }
  const label = downloading ? 'Güncelleme indiriliyor...' : update.phase === 'error' ? 'Güncelleme indirilemedi' : 'Yeni bir güncelleme var'
  return <article className={`download-job launcher-update-job ${update.phase}`}>
    <div className="download-job-identity"><span className="download-job-icon"><img src={launcherIcon} alt="" draggable={false}/></span><div className="download-job-title"><strong>Green Launcher · v{update.version}</strong><small>{t(label)}</small></div></div>
    <div className="download-job-transfer">
      <div className="download-job-metrics"><div><Gauge size={17}/><span><small>{t('Aktarım hızı')}</small><strong>{downloading && update.bytesPerSecond ? `${bytes(update.bytesPerSecond)}/sn` : '—'}</strong></span></div><div><TrendingUp size={17}/><span><small>{t('En Yüksek')}</small><strong>{update.peakBytesPerSecond ? `${bytes(update.peakBytesPerSecond)}/sn` : '—'}</strong></span></div><div><Clock3 size={17}/><span><small>{t('Kalan tahmini süre')}</small><strong>{time}</strong></span></div></div>
      <div className="download-job-progress-copy"><span>{t(label)}</span><strong>{update.total ? `${bytes(update.transferred ?? 0)} / ${bytes(update.total)}` : '—'}<em>{percent}%</em></strong></div>
      <div className="download-job-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Green Launcher"><span style={{width:`${percent}%`}}/></div>
      {update.error && <p className="update-error" role="status">{t(updateErrorText(update))}</p>}
      <div className="download-job-bottom"><span/><div className="update-actions">{downloading ? <button onClick={()=>void run('cancel')}>{t('İndirmeyi iptal et')}</button> : <button className="update-primary" disabled={pending} onClick={()=>void run('download')}>{t(update.phase === 'error' ? 'Yeniden dene' : 'Güncellemeyi indir')}</button>}</div></div>
    </div>
  </article>
}
