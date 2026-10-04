import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, LoaderCircle } from 'lucide-react'
import { LoaderIcon } from './LoaderIcon'
import type { DownloadSnapshot, GameVersion, LauncherProfile, LauncherState, ProfileLoader } from '../../shared/types'
import { profileLaunchVersion } from '../../shared/profile-version'
import { DialogHeading } from './AccountControls'
import { translate, type Language } from './i18n'
import './profile-version.css'

const loaderNames = { none: 'Vanilla', optifine: 'OptiFine', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', liteloader: 'LiteLoader' }
const currentLoader = (profile: LauncherProfile): ProfileLoader => profile.modLoader ?? (/-OptiFine_/i.test(profile.versionId) ? 'optifine' : 'none')
type Request = { minecraftVersion: string; loader?: ProfileLoader }
export function ProfileVersionPage({ profile, versions, language, isVisible, running, onState, onVersions, onNotice, picker }: {
  profile: LauncherProfile; versions: GameVersion[]; language: Language; isVisible: boolean; running: boolean
  onState: (state: LauncherState) => void; onVersions: (versions: GameVersion[]) => void; onNotice: (text: string) => void
  picker: (value: string, options: Array<{ value: string; label: string; detail?: string; icon?: ReactNode }>, onChange: (value: string) => void, label: string, disabled: boolean, searchable?: boolean) => ReactNode
}) {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const base = profile.versionId.split(/-OptiFine_/i)[0], installedLoader = currentLoader(profile)
  const [minecraftVersion, setMinecraftVersion] = useState(base), [loader, setLoader] = useState<ProfileLoader>(installedLoader)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmation, setConfirmation] = useState<{ request: Request; activeMods: number } | null>(null)
  const [downloads, setDownloads] = useState<DownloadSnapshot | null>(null)
  const action = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setMinecraftVersion(base); setLoader(installedLoader); setConfirmation(null); setError('') }, [profile.id, profile.versionId, profile.modLoader, profile.modLoaderVersion])
  useEffect(() => {
    if (!isVisible) return
    let active = true
    window.launcher.getDownloads().then(value => { if (active) setDownloads(value) }).catch(() => {})
    const off = window.launcher.on('downloads', value => { if (active) setDownloads(value) })
    return () => { active = false; off() }
  }, [isVisible])
  useEffect(() => {
    if (!confirmation) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !action.current) setConfirmation(null) }
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape)
  }, [confirmation])
  const configure = async (request: Request, acknowledged = false) => {
    if (action.current) return
    action.current = true; setBusy(true); setError('')
    try {
      const result = await window.launcher.configureProfileVersion(profile.id, request.minecraftVersion, request.loader, acknowledged)
      if (!mounted.current) return
      if (result.status === 'confirmation-required') setConfirmation({ request, activeMods: result.activeMods })
      else { setConfirmation(null); onState(result.state); onNotice(t('Profil sürümü güncellendi.')); window.launcher.getVersions().then(onVersions).catch(() => {}) }
    } catch (reason) { if (mounted.current) { setError(String((reason as Error).message ?? reason)); setConfirmation(null) } }
    finally { action.current = false; if (mounted.current) setBusy(false) }
  }
  const installed = (id: string) => versions.some(version => version.id === id && version.installed || version.optifineVersions.some(variant => variant.id === id))
  // Loader descriptors remain available in the global catalog, but this picker chooses Minecraft itself.
  const baseVersions = versions.filter(version => version.url || version.custom || version.id === base || !/(?:fabric|forge|quilt|liteloader|optifine)/i.test(version.id))
  const choices = baseVersions.map(version => ({ value: version.id, label: version.id, detail: t(version.custom ? 'Özel istemci' : version.type === 'release' ? 'Kararlı sürüm' : version.type === 'snapshot' ? 'Snapshot' : version.type === 'old_beta' ? 'Eski beta' : 'Eski alfa') }))
  if (!choices.some(item => item.value === base)) choices.unshift({ value: base, label: base, detail: t('Mevcut sürüm') })
  const locked = !!profile.modpack, blocked = busy || running || locked
  const currentVersion = versions.find(version => version.id === base), minecraftPending = minecraftVersion !== base
  const custom = currentVersion?.custom === true
  const loaderChoices = (Object.keys(loaderNames) as ProfileLoader[]).filter(value => !custom || value === 'none').filter(value => value !== 'optifine' || currentVersion?.optifineAvailable || currentVersion?.optifineVersions.length || installedLoader === 'optifine').map(value => ({ value, label: value === 'none' ? t('Yükleyici yok (Vanilla)') : loaderNames[value], icon: <LoaderIcon loader={value} /> }))
  const activeJob = downloads?.jobs.find(job => job.profileId === profile.id && !['completed', 'failed'].includes(job.phase))
  return <div className="content-page profile-version-page">
    <div className="page-heading"><div><h2>{t('Sürüm')}</h2><p>{t('Minecraft sürümünü değiştir ve bu profile yükleyici kur.')}</p></div></div>
    <div className="profile-version-current"><span className="profile-version-current-icon"><LoaderIcon loader={installedLoader} /></span><div><strong>Minecraft {base}</strong><span>{loaderNames[installedLoader]}{profile.modLoaderVersion ? ` · ${profile.modLoaderVersion}` : installedLoader === 'optifine' ? ` · ${profile.versionId.replace(/^.*-OptiFine_/i, '')}` : ''}</span></div><small>{t(installed(profileLaunchVersion(profile)) ? 'Yüklü' : 'Henüz yüklü değil')}</small></div>
    {locked && <p className="profile-version-note">{t('Bu mod paketinin sürümü ve yükleyicisi paket tarafından yönetilir.')}</p>}
    {running && <p className="profile-version-note">{t('Sürümü değiştirmek için oyunu kapat.')}</p>}
    <div className="profile-version-sections">
      <section className="profile-version-section"><div className="profile-version-section-copy"><h3><LoaderIcon loader="none" />{t('Minecraft sürümü')}</h3><p>{t('Sürümü seç ve indir. Profilin dosyaları korunur.')}</p></div><div className="profile-version-controls">{picker(minecraftVersion, choices, value => { setMinecraftVersion(value); setError('') }, t('Minecraft sürümü'), blocked, true)}<button className="heading-action profile-minecraft-apply" disabled={blocked || !minecraftPending && installed(profileLaunchVersion(profile))} onClick={() => void configure({ minecraftVersion })}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{t(minecraftPending ? 'Sürümü değiştir' : 'İndir ve kur')}</button></div></section>
      <section className="profile-version-section"><div className="profile-version-section-copy"><h3><LoaderIcon loader={loader} />{t('Mod yükleyicisi')}</h3><p>{t('Minecraft sürümüne uygun yükleyici otomatik seçilir.')}</p></div><div className="profile-version-controls">{picker(loader, loaderChoices, value => { setLoader(value as ProfileLoader); setError('') }, t('Mod yükleyicisi'), blocked || minecraftPending)}<button className="heading-action profile-loader-apply" disabled={blocked || minecraftPending || loader === 'none' && installedLoader === 'none' || !currentVersion} onClick={() => void configure({ minecraftVersion: base, loader })}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{t(loader === 'none' ? 'Vanilla’ya geç' : loader === installedLoader ? 'Yükleyiciyi yeniden kur' : 'Yükleyiciyi kur')}</button></div></section>
    </div>
    {minecraftPending && <p className="profile-version-note">{t('Yükleyiciyi değiştirmeden önce Minecraft sürümünü uygula.')}</p>}
    {!locked && <p className="profile-version-note">{t('Sürüm veya yükleyici değiştikten sonra modlarının uyumluluğunu kontrol et.')}</p>}
    {error && <div className="profile-version-error" role="alert">{t(error)}</div>}
    {busy && activeJob && <div className="profile-version-progress" role="status"><span>{t(activeJob.detail || 'Kuruluyor...')}</span><progress max={activeJob.totalBytes || 100} value={activeJob.totalBytes ? activeJob.downloadedBytes : 0} /></div>}
    {confirmation && <div className="modal-backdrop"><div className="modal confirm-modal profile-version-confirm" role="dialog" aria-modal="true" aria-labelledby="profile-version-confirm-title"><DialogHeading titleId="profile-version-confirm-title" title={t('Modların uyumluluğu değişebilir')} description={t('{count} etkin mod var. Dosyaların korunacak; yeni sürüm veya yükleyiciyle uyumluluğunu kontrol et.', { count: confirmation.activeMods })} closeLabel={t('Kapat')} locked={busy} onClose={() => setConfirmation(null)} /><div className="modal-actions"><div className="spacer" /><button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>{t('Vazgeç')}</button><button className="modal-primary" disabled={busy} onClick={() => void configure(confirmation.request, true)}>{busy && <LoaderCircle className="spin" size={16} />}{t('Devam et')}</button></div></div></div>}
  </div>
}
