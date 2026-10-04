import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, Clock3, ExternalLink, FileText, Globe, Image, Package, Sparkles, LoaderCircle, RefreshCw, Search, Tag, UserRound } from 'lucide-react'
import type { DownloadSnapshot, InstalledResourcePack, LauncherProfile, ModProject, ModSearchHit, ModSort, ModVersion, ProfileContentKind, ProfileContentUpdate } from '../../shared/types'
import { translate, type Language } from './i18n'
import { ModSelect, plainDescription, safeIcon } from './ModsPage'
import { CurseForgeConnection } from './CurseForgeConnection'
import curseforgeIcon from '../assets/curseforge.svg'
import modrinthIcon from '../assets/modrinth-logo.svg'
import './resource-packs.css'
import { installedContentCache, installedContentScope, retainContentUpdates } from './installed-content-cache'

export function ResourcePacksPage({ profile, language, isVisible, running, onNotice, kind = 'resourcepack' }: { kind?: ProfileContentKind; profile: LauncherProfile; language: Language; isVisible: boolean; running: boolean; onNotice: (text: string) => void }) {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const gameVersion = profile.versionId.split(/-OptiFine_/i)[0]
  const loader = profile.modLoader ?? 'fabric'
  const needsLoader = kind === 'mod' && (!profile.modLoader || !profile.modLoaderVersion)
  const scope = installedContentScope(profile, kind), cached = installedContentCache.peek(scope)
  const copy = kind === 'mod' ? { title: 'Modlar', description: 'Bu profilin modlarını yönet ve uyumlu sürümleri keşfet.', search: 'Kurulu modlarda ara', item: 'Mod', format: 'Sürüm', empty: 'Henüz mod yok', discover: 'Modları keşfet', enable: '{name} modunu etkinleştir', details: 'Bilgilerini görmek için bir mod seç.', browse: 'Mod ara...', loading: 'Modlar yükleniyor...', noResults: 'Bu sürüme uygun mod bulunamadı.', installed: '{name} modu kuruldu.' } : kind === 'shader' ? { title: 'Shader paketleri', description: 'Bu profilin shader paketlerini yönet, yeni görünümleri keşfet.', search: 'Kurulu shader paketlerinde ara', item: 'Paket', format: 'Sürüm', empty: 'Henüz shader paketi yok', discover: 'Paketleri keşfet', enable: '{name} paketini etkinleştir', details: 'Bilgilerini görmek için bir shader paketi seç.', browse: 'Shader paketi ara...', loading: 'Shader paketleri yükleniyor...', noResults: 'Bu sürüme uygun shader paketi bulunamadı.', installed: '{name} shader paketi kuruldu.' } : { title: 'Kaynak paketleri', description: 'Bu profilin paketlerini yönet, yeni görünümleri keşfet.', search: 'Kurulu paketlerde ara', item: 'Paket', format: 'Sürüm', empty: 'Henüz kaynak paketi yok', discover: 'Paketleri keşfet', enable: '{name} paketini etkinleştir', details: 'Bilgilerini görmek için bir kaynak paketi seç.', browse: 'Kaynak paketi ara...', loading: 'Kaynak paketleri yükleniyor...', noResults: 'Bu sürüme uygun kaynak paketi bulunamadı.', installed: '{name} kaynak paketi kuruldu.' }
  const [updates, setUpdates] = useState<ProfileContentUpdate[]>(cached?.updates ?? []), [checking, setChecking] = useState(false)
  const [installedLoading, setInstalledLoading] = useState(!cached), [toggling, setToggling] = useState(false)
  const checkBusy = useRef(false)
  const list = () => kind === 'resourcepack' ? window.launcher.getResourcePacks(profile.id) : window.launcher.getProfileContent(profile.id, kind)
  const [mode, setMode] = useState<'installed' | 'browse'>('installed')
  const [provider, setProvider] = useState<'modrinth' | 'curseforge'>('modrinth'), [connected, setConnected] = useState(false), [connection, setConnection] = useState(false)
  const [packs, setPacks] = useState<InstalledResourcePack[]>(cached?.packs ?? []), [selectedPack, setSelectedPack] = useState(cached?.selected ?? '')
  const [query, setQuery] = useState(''), [search, setSearch] = useState(''), [sort, setSort] = useState<ModSort>('relevance')
  const [hits, setHits] = useState<ModSearchHit[]>([]), [total, setTotal] = useState(0), [selected, setSelected] = useState<ModSearchHit | null>(null)
  const [project, setProject] = useState<ModProject | null>(null), [versions, setVersions] = useState<ModVersion[]>([]), [versionId, setVersionId] = useState('')
  const [loading, setLoading] = useState(false), [detailsLoading, setDetailsLoading] = useState(false), [more, setMore] = useState(false)
  const [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false)
  const [downloads, setDownloads] = useState<DownloadSnapshot | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null), pageInFlight = useRef(false)
  const token = useRef(0), actionBusy = useRef(false), mounted = useRef(true)
  const contentRevision = useRef(0)
  const acceptMutation = (next: InstalledResourcePack[], results: ProfileContentUpdate[], selected = selectedPack) => {
    installedContentCache.remember(scope, { packs: next, updates: results, selected })
    if (mounted.current) { setPacks(next); setUpdates(results); setSelectedPack(selected); setInstalledLoading(false) }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!installedLoading && !error) installedContentCache.remember(scope, { packs, updates, selected: selectedPack }) }, [scope, packs, updates, selectedPack, installedLoading, error])
  useEffect(() => { window.launcher.getProviderStatus().then(status => { if (mounted.current) setConnected(status.curseforge) }).catch(() => {}) }, [])
  useEffect(() => { const timeout = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timeout) }, [query])
  useEffect(() => {
    if (!isVisible) return
    let active = true
    const sync = () => {
      if (actionBusy.current) return
      const revision = contentRevision.current
      installedContentCache.load(scope, list).then(value => { if (active && value && revision === contentRevision.current) { setPacks(value.packs); setUpdates(value.updates); setInstalledLoading(false); setError('') } }).catch(error => { if (active) { setError(String(error.message ?? error)); setInstalledLoading(false) } })
    }
    sync()
    const timer = window.setInterval(sync, 30_000)
    window.addEventListener('focus', sync)
    window.launcher.getDownloads().then(value => { if (active) setDownloads(value) }).catch(() => {})
    const off = window.launcher.on('downloads', value => { if (active) setDownloads(value) })
    return () => { active = false; off(); window.clearInterval(timer); window.removeEventListener('focus', sync) }
  }, [scope, isVisible, reload, running])
  useEffect(() => {
    const request = ++token.current
    setSelected(null); setHits([]); setTotal(0); setProject(null); setVersions([]); setVersionId(''); setMore(false)
    if (!isVisible || mode !== 'browse' || needsLoader || provider === 'curseforge' && !connected) { setLoading(false); return }
    setLoading(true); setError('')
    window.launcher.searchMods(search, gameVersion, loader, sort, 0, 'all', kind, provider)
      .then(result => { if (token.current === request) { setHits(result.hits); setTotal(result.total); setSelected(result.hits[0] ?? null) } })
      .catch(error => { if (token.current === request) setError(String(error.message ?? error)) })
      .finally(() => { if (token.current === request) setLoading(false) })
    return () => { token.current++ }
  }, [mode, provider, connected, search, sort, profile.id, gameVersion, loader, needsLoader, reload, isVisible])
  useEffect(() => {
    let active = true
    setProject(null); setVersions([]); setVersionId(''); setDetailError('')
    if (!selected || mode !== 'browse' || !isVisible) { setDetailsLoading(false); return }
    setDetailsLoading(true)
    Promise.all([window.launcher.getModProject(selected.projectId, provider), window.launcher.getModVersions(selected.projectId, gameVersion, loader, provider, false, kind)])
      .then(([project, versions]) => { if (active) { if (project.projectType !== kind) throw new Error(t('Kaynak paketi dosyası doğrulanamadı.')); setProject(project); setVersions(versions); setVersionId((versions.find(version => version.type === 'release') ?? versions[0])?.id ?? '') } })
      .catch(error => { if (active) setDetailError(String(error.message ?? error)) })
      .finally(() => { if (active) setDetailsLoading(false) })
    return () => { active = false }
  }, [selected?.projectId, provider, gameVersion, loader, kind, mode, isVisible, reload])
  const loadMore = async () => {
    if (!isVisible || mode !== 'browse' || loading || more || pageInFlight.current || hits.length >= total) return
    pageInFlight.current = true
    const request = token.current; setMore(true)
    try { const result = await window.launcher.searchMods(search, gameVersion, loader, sort, hits.length, 'all', kind, provider); if (request === token.current) { setHits(current => [...current, ...result.hits.filter(hit => !current.some(item => item.projectId === hit.projectId))]); setTotal(result.total) } }
    catch (error) { if (request === token.current) onNotice(String((error as Error).message ?? error)) }
    finally { pageInFlight.current = false; if (request === token.current) setMore(false) }
  }
  const onResultsScroll = () => {
    const element = resultsRef.current
    if (element && element.scrollTop + element.clientHeight >= element.scrollHeight - 180) void loadMore()
  }
  const enable = async (pack: InstalledResourcePack) => {
    if (actionBusy.current) return
    actionBusy.current = true; contentRevision.current++; installedContentCache.invalidate(scope); setToggling(true); setBusy(true)
    try { const next = kind === 'resourcepack' ? await window.launcher.setResourcePackEnabled(profile.id, pack.filename, !pack.enabled) : await window.launcher.setProfileContentEnabled(profile.id, kind, pack.filename, !pack.enabled); const filename = kind === 'mod' ? pack.filename.replace(/\.disabled$/i, '') + (pack.enabled ? '.disabled' : '') : pack.filename; acceptMutation(next, retainContentUpdates(packs, next, updates), filename) }
    catch (error) { onNotice(t(String((error as Error).message ?? error))) }
    finally { actionBusy.current = false; if (mounted.current) { setBusy(false); setToggling(false) } }
  }
  const install = async () => {
    if (!project || !versionId || actionBusy.current) return
    actionBusy.current = true; contentRevision.current++; installedContentCache.invalidate(scope); setBusy(true)
    try { const next = kind === 'resourcepack' ? await window.launcher.installResourcePack(profile.id, versionId, provider, { title: project.title, iconUrl: project.iconUrl }) : await window.launcher.installProfileContent(profile.id, kind, versionId, provider, { title: project.title, iconUrl: project.iconUrl }); acceptMutation(next, []); onNotice(t(copy.installed, { name: project.title })) }
    catch (error) { onNotice(t(String((error as Error).message ?? error))) }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  const checkUpdates = async (force = true) => {
    if (checkBusy.current || actionBusy.current) return
    checkBusy.current = true; if (force) setChecking(true)
    const revision = contentRevision.current
    try { const result = await window.launcher.checkProfileContentUpdates(profile.id, kind, force); const next = await list(); if (mounted.current && revision === contentRevision.current) { setUpdates(result); setPacks(next) } }
    catch (error) { if (force) onNotice(t(String((error as Error).message ?? error))) }
    finally { checkBusy.current = false; if (mounted.current && force) setChecking(false) }
  }
  useEffect(() => {
    if (!isVisible || mode !== 'installed' || !packs.length || busy || running) return
    const check = () => { if (!document.hidden && !actionBusy.current && !checkBusy.current) void checkUpdates(false) }
    const first = window.setTimeout(check, 800)
    const timer = window.setInterval(check, 10 * 60_000)
    window.addEventListener('focus', check)
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener('focus', check) }
  }, [profile.id, kind, isVisible, mode, packs.length, busy, running])
  const update = async (pack: InstalledResourcePack) => {
    if (actionBusy.current) return
    actionBusy.current = true; contentRevision.current++; installedContentCache.invalidate(scope); setBusy(true)
    try { const next = await window.launcher.updateProfileContent(profile.id, kind, pack.filename, { title: pack.title, iconUrl: pack.icon ?? null }); acceptMutation(next, updates.filter(item => item.filename !== pack.filename), next.find(item => item.provider === pack.provider && item.projectId === pack.projectId)?.filename ?? ''); onNotice(t('{name} güncellendi.', { name: pack.title })) }
    catch (error) { onNotice(t(String((error as Error).message ?? error))) }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false) }
  }
  const updateText = (value?: ProfileContentUpdate) => t(!value ? 'Güncellemeler kontrol edilmedi.' : value.status === 'update' ? 'Uyumlu güncelleme var' : value.status === 'current' ? 'Güncel ve uyumlu' : value.status === 'incompatible' ? 'Profil sürümüyle uyumsuz' : value.status === 'unknown' ? 'Kaynak bilinmiyor' : 'Kontrol başarısız')
  const changeProvider = (next: 'modrinth' | 'curseforge') => { setProvider(next); setMode('browse'); setSelected(null); setQuery(''); setSearch('') }
  const visiblePacks = packs.filter(pack => `${pack.title} ${pack.filename} ${pack.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const chosen = visiblePacks.find(pack => pack.filename === selectedPack) ?? visiblePacks[0]
  const chosenUpdate = updates.find(item => item.filename === chosen?.filename)
  const version = versions.find(version => version.id === versionId)
  const installed = packs.find(pack => pack.provider === provider && pack.projectId === project?.id)
  const activeJob = downloads?.jobs.find(job => job.profileId === profile.id && job.title === project?.title && !['completed', 'failed'].includes(job.phase))
  const num = (value: number) => new Intl.NumberFormat(language, { notation: 'compact' }).format(value)
  const packIcon = (pack?: InstalledResourcePack) => <InstalledContentIcon key={pack?.icon ?? ''} icon={pack?.icon} kind={kind} />
  return <div className="content-page resource-packs-page" data-content-kind={kind}>
    <div className="page-heading"><div><h2>{t(copy.title)}</h2><p>{t(copy.description)}</p></div>{mode === 'installed' && <button className="heading-action resource-check-updates" data-toggling={toggling} disabled={busy || checking || !packs.length} onClick={() => void checkUpdates()}>{checking ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}{t(checking ? 'Kontrol ediliyor...' : 'Güncellemeleri kontrol et')}</button>}</div>
    <div className="resource-mode-bar"><div className="mods-type-tabs" role="tablist" aria-label={t(copy.title)}><button role="tab" aria-selected={mode === 'installed'} className={mode === 'installed' ? 'active' : ''} onClick={() => { setMode('installed'); setQuery('') }}>{t('Kurulu')} <span>{packs.length}</span></button><button role="tab" aria-selected={mode === 'browse'} className={mode === 'browse' ? 'active' : ''} onClick={() => { setMode('browse'); setQuery('') }}>{t('Keşfet')}</button></div></div>
    {mode === 'installed' ? <>
      <div className="resource-installed-toolbar"><div className="mods-search resource-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t(copy.search)} placeholder={t(copy.search)} /></div></div>
      {error && <div className="mods-state error" role="alert">{t(error)}</div>}
      <div className="resource-installed-layout"><div className="resource-installed-list">
        <div className="resource-table-head"><span>{t('Etkin')}</span><span>{t(copy.item)}</span><span>{t(copy.format)}</span><span>{t('Sağlayıcı')}</span></div>
        {installedLoading ? <div className="resource-empty" role="status"><LoaderCircle size={25} className="spin" />{t(copy.loading)}</div> : !visiblePacks.length && <div className="resource-empty"><Image size={32} /><h3>{t(packs.length ? 'Sonuç bulunamadı.' : copy.empty)}</h3><p>{t('Modrinth veya CurseForge’dan bu profile bir paket indir.')}</p><button className="heading-action" onClick={() => { setMode('browse'); setQuery('') }}>{t(copy.discover)}</button></div>}
        {visiblePacks.map(pack => <div key={pack.filename} data-enabled={pack.enabled} className={`resource-pack-row ${chosen?.filename === pack.filename ? 'selected' : ''}`}>
          <button className="resource-enable" role="checkbox" aria-checked={pack.enabled} aria-label={t(copy.enable, { name: pack.title })} disabled={busy || running} onClick={() => void enable(pack)}><span className="profile-checkbox">{pack.enabled && <Check size={13} strokeWidth={3} />}</span></button>
          <button className="resource-pack-select" onClick={() => setSelectedPack(pack.filename)} aria-pressed={chosen?.filename === pack.filename}><span className="resource-pack-icon">{packIcon(pack)}</span><span><strong>{pack.title}</strong><small>{pack.description || pack.filename}</small></span></button>
          <span className="resource-format" title={updates.find(item => item.filename === pack.filename) ? updateText(updates.find(item => item.filename === pack.filename)) : undefined}><span>{pack.versionNumber || '—'}</span>{updates.find(item => item.filename === pack.filename)?.status === 'update' && <span className="resource-update-indicator">{t('Güncelleme var')}</span>}</span><span className="resource-provider" title={!pack.provider ? t('Dosya bu profilde kurulu, ancak Modrinth veya CurseForge kaynağı henüz doğrulanamadı.') : undefined}><span>{pack.provider && <img src={pack.provider === 'modrinth' ? modrinthIcon : curseforgeIcon} alt="" />}{pack.provider === 'modrinth' ? 'Modrinth' : pack.provider === 'curseforge' ? 'CurseForge' : t('Bilinmiyor')}</span></span>
        </div>)}
      </div><aside className="resource-installed-detail">{chosen ? <>
        <h3>{chosen.sourceUrl ? <button className="resource-title-link" onClick={() => void window.launcher.openExternal(chosen.sourceUrl!).catch(error => onNotice(String(error)))} aria-label={`${chosen.title}: ${t('Proje sayfasında aç')}`}><span>{chosen.title}</span><ExternalLink size={15} /></button> : chosen.title}</h3>
        {chosen.description && <p>{chosen.description}</p>}<div className="resource-detail-separator" role="separator" />
        <dl>
          <dt><FileText size={14} />{t('Dosya adı')}</dt><dd><button className="resource-file-link" title={t('Klasörde göster')} onClick={() => void window.launcher.revealProfileContent(profile.id, kind, chosen.filename).catch(error => onNotice(t(String(error.message ?? error))))}>{chosen.filename}</button></dd>
          <dt><Tag size={14} />{t('Paket sürümü')}</dt><dd>{chosen.versionNumber || '—'}</dd>
          <dt><Clock3 size={14} />{t('Son değiştirme')}</dt><dd>{new Date(chosen.modifiedAt).toLocaleString(language)}</dd>
          <dt><Globe size={14} />{t('Sağlayıcı')}</dt><dd className="resource-detail-provider">{chosen.provider && <img src={chosen.provider === 'modrinth' ? modrinthIcon : curseforgeIcon} alt="" />}{chosen.provider === 'modrinth' ? 'Modrinth' : chosen.provider === 'curseforge' ? 'CurseForge' : t('Bilinmiyor')}</dd>
        </dl>
        {!chosen.provider && <p className="resource-source-note">{t('Dosya bu profilde kurulu, ancak Modrinth veya CurseForge kaynağı henüz doğrulanamadı.')}</p>}
        <div className="resource-update-summary" data-update-status={chosenUpdate?.status ?? 'unchecked'}><strong>{updateText(chosenUpdate)}</strong>
          {chosenUpdate?.error && <p role="alert">{t(chosenUpdate.error)}</p>}
          {chosenUpdate?.compatible === false && chosenUpdate.status === 'update' && <p>{t('Kurulu sürüm bu profille uyumlu değil.')}</p>}
          {chosenUpdate?.status === 'unknown' && <p>{t('Yerel dosyalar için kaynak doğrulanmadan otomatik güncelleme yapılamaz.')}</p>}
          {chosenUpdate?.latest && <><p>{chosen.versionNumber} → {chosenUpdate.latest.versionNumber}</p><small>{chosenUpdate.latest.filename}</small><button className="heading-action resource-update-button" data-toggling={toggling && !running && !checking} disabled={busy || running || checking} onClick={() => void update(chosen)}>{busy && !toggling ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}{t('Güncelle')}</button></>}
        </div>
      </> : <p>{t(copy.details)}</p>}
      {kind === 'shader' && <p className="resource-running-note">{t('Shader paketlerini kullanmak için Iris, Oculus veya OptiFine gerekir.')} {t('Aynı anda yalnızca bir shader paketi etkin olabilir.')}</p>}
      {running && <p className="resource-running-note">{t('Paketleri değiştirmek için oyunu kapat.')}</p>}
      </aside></div>
    </> : <div className="mods-layout resource-browser-layout"><aside className="mods-source-nav" aria-label={t('Sağlayıcı')}><span className="mods-source-label">{t('KAYNAKLAR')}</span><button className={provider === 'modrinth' ? 'active' : ''} onClick={() => changeProvider('modrinth')}><img src={modrinthIcon} alt="" />Modrinth</button><button className={provider === 'curseforge' ? 'active' : ''} onClick={() => changeProvider('curseforge')}><img src={curseforgeIcon} alt="" />CurseForge</button></aside><section className="mods-main">
      <div className="resource-catalog-toolbar"><div className="mods-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t(copy.browse)} aria-label={t(copy.browse)} /></div><ModSelect value={sort} label={t('Sırala')} placeholder={t('Sırala')} onChange={value => setSort(value as ModSort)} options={(['relevance', 'downloads', 'updated', 'newest'] as const).map(value => ({ value, label: t({ relevance: 'İlgiye göre', downloads: 'En çok indirilen', updated: 'Son güncellenen', newest: 'En yeni' }[value]) }))} /></div>
      {needsLoader ? <div className="mods-state">{t('Önce bu profile mod yükleyicisini kurun.')}</div> : provider === 'curseforge' && !connected ? <div className="provider-connection-state"><img src={curseforgeIcon} alt="" /><h3>{t('CurseForge bağlantısı hazır değil')}</h3><p>{t('CurseForge kataloğu için uygulama bağlantısını yapılandır.')}</p><button className="heading-action" onClick={() => setConnection(true)}>{t('Bağlantıyı yapılandır')}</button></div> : <div className="mods-browser-body resource-catalog-body"><div className="mods-results" ref={resultsRef} onScroll={onResultsScroll}>
        {loading ? <div className="mods-state"><LoaderCircle className="spin" size={23} />{t(copy.loading)}</div> : error ? <div className="mods-state error">{t(error)}<button onClick={() => setReload(value => value + 1)}>{t('Tekrar dene')}</button></div> : !hits.length ? <div className="mods-state">{t(copy.noResults)}</div> : hits.map(hit => <button className={`mods-hit ${selected?.projectId === hit.projectId ? 'selected' : ''}`} key={hit.projectId} onClick={() => setSelected(hit)}><span className="mods-hit-icon"><InstalledContentIcon key={hit.iconUrl ?? hit.projectId} icon={hit.iconUrl ?? undefined} kind={kind} /></span><span className="mods-hit-copy"><strong>{hit.title}</strong><small>{hit.description}</small><em>{hit.author} · {num(hit.downloads)} {t('indirme')}</em></span></button>)}
        {more && <div className="resource-page-loading" role="status" aria-label={t(copy.loading)}><LoaderCircle className="spin" size={18} /></div>}
      </div><div className="mods-detail">{detailsLoading ? <div className="mods-state"><LoaderCircle className="spin" size={23} /></div> : detailError ? <div className="mods-state error">{t(detailError)}<button onClick={() => setReload(value => value + 1)}>{t('Tekrar dene')}</button></div> : project ? <>
        <div className="resource-project-overview"><div className="mods-detail-top"><span className="mods-detail-icon"><InstalledContentIcon key={project.iconUrl ?? project.id} icon={project.iconUrl ?? undefined} kind={kind} /></span><div className="mods-detail-title"><div className="mods-title-row"><h3>{project.title}</h3>{project.sourceUrl && <button className="release-link mods-project-link" title={t('Proje sayfasında aç')} aria-label={`${project.title}: ${t('Proje sayfasında aç')}`} onClick={() => window.launcher.openExternal(project.sourceUrl!).catch(error => onNotice(String(error)))}><ExternalLink size={15} /></button>}</div><small>{selected?.author} · {num(project.downloads)} {t('indirme')}</small></div></div>
        <p className="mods-detail-description">{project.description}</p>
        <div className="mods-detail-meta"><span>{t('Lisans')}: <strong>{project.license}</strong></span><span>{t('Güncelleme')}: <strong>{selected?.updated ? new Date(selected.updated).toLocaleDateString(language) : '—'}</strong></span></div>
        <div className="mods-detail-text">{plainDescription(project.body) || project.description}</div></div>
        <div className="resource-download-summary"><div className="mods-field"><span>{t('Paket sürümü')}</span><ModSelect label={t('Paket sürümü')} value={versionId} onChange={setVersionId} placeholder={t('Uyumlu paket sürümü bulunamadı.')} options={versions.map(version => ({ value: version.id, label: `${version.versionNumber} · ${t(version.type === 'release' ? 'Kararlı sürüm' : version.type === 'beta' ? 'Beta' : 'Alfa')}` }))} up /></div>
          <dl><dt><FileText size={14} />{t('Dosya adı')}</dt><dd>{version?.filename ?? '—'}</dd><dt><Globe size={14} />{t('Sağlayıcı')}</dt><dd className="resource-detail-provider"><img src={provider === 'modrinth' ? modrinthIcon : curseforgeIcon} alt="" />{provider === 'modrinth' ? 'Modrinth' : 'CurseForge'}</dd><dt><UserRound size={14} />{t('Profil')}</dt><dd>{profile.name} · Minecraft {gameVersion}</dd></dl>
          {installed && <small>{t('Kurulu')}: {installed.versionNumber}</small>}
          {activeJob && <div className="resource-download-progress"><span>{t(activeJob.detail || 'İndiriliyor...')}</span><progress max={activeJob.totalBytes || 100} value={activeJob.totalBytes ? activeJob.downloadedBytes : 0} /></div>}
          {running && <small>{t('Paketleri değiştirmek için oyunu kapat.')}</small>}
          <div className="mods-install-row"><div className="mods-detail-actions"><button className="primary resource-install-button" disabled={busy || needsLoader || !!activeJob || running || !versionId || !version?.gameVersions.includes(gameVersion) || installed?.versionId === versionId} onClick={() => void install()}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}{busy ? t('Kuruluyor...') : installed?.versionId === versionId ? t('Kurulu') : t('İndir ve kur')}</button></div></div>
        </div>
      </> : <div className="mods-state">{t(copy.details)}</div>}</div></div>}
    </section></div>}
    {connection && <CurseForgeConnection language={language} onClose={() => setConnection(false)} onConnected={() => { setConnected(true); setConnection(false); setReload(value => value + 1) }} />}
  </div>
}

function InstalledContentIcon({ icon, kind }: { icon?: string; kind: ProfileContentKind }) {
  const [failed, setFailed] = useState(false)
  const embedded = /^data:image\/(png|jpeg|webp);base64,/.test(icon ?? '') ? icon : undefined
  const [cached, setCached] = useState<string>()
  useEffect(() => {
    if (embedded || !safeIcon(icon ?? null)) return
    let active = true
    window.launcher.getContentIcon(icon!).then(value => { if (active) setCached(value) }).catch(() => {})
    return () => { active = false }
  }, [icon, embedded])
  const source = embedded ?? cached
  return source && !failed ? <img src={source} alt="" draggable={false} onError={() => setFailed(true)} /> : kind === 'mod' ? <Package size={26} /> : kind === 'shader' ? <Sparkles size={26} /> : <Image size={26} />
}
