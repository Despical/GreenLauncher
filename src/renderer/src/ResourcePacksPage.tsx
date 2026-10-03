import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, ExternalLink, Image, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { DownloadSnapshot, InstalledResourcePack, LauncherProfile, ModProject, ModSearchHit, ModSort, ModVersion } from '../../shared/types'
import { translate, type Language } from './i18n'
import { ModSelect, plainDescription, safeIcon } from './ModsPage'
import { CurseForgeConnection } from './CurseForgeConnection'
import modrinthIcon from '../assets/modrinth-logo.svg'
import curseforgeIcon from '../assets/curseforge.svg'
import './resource-packs.css'

export function ResourcePacksPage({ profile, language, isVisible, running, onNotice }: { profile: LauncherProfile; language: Language; isVisible: boolean; running: boolean; onNotice: (text: string) => void }) {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const gameVersion = profile.versionId.split(/-OptiFine_/i)[0]
  const [mode, setMode] = useState<'installed' | 'browse'>('installed')
  const [provider, setProvider] = useState<'modrinth' | 'curseforge'>('modrinth'), [connected, setConnected] = useState(false), [connection, setConnection] = useState(false)
  const [packs, setPacks] = useState<InstalledResourcePack[]>([]), [selectedPack, setSelectedPack] = useState('')
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [sort, setSort] = useState<ModSort>('relevance')
  const [hits, setHits] = useState<ModSearchHit[]>([]), [total, setTotal] = useState(0), [selected, setSelected] = useState<ModSearchHit | null>(null)
  const [project, setProject] = useState<ModProject | null>(null), [versions, setVersions] = useState<ModVersion[]>([]), [versionId, setVersionId] = useState('')
  const [loading, setLoading] = useState(false), [detailsLoading, setDetailsLoading] = useState(false), [more, setMore] = useState(false)
  const [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false)
  const [downloads, setDownloads] = useState<DownloadSnapshot | null>(null)
  const token = useRef(0), actionBusy = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { window.launcher.getProviderStatus().then(status => { if (mounted.current) setConnected(status.curseforge) }).catch(() => {}) }, [])
  useEffect(() => { const timeout = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timeout) }, [query])
  useEffect(() => {
    if (!isVisible) return
    let active = true
    window.launcher.getResourcePacks(profile.id).then(value => { if (active) { setPacks(value); setError('') } }).catch(error => { if (active) setError(String(error.message ?? error)) })
    window.launcher.getDownloads().then(value => { if (active) setDownloads(value) }).catch(() => {})
    const off = window.launcher.on('downloads', value => { if (active) setDownloads(value) })
    return () => { active = false; off() }
  }, [profile.id, isVisible, reload, running])
  useEffect(() => {
    const request = ++token.current
    setSelected(null); setHits([]); setTotal(0); setProject(null); setVersions([]); setVersionId(''); setMore(false)
    if (!isVisible || mode !== 'browse' || provider === 'curseforge' && !connected) { setLoading(false); return }
    setLoading(true); setError('')
    window.launcher.searchMods(search, gameVersion, 'fabric', sort, 0, 'all', 'resourcepack', provider)
      .then(result => { if (token.current === request) { setHits(result.hits); setTotal(result.total); setSelected(result.hits[0] ?? null) } })
      .catch(error => { if (token.current === request) setError(String(error.message ?? error)) })
      .finally(() => { if (token.current === request) setLoading(false) })
    return () => { token.current++ }
  }, [mode, provider, connected, search, sort, profile.id, gameVersion, reload, isVisible])
  useEffect(() => {
    let active = true
    setProject(null); setVersions([]); setVersionId(''); setDetailError('')
    if (!selected || mode !== 'browse' || !isVisible) { setDetailsLoading(false); return }
    setDetailsLoading(true)
    Promise.all([window.launcher.getModProject(selected.projectId, provider), window.launcher.getModVersions(selected.projectId, gameVersion, 'fabric', provider, false, 'resourcepack')])
      .then(([project, versions]) => { if (active) { if (project.projectType !== 'resourcepack') throw new Error(t('Kaynak paketi dosyası doğrulanamadı.')); setProject(project); setVersions(versions); setVersionId((versions.find(version => version.type === 'release') ?? versions[0])?.id ?? '') } })
      .catch(error => { if (active) setDetailError(String(error.message ?? error)) })
      .finally(() => { if (active) setDetailsLoading(false) })
    return () => { active = false }
  }, [selected?.projectId, provider, gameVersion, mode, isVisible, reload])
  const loadMore = async () => {
    if (loading || more || hits.length >= total) return
    const request = token.current; setMore(true)
    try { const result = await window.launcher.searchMods(search, gameVersion, 'fabric', sort, hits.length, 'all', 'resourcepack', provider); if (request === token.current) { setHits(current => [...current, ...result.hits.filter(hit => !current.some(item => item.projectId === hit.projectId))]); setTotal(result.total) } }
    catch (error) { if (request === token.current) onNotice(String((error as Error).message ?? error)) }
    finally { if (request === token.current) setMore(false) }
  }
  const enable = async (pack: InstalledResourcePack) => {
    if (actionBusy.current) return
    actionBusy.current = true; setBusy(true)
    try { const next = await window.launcher.setResourcePackEnabled(profile.id, pack.filename, !pack.enabled); if (mounted.current) setPacks(next) }
    catch (error) { onNotice(t(String((error as Error).message ?? error))) }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  const install = async () => {
    if (!project || !versionId || actionBusy.current) return
    actionBusy.current = true; setBusy(true)
    try { const next = await window.launcher.installResourcePack(profile.id, versionId, provider, { title: project.title, iconUrl: project.iconUrl }); if (mounted.current) setPacks(next); onNotice(t('{name} kaynak paketi kuruldu.', { name: project.title })) }
    catch (error) { onNotice(t(String((error as Error).message ?? error))) }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  const changeProvider = (next: 'modrinth' | 'curseforge') => { setProvider(next); setMode('browse'); setSelected(null); setQuery(''); setSearch('') }
  const visiblePacks = packs.filter(pack => `${pack.title} ${pack.filename} ${pack.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const chosen = visiblePacks.find(pack => pack.filename === selectedPack) ?? visiblePacks[0]
  const version = versions.find(version => version.id === versionId)
  const installed = packs.find(pack => pack.provider === provider && pack.projectId === project?.id)
  const activeJob = downloads?.jobs.find(job => job.profileId === profile.id && job.title === project?.title && !['completed', 'failed'].includes(job.phase))
  const num = (value: number) => new Intl.NumberFormat(language, { notation: 'compact' }).format(value)
  const packIcon = (pack?: InstalledResourcePack) => pack?.icon ? <img src={pack.icon} alt="" /> : <Image size={26} />
  return <div className="content-page resource-packs-page">
    <div className="page-heading"><div><h2>{t('Kaynak paketleri')}</h2><p>{t('Bu profilin paketlerini yönet, yeni görünümleri keşfet.')}</p></div><button className="heading-action" aria-label={t('Yenile')} disabled={busy} onClick={() => setReload(value => value + 1)}><RefreshCw size={17} />{t('Yenile')}</button></div>
    <div className="resource-mode-bar"><div className="mods-type-tabs" role="tablist" aria-label={t('Kaynak paketleri')}><button role="tab" aria-selected={mode === 'installed'} className={mode === 'installed' ? 'active' : ''} onClick={() => { setMode('installed'); setQuery('') }}>{t('Kurulu')} <span>{packs.length}</span></button><button role="tab" aria-selected={mode === 'browse'} className={mode === 'browse' ? 'active' : ''} onClick={() => { setMode('browse'); setQuery('') }}>{t('Keşfet')}</button></div><span>Minecraft {gameVersion}</span></div>
    {mode === 'installed' ? <>
      <div className="mods-search resource-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Kurulu paketlerde ara')} placeholder={t('Kurulu paketlerde ara')} /></div>
      {error && <div className="mods-state error" role="alert">{t(error)}</div>}
      <div className="resource-installed-layout"><div className="resource-installed-list">
        <div className="resource-table-head"><span>{t('Etkin')}</span><span>{t('Paket')}</span><span>{t('Paket formatı')}</span><span>{t('Sağlayıcı')}</span></div>
        {!visiblePacks.length && <div className="resource-empty"><Image size={32} /><h3>{t(packs.length ? 'Sonuç bulunamadı.' : 'Henüz kaynak paketi yok')}</h3><p>{t('Modrinth veya CurseForge’dan bu profile bir paket indir.')}</p><button className="heading-action" onClick={() => { setMode('browse'); setQuery('') }}>{t('Paketleri keşfet')}</button></div>}
        {visiblePacks.map(pack => <div key={pack.filename} className={`resource-pack-row ${chosen?.filename === pack.filename ? 'selected' : ''}`}>
          <button className="resource-enable" role="checkbox" aria-checked={pack.enabled} aria-label={t('{name} paketini etkinleştir', { name: pack.title })} disabled={busy || running} onClick={() => void enable(pack)}><span className="profile-checkbox">{pack.enabled && <Check size={13} strokeWidth={3} />}</span></button>
          <button className="resource-pack-select" onClick={() => setSelectedPack(pack.filename)} aria-pressed={chosen?.filename === pack.filename}><span className="resource-pack-icon">{packIcon(pack)}</span><span><strong>{pack.title}</strong><small>{pack.description || pack.filename}</small></span></button>
          <span className="resource-format">{pack.format ?? '—'}</span><span className="resource-provider">{pack.provider && <img src={pack.provider === 'modrinth' ? modrinthIcon : curseforgeIcon} alt="" />}{pack.provider === 'modrinth' ? 'Modrinth' : pack.provider === 'curseforge' ? 'CurseForge' : t('Yerel')}</span>
        </div>)}
      </div><aside className="resource-installed-detail">{chosen ? <><span className="resource-large-icon">{packIcon(chosen)}</span><h3>{chosen.title}</h3><p>{chosen.description}</p><dl><dt>{t('Dosya adı')}</dt><dd>{chosen.filename}</dd><dt>{t('Paket sürümü')}</dt><dd>{chosen.versionNumber || '—'}</dd><dt>{t('Son değiştirme')}</dt><dd>{new Date(chosen.modifiedAt).toLocaleString(language)}</dd></dl>{chosen.sourceUrl && <button className="heading-action" onClick={() => window.launcher.openExternal(chosen.sourceUrl!).catch(error => onNotice(String(error)))}><ExternalLink size={16} />{t('Proje sayfasında aç')}</button>}</> : <p>{t('Bilgilerini görmek için bir kaynak paketi seç.')}</p>}{running && <p className="resource-running-note">{t('Kaynak paketlerini değiştirmek için oyunu kapat.')}</p>}</aside></div>
    </> : <div className="mods-layout resource-browser-layout"><aside className="mods-source-nav" aria-label={t('Sağlayıcı')}><span className="mods-source-label">{t('KAYNAKLAR')}</span><button className={provider === 'modrinth' ? 'active' : ''} onClick={() => changeProvider('modrinth')}><img src={modrinthIcon} alt="" />Modrinth</button><button className={provider === 'curseforge' ? 'active' : ''} onClick={() => changeProvider('curseforge')}><img src={curseforgeIcon} alt="" />CurseForge</button></aside><section className="mods-main">
      <div className="resource-catalog-toolbar"><div className="mods-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Kaynak paketi ara...')} aria-label={t('Kaynak paketi ara...')} /></div><ModSelect value={sort} label={t('Sırala')} placeholder={t('Sırala')} onChange={value => setSort(value as ModSort)} options={(['relevance', 'downloads', 'updated', 'newest'] as const).map(value => ({ value, label: t({ relevance: 'İlgiye göre', downloads: 'En çok indirilen', updated: 'Son güncellenen', newest: 'En yeni' }[value]) }))} /></div>
      {provider === 'curseforge' && !connected ? <div className="provider-connection-state"><img src={curseforgeIcon} alt="" /><h3>{t('CurseForge bağlantısı hazır değil')}</h3><p>{t('CurseForge kataloğu için uygulama bağlantısını yapılandır.')}</p><button className="heading-action" onClick={() => setConnection(true)}>{t('Bağlantıyı yapılandır')}</button></div> : <div className="mods-browser-body resource-catalog-body"><div className="mods-results">
        {loading ? <div className="mods-state"><LoaderCircle className="spin" size={23} />{t('Kaynak paketleri yükleniyor...')}</div> : error ? <div className="mods-state error">{t(error)}<button onClick={() => setReload(value => value + 1)}>{t('Tekrar dene')}</button></div> : !hits.length ? <div className="mods-state">{t('Bu sürüme uygun kaynak paketi bulunamadı.')}</div> : hits.map(hit => <button className={`mods-hit ${selected?.projectId === hit.projectId ? 'selected' : ''}`} key={hit.projectId} onClick={() => setSelected(hit)}><span className="mods-hit-icon">{safeIcon(hit.iconUrl) ? <img src={safeIcon(hit.iconUrl)} alt="" /> : <Image size={24} />}</span><span className="mods-hit-copy"><strong>{hit.title}</strong><small>{hit.description}</small><em>{hit.author} · {num(hit.downloads)} {t('indirme')}</em></span></button>)}
        {!loading && hits.length < total && <button className="mods-load-more" disabled={more} onClick={() => void loadMore()}>{more ? <LoaderCircle className="spin" size={17} /> : t('Daha fazla göster')}</button>}
      </div><div className="mods-detail">{detailsLoading ? <div className="mods-state"><LoaderCircle className="spin" size={23} /></div> : detailError ? <div className="mods-state error">{t(detailError)}<button onClick={() => setReload(value => value + 1)}>{t('Tekrar dene')}</button></div> : project ? <>
        <div className="mods-detail-top"><span className="mods-detail-icon">{safeIcon(project.iconUrl) ? <img src={safeIcon(project.iconUrl)} alt="" /> : <Image size={31} />}</span><div className="mods-detail-title"><h3>{project.title}</h3><small>{selected?.author}</small></div>{project.sourceUrl && <button className="release-link mods-project-link" aria-label={t('Proje sayfasında aç')} onClick={() => window.launcher.openExternal(project.sourceUrl!).catch(error => onNotice(String(error)))}><ExternalLink size={17} /></button>}</div>
        <p className="mods-detail-description">{project.description}</p><div className="mods-detail-text">{plainDescription(project.body) || project.description}</div>
        <div className="resource-download-summary"><div className="mods-field"><span>{t('Paket sürümü')}</span><ModSelect label={t('Paket sürümü')} value={versionId} onChange={setVersionId} placeholder={t('Uyumlu paket sürümü bulunamadı.')} options={versions.map(version => ({ value: version.id, label: `${version.versionNumber} · ${t(version.type === 'release' ? 'Kararlı sürüm' : version.type === 'beta' ? 'Beta' : 'Alfa')}` }))} up /></div>
          <dl><dt>{t('Dosya adı')}</dt><dd>{version?.filename ?? '—'}</dd><dt>{t('Sağlayıcı')}</dt><dd>{provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}</dd><dt>{t('Profil')}</dt><dd>{profile.name} · Minecraft {gameVersion}</dd></dl>
          {installed && <small>{t('Kurulu')}: {installed.versionNumber}</small>}
          {activeJob && <div className="resource-download-progress"><span>{t(activeJob.detail || 'İndiriliyor...')}</span><progress max={activeJob.totalBytes || 100} value={activeJob.totalBytes ? activeJob.downloadedBytes : 0} /></div>}
          {running && <small>{t('Kaynak paketlerini değiştirmek için oyunu kapat.')}</small>}
          <button className="heading-action resource-install-button" disabled={busy || !!activeJob || running || !versionId || !version?.gameVersions.includes(gameVersion) || installed?.versionId === versionId} onClick={() => void install()}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{busy ? t('Kuruluyor...') : installed?.versionId === versionId ? t('Kurulu') : t('İndir ve kur')}</button>
        </div>
      </> : <div className="mods-state">{t('Bilgilerini görmek için bir kaynak paketi seç.')}</div>}</div></div>}
    </section></div>}
    {connection && <CurseForgeConnection language={language} onClose={() => setConnection(false)} onConnected={() => { setConnected(true); setConnection(false); setReload(value => value + 1) }} />}
  </div>
}
