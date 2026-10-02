import { useEffect, useRef, useState } from 'react'
import { ArrowUp, TrendingUp, Clock3, CloudDownload, Gauge, GripVertical, LoaderCircle, Pause, Play, Settings2, Trash2, X } from 'lucide-react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { DownloadJob, DownloadPhase, DownloadSnapshot, LauncherSettings, LauncherState } from '../../shared/types'
import { translate, type Language } from './i18n'
import './downloads.css'
import { LauncherUpdateDownload, UpdateHistoryActions, updateDownloadVisible, type UpdateControls } from './LauncherUpdates'
import launcherIcon from '../../../build/launcher-mark.png'
import minecraftIcon from '../assets/minecraft-release.png'
import fabricIcon from '../assets/loaders/fabric.png'
import forgeIcon from '../assets/loaders/forge.svg'
import neoForgeIcon from '../assets/loaders/neoforge.svg'
import quiltIcon from '../assets/loaders/quilt.svg'
import liteLoaderIcon from '../assets/loaders/liteloader.svg'
import optifineIcon from '../assets/optifine-mark.png'
import javaIcon from '../assets/java-original.svg'
import { DialogHeading } from './AccountControls'
const contentIcon = (job: DownloadJob) => job.iconUrl || (/neoforge/i.test(job.title) ? neoForgeIcon : /forge/i.test(job.title) ? forgeIcon : /fabric/i.test(job.title) ? fabricIcon : /quilt/i.test(job.title) ? quiltIcon : /liteloader/i.test(job.title) ? liteLoaderIcon : /optifine/i.test(job.title) ? optifineIcon : /minecraft/i.test(job.title) ? minecraftIcon : /java/i.test(job.title) ? javaIcon : undefined)

function DownloadContentIcon({ job }: { job: DownloadJob }) {
  const src = job.launcherVersion ? launcherIcon : contentIcon(job)
  const [failedSource, setFailedSource] = useState<string | undefined>()
  return src && failedSource !== src ? <img src={src} alt="" decoding="async" draggable={false} onDragStart={event => event.preventDefault()} className={src === optifineIcon ? 'download-pixel-icon' : undefined} onError={() => setFailedSource(src)} /> : <CloudDownload size={28} />
}


const bytes = (value: number) => value < 1024 ? `${Math.round(value)} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${(value / 1024 ** 3).toFixed(2)} GB`
const phaseLabels: Record<DownloadPhase, string> = { queued: 'Sırada', preparing: 'Dosyalar hazırlanıyor', downloading: 'İndiriliyor', verifying: 'Dosyalar doğrulanıyor', installing: 'Kuruluyor', retrying: 'Bağlantı yeniden kuruluyor', paused: 'Duraklatıldı', completed: 'Başarıyla indirildi', failed: 'Başarısız' }
type Translate = (source: string, values?: Record<string, string | number>) => string
type Control = (action: Parameters<typeof window.launcher.controlDownloads>[0], id?: string, beforeId?: string) => Promise<void>

