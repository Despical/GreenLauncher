import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, LoaderCircle, Package, RefreshCw } from 'lucide-react'
import type { LauncherProfile, LauncherState, ModLoader, ModVersion, ModpackInstallTarget } from '../../shared/types'
import { AccountDialog } from './AccountControls'
import { newerModpackVersions } from '../../shared/modpack-updates'
import { translate, type Language } from './i18n'

export function ProfileModpackVersions({ profile, language, running, onState, onNotice, picker }: {
  profile: LauncherProfile; language: Language; running: boolean
  onState: (state: LauncherState) => void; onNotice: (text: string) => void
  picker: (value: string, options: Array<{ value: string; label: string; detail?: string; icon?: ReactNode }>, onChange: (value: string) => void, label: string, disabled: boolean, searchable?: boolean) => ReactNode
}) {
  const pack = profile.modpack!, provider = pack.provider ?? 'modrinth'
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const [versions, setVersions] = useState<ModVersion[]>([]), [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, refresh] = useState(0)
  const active = useRef(true), installing = useRef(false)
  const [destination, setDestination] = useState(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const known = !!pack.sourceUrl && pack.projectId !== 'local'
  const originLoader = pack.loader ?? profile.modLoader ?? 'fabric'
  useEffect(() => {
    if (!known) return
    let cancelled = false
    setLoading(true); setError('')
    const projectId = pack.projectId.replace(/^(?:curseforge|technic):/, '')
    window.launcher.getModVersions(projectId, profile.versionId.split(/-OptiFine_/i)[0], originLoader, provider, true, 'modpack', revision > 0)
      .then(items => { if (!cancelled) { setVersions(items); setSelected(previous => items.some(item => item.id === previous) ? previous : items.some(item => item.id === pack.versionId) ? pack.versionId : items[0]?.id ?? ''); if (revision > 0) onNotice(Number.isFinite(Date.parse(items.find(version => version.id === pack.versionId)?.published ?? '')) ? t('Güncelleme kontrolü tamamlandı. {count} güncelleme bulundu.', { count: newerModpackVersions(items, pack.versionId).length }) : t('Paket sürümleri otomatik karşılaştırılamadı.')) } })
      .catch(reason => { if (!cancelled) { setError(String(reason.message ?? reason)); if (revision > 0) onNotice(t('Güncelleme kontrolü tamamlanamadı. Ayrıntılar hata günlüğüne kaydedildi.')) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pack.projectId, pack.versionId, provider, originLoader, known, revision])
  const current = versions.find(version => version.id === pack.versionId)
  const latest = [...versions].sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))[0]
  const choices = versions
  const chosen = choices.find(version => version.id === selected)
  const install = async (target: ModpackInstallTarget) => {
    if (!chosen || installing.current || running) return
    const loader = chosen.loaders.find(value => ['fabric', 'forge', 'neoforge', 'quilt', 'liteloader'].includes(value)) as ModLoader | undefined
    const gameVersion = chosen.gameVersions.find(value => /^(?:\d|[ab]\d)/i.test(value))
    if (!gameVersion || provider === 'modrinth' && !loader) return
    installing.current = true; setBusy(true); setError('')
    try {
      const result = await window.launcher.installProfileModpack(profile.id, chosen.id, gameVersion, loader ?? originLoader, target)
      if (active.current) { setDestination(false); onState(result.state); onNotice(t('Paket sürümü kuruldu.')) }
    } catch (reason) { if (active.current) setError(String((reason as Error).message ?? reason)) }
    finally { installing.current = false; if (active.current) setBusy(false) }
  }
  return <section className="profile-pack-section">
    <div className="profile-pack-heading"><h3><Package size={19} />{t('Kurulu mod paketi')}</h3>{known && <button className="heading-action profile-pack-check" disabled={loading || busy} onClick={() => refresh(value => value + 1)}>{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{t('Güncellemeleri kontrol et')}</button>}</div>
    <strong>{pack.title}</strong><p className="profile-pack-version">{t('Paket sürümü')}: {current?.versionNumber ?? pack.versionNumber ?? pack.versionId}{latest && <span className="profile-pack-latest">({t('Son çıkan sürüm: {version}', { version: latest.versionNumber })})</span>}</p>
    {!known ? <p className="profile-version-note">{t('Kaynak bilinmiyor')}</p> : loading && !versions.length ? <p role="status">{t('Kontrol ediliyor...')}</p> : null}
    {!!choices.length && <div className="profile-pack-controls">{picker(selected, choices.map(version => ({ value: version.id, label: `${version.versionNumber} · ${t(version.type === 'alpha' ? 'Alfa' : version.type === 'beta' ? 'Beta' : 'Kararlı sürüm')} · ${t('Minecraft {version} için', { version: version.gameVersions.filter(value => /^(?:\d|[ab]\d)/i.test(value)).join(', ') })}` })), setSelected, t('Paket sürümü'), busy || running || loading, true)}<button className="heading-action primary" disabled={busy || running || loading || !chosen || !chosen.gameVersions.some(value => /^(?:\d|[ab]\d)/i.test(value)) || provider === 'modrinth' && !chosen.loaders.some(value => ['fabric', 'forge', 'neoforge', 'quilt', 'liteloader'].includes(value))} onClick={() => setDestination(true)}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{t('Kur')}</button></div>}
    {error && <div className="profile-version-error" role="alert">{t(error)}</div>}
    {destination && <AccountDialog locked={busy} title={t('Paket nereye kurulsun?')} description={`${pack.title} · ${chosen?.versionNumber ?? ''}`} closeLabel={t('Kapat')} onClose={() => { if (!busy) setDestination(false) }} icon={<Package size={22} />}><div className="profile-pack-destinations">{(['current', 'copy', 'new'] as const).map(target => <button key={target} className="secondary" disabled={busy || running} onClick={() => void install(target)}><strong>{t(target === 'current' ? 'Bu profile kur' : target === 'copy' ? 'Bu profilin kopyasına kur' : 'Yeni profile kur')}</strong><span>{t(target === 'current' ? 'Dünyaların korunur, değiştirilen paket dosyaları yedeklenir.' : target === 'copy' ? 'Dünyalar ve ayarlar profilin kopyasına taşınır.' : 'Paket yeni, bağımsız bir profile kurulur.')}</span></button>)}</div>{busy && <p role="status"><LoaderCircle className="spin" size={16} /> {t('Kuruluyor...')}</p>}{error && <p role="alert">{t(error)}</p>}</AccountDialog>}
  </section>
}