function DownloadCard({ job, t, control, speedLimit }: { job: DownloadJob; t: Translate; control: Control; speedLimit: number }) {
  const queued = job.queued === true || job.phase === 'queued'
  const { setNodeRef, setActivatorNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: job.id, disabled: false })
  const percent = Math.min(100, job.totalBytes > 0 ? Math.round(job.downloadedBytes / job.totalBytes * 100) : job.filesTotal > 0 ? Math.round(job.filesDone / job.filesTotal * 100) : 0)
  const rate = job.phase === 'downloading' ? job.bytesPerSecond : 0
  const remaining = job.phase === 'downloading' ? Math.min(359999, job.estimatedSeconds ?? 0) : 0
  const time = remaining ? `${Math.floor(remaining / 3600).toString().padStart(2, '0')}:${Math.floor(remaining % 3600 / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}` : '—'
  return <article ref={setNodeRef} data-job-id={job.id} className={`download-job ${job.phase} sortable ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} onPointerDown={event => listeners?.onPointerDown?.(event)}>
    <div className="download-job-identity">
      <span className="download-job-icon"><DownloadContentIcon job={job} /></span>
      <div className="download-job-title"><strong>{t(job.title)}</strong><small title={job.detail}>{job.profileName || job.detail || t(phaseLabels[job.phase])}</small>{job.forLaunch && <span className="download-priority"><ArrowUp size={12} />{t('Öncelikli')}</span>}</div>
      <button ref={setActivatorNodeRef} type="button" className="download-drag-handle" {...attributes} {...listeners} onPointerDown={event => { event.stopPropagation(); listeners?.onPointerDown?.(event) }} aria-label={t('İndirme sırasını değiştir')} title={t('Sürükleyerek sırala')}><GripVertical size={18} /></button>
    </div>
    <div className="download-job-transfer">
      <div className="download-job-metrics"><div><Gauge size={17} /><span><small>{t('Aktarım hızı')}</small><strong>{rate ? `${bytes(rate)}/sn` : '—'}</strong></span></div><div><TrendingUp size={17} /><span><small>{t('En Yüksek')}</small><strong>{job.peakBytesPerSecond ? `${bytes(job.peakBytesPerSecond)}/sn` : '—'}</strong></span></div><div><Clock3 size={17} /><span><small>{t('Kalan tahmini süre')}</small><strong>{time}</strong></span></div></div>
      {speedLimit > 0 && <div className="download-limit-note">{t('Hız sınırı')}: {speedLimit.toLocaleString()} KB/sn</div>}
      <div className="download-job-progress-copy"><span>{t(phaseLabels[job.phase])}</span><strong>{job.totalBytes ? `${bytes(job.downloadedBytes)} / ${bytes(job.totalBytes)}` : job.downloadedBytes ? bytes(job.downloadedBytes) : '—'}<em>{percent}%</em></strong></div>
      <div className="download-job-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={job.title}><span style={{ width: `${percent}%` }} /></div>
      <div className="download-job-bottom"><span>{job.filesTotal ? t('{done} / {total} dosya', { done: job.filesDone, total: job.filesTotal }) : queued ? t('Sürükleyerek sırala') : job.detail}</span><div className="download-job-actions" onPointerDown={event => event.stopPropagation()}><button className="download-pause" title={job.phase === 'paused' ? t('Sürdür') : t('Duraklat')} aria-label={job.phase === 'paused' ? t('Sürdür') : t('Duraklat')} onClick={() => void control(job.phase === 'paused' ? 'resume' : 'pause', job.id)}>{job.phase === 'paused' ? <Play size={19} /> : <Pause size={19} />}</button></div></div>
    </div>
  </article>
}

export function DownloadsPage({ state, language, onState, onNotice, updates }: { updates: UpdateControls; state: LauncherState; language: Language; onState: (state: LauncherState) => void; onNotice: (message: string) => void }) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [snapshot, setSnapshot] = useState<DownloadSnapshot>({ jobs: [], paused: false, playing: false, speedLimitKiB: state.settings.downloadSpeedLimitKiB ?? 0, concurrency: state.settings.downloadConcurrency ?? 6, pauseWhilePlaying: state.settings.pauseDownloadsWhilePlaying === true })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [speed, setSpeed] = useState('0')
  const [pausePlaying, setPausePlaying] = useState(false)
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(saving)
  savingRef.current = saving
  useEffect(() => {
    let active = true
    let received = false
    const off = window.launcher.on('downloads', value => { received = true; if (active) setSnapshot(value) })
    window.launcher.getDownloads().then(value => { if (active && !received) setSnapshot(value) }).catch(error => onNotice(String(error)))
    return () => { active = false; off() }
  }, [])
  useEffect(() => {
    if (!settingsOpen) return
    dialog.current?.querySelector<HTMLButtonElement>('.modal-close')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) { event.preventDefault(); setSettingsOpen(false) }
      if (event.key !== 'Tab') return
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); settingsButton.current?.focus() }
  }, [settingsOpen])
  const openSettings = () => { setSpeed(state.settings.downloadSpeedLimitKiB ? String(state.settings.downloadSpeedLimitKiB) : ''); setPausePlaying(state.settings.pauseDownloadsWhilePlaying === true); setSettingsOpen(true) }
  const control: Control = async (action, id, beforeId) => {
    try { setSnapshot(await window.launcher.controlDownloads(action, id, beforeId)) } catch (error) { onNotice(error instanceof Error ? error.message : String(error)) }
  }
  const save = async () => {
    const limit = Number(speed.replace(',', '.'))
    if (!Number.isFinite(limit) || limit < 0 || limit > 102400) { onNotice(t('Hız sınırı en fazla 102400 KB/sn olabilir.')); return }
    setSaving(true)
    try { const settings: Partial<LauncherSettings> = { downloadSpeedLimitKiB: limit > 0 ? Math.max(1, Math.round(limit)) : 0, pauseDownloadsWhilePlaying: pausePlaying }; onState(await window.launcher.saveSettings(settings)); setSettingsOpen(false); onNotice(t('İndirme ayarları kaydedildi.')) }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }
  const live = snapshot.jobs.filter(job => !['completed', 'failed'].includes(job.phase)).sort((a, b) => b.priority - a.priority)
  const pendingUpdate = !!updates.update.downloadedAt && !!updates.update.version && (['ready','installing'].includes(updates.update.phase) || updates.update.phase === 'error' && updates.update.operation === 'install')
  const completedJobs = snapshot.jobs.filter(job => ['completed', 'failed'].includes(job.phase) && (job.downloadedBytes > 0 || job.launcherVersion))
  // A ready update keeps its restart action available even after other downloads fill history.
  const pendingJob: DownloadJob | undefined = pendingUpdate ? completedJobs.find(job => job.launcherVersion === updates.update.version) ?? { id:`launcher-update-${updates.update.version}`,launcherVersion:updates.update.version,title:`Green Launcher · v${updates.update.version}`,phase:'completed',detail:'Yeniden başlatmaya hazır',downloadedBytes:updates.update.total ?? 0,totalBytes:updates.update.total ?? 0,bytesPerSecond:0,filesDone:1,filesTotal:1,forLaunch:false,paused:false,priority:0,createdAt:updates.update.downloadedAt! } : undefined
  const history = [...(pendingJob ? [pendingJob] : []), ...completedJobs.filter(job=>job.id!==pendingJob?.id).sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))].slice(0, 5)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const queue = live
    const from = queue.findIndex(job => job.id === active.id), target = queue.findIndex(job => job.id === over.id)
    if (from < 0) return
    const to = Math.max(0, target), ordered = arrayMove(queue, from, to)
    void control('reorder', String(active.id), ordered[to + 1]?.id)
  }
  return <div className="content-page downloads-page">
    <div className="page-heading"><div><h2>{t('İndirmeler')}</h2><p>{t('Aktarımları yönet, sırayı düzenle ve bağlantını kontrol et.')}</p></div><button ref={settingsButton} className="heading-action primary download-settings-trigger" onClick={openSettings}><Settings2 size={17} />{t('İndirme ayarları')}</button></div>
    {snapshot.playing && snapshot.pauseWhilePlaying && <div className="download-game-note"><Pause size={16} />{t('Oyun açık. Arka plan indirmeleri oyun kapanınca sürdürülür.')}</div>}
    <div className="download-section-head"><h3>{t('İndirme kuyruğu')}</h3>{live.length > 0 && <button className="download-text-action" onClick={() => void control(snapshot.paused || live.every(job => job.phase === 'paused') ? 'resume-all' : 'pause-all')}>{snapshot.paused || live.every(job => job.phase === 'paused') ? <Play size={15} /> : <Pause size={15} />}{snapshot.paused || live.every(job => job.phase === 'paused') ? t('Tümünü sürdür') : t('Tümünü duraklat')}</button>}</div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}><SortableContext items={live.map(job => job.id)} strategy={verticalListSortingStrategy}>
      <div className="download-jobs"><LauncherUpdateDownload controls={updates} language={language}/>{live.length ? live.map(job => <DownloadCard key={job.id} job={job} t={t} control={control} speedLimit={snapshot.speedLimitKiB} />) : !updateDownloadVisible(updates.update) && <div className="download-empty"><CloudDownload size={34} /><h3>{t('Etkin indirme yok.')}</h3><p>{t('Oyun, mod ve paket indirmeleri burada görünür.')}</p></div>}</div>
    </SortableContext></DndContext>
    {history.length > 0 && <><div className="download-section-head download-history-heading"><div><h3>{t('Son indirmeler')}</h3><p>{t('Son indirdiğin içerikler burada görünür.')}</p></div><button className="download-text-action" onClick={() => void control('clear')}><Trash2 size={15} />{t('Geçmişi temizle')}</button></div><div className="download-history">{history.map(job => <div key={job.id} className={`${job.phase} ${job.launcherVersion ? 'launcher-update-history' : ''}`}><span className="download-history-icon"><DownloadContentIcon job={job} /></span><div><strong>{t(job.title)}</strong><small>{job.launcherVersion ? t(job.detail) : job.error || job.profileName || job.detail || bytes(job.downloadedBytes)}</small></div>{job.id === pendingJob?.id ? <UpdateHistoryActions controls={updates} language={language}/> : <em>{t(job.launcherVersion && job.detail === 'Güncelleme başarıyla tamamlandı.' ? 'Güncelleme başarıyla tamamlandı.' : phaseLabels[job.phase])}</em>}</div>)}</div></>}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setSettingsOpen(false) }}><div className="modal download-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="download-settings-title" ref={dialog}>
      <DialogHeading title={t('İndirme ayarları')} description={t('Değişiklikler aktif indirmelere de uygulanır.')} closeLabel={t('Kapat')} titleId="download-settings-title" locked={saving} onClose={() => setSettingsOpen(false)} />
      <label className="download-speed-field"><span>{t('Hız sınırı')}</span><div><input aria-label={t('Hız sınırı')} inputMode="numeric" placeholder={t('Sınırsız')} value={speed} onChange={event => setSpeed(event.target.value)} /><span>KB/sn</span></div><small>{t('Hız sınırını kilobayt cinsinden yazın.')}</small></label>
      <button className="setting-toggle" role="switch" aria-checked={pausePlaying} onClick={() => setPausePlaying(value => !value)}><span><strong>{t('Oyun açıkken indirmeleri duraklat')}</strong><small>{t('Oyun için gereken dosyalar indirilir; diğer işler oyun kapanınca sürer.')}</small></span><span className={`switch ${pausePlaying ? 'on' : ''}`} /></button>
      <p className="download-resume-note">{t('Kısmi dosyalar korunur. Sunucu destekliyorsa indirme kaldığı yerden sürer.')}</p>
      <div className="modal-actions"><button className="secondary" disabled={saving} onClick={() => setSettingsOpen(false)}>{t('Vazgeç')}</button><button className="heading-action primary" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle size={16} className="spin" /> : null}{t('Kaydet')}</button></div>
    </div></div>}
  </div>
}
