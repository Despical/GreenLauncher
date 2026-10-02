import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ArrowRight, ChevronDown, ExternalLink, Heart, LoaderCircle, Package, Search, SlidersHorizontal, X } from 'lucide-react'
import type { GameVersion, InstalledMod, LauncherState, ModContentType, ModLoader, ModProject, ModSearchHit, ModSort, ModVersion, ModProvider, ModFavorite, LauncherPresenceContext } from '../../shared/types'
import type { Language } from './i18n'
import { translate } from './i18n'
import { DropdownOptions } from './DropdownOptions'
import { CurseForgeConnection } from './CurseForgeConnection'
import releaseIcon from '../assets/minecraft-release.png'
import modrinthIcon from '../assets/modrinth-logo.svg'
import curseforgeIcon from '../assets/curseforge.svg'
import technicIcon from '../assets/technic.png'
import neoForgeIcon from '../assets/loaders/neoforge.svg'
import forgeIcon from '../assets/loaders/forge.svg'
import fabricIcon from '../assets/loaders/fabric.png'
import quiltIcon from '../assets/loaders/quilt.svg'
import liteLoaderIcon from '../assets/loaders/liteloader.svg'

const loaders: Array<{ id: ModLoader; label: string; icon: string }> = [
  { id: 'neoforge', label: 'NeoForge', icon: neoForgeIcon }, { id: 'forge', label: 'Forge', icon: forgeIcon }, { id: 'fabric', label: 'Fabric', icon: fabricIcon }, { id: 'quilt', label: 'Quilt', icon: quiltIcon }, { id: 'liteloader', label: 'LiteLoader', icon: liteLoaderIcon }
]
const sorts: Array<{ id: ModSort; label: string }> = [
  { id: 'relevance', label: 'İlgiye göre' }, { id: 'downloads', label: 'En çok indirilen' }, { id: 'follows', label: 'En çok takip edilen' }, { id: 'newest', label: 'En yeni' }, { id: 'updated', label: 'Son güncellenen' }
]
const categories = [
  ['all', 'Tüm kategoriler'], ['adventure', 'Macera'], ['decoration', 'Dekorasyon'], ['equipment', 'Ekipman'],
  ['game-mechanics', 'Oynanış'], ['library', 'Kütüphane'], ['magic', 'Büyü'], ['mobs', 'Canlılar'],
  ['optimization', 'Performans'], ['storage', 'Depolama'], ['technology', 'Teknoloji'], ['utility', 'Araçlar'], ['worldgen', 'Dünya üretimi']
]

const compactNumber = (value: number) => new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const safeIcon = (value: string | null): string | undefined => {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && ['cdn.modrinth.com', 'media.forgecdn.net', 'mediafilez.forgecdn.net', 'cdn.technicpack.net'].includes(url.hostname) ? url.toString() : undefined }
  catch { return undefined }
}
const plainDescription = (body: string) => body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*`>|]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 5000)

function ModSelect({ value, options, onChange, label, placeholder, searchable = false, up = false, menuAction }: {
  value: string; options: Array<{ value: string; label: string; icon?: string; content?: ReactNode }>; onChange: (value: string) => void
  label: string; placeholder: string; searchable?: boolean; up?: boolean
  menuAction?: { label: string; onClick: () => void }
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const optionsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const rect = root.current?.getBoundingClientRect()
      if (!rect) return
      const anchorTop = Math.max(50, Math.min(rect.top, window.innerHeight - 34))
      const anchorBottom = Math.max(50, Math.min(rect.bottom, window.innerHeight - 34))
      const above = Math.max(0, anchorTop - 52), below = Math.max(0, window.innerHeight - anchorBottom - 38)
      const opensUp = up ? above >= Math.min(320, below) : below < Math.min(240, above)
      const height = Math.min(370, opensUp ? above : below)
      const width = Math.min(Math.max(rect.width, 190), window.innerWidth - 24)
      setMenuStyle({ position: 'fixed', width, minWidth: 0, maxHeight: height, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: opensUp ? 'auto' : anchorBottom + 6, bottom: opensUp ? window.innerHeight - anchorTop + 6 : 'auto' })
    }
    position()
    window.addEventListener('resize', position)
    document.addEventListener('scroll', position, true)
    return () => { window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true) }
  }, [open, up])
  const selected = options.find(item => item.value === value)
  const shown = options.filter(item => item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  useEffect(() => {
    if (!open || query) return
    const index = shown.findIndex(item => item.value === value)
    if (index >= 0 && optionsRef.current) optionsRef.current.scrollTop = Math.max(0, index * 39 - 75)
  }, [open])
  const choose = (next: string) => { onChange(next); setOpen(false); setQuery('') }
  const keys = (event: React.KeyboardEvent) => {
    if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); setActive(0); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(current => Math.max(0, Math.min(shown.length - 1, current + 1))) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(current => Math.max(0, current - 1)) }
    if (event.key === 'Enter' && open && shown[active]) { event.preventDefault(); choose(shown[active].value) }
  }
  return <div ref={root} className={`custom-dropdown mods-select ${open ? 'open' : ''} ${up ? 'up' : ''}`} onKeyDown={keys}>
    <button type="button" className="dropdown-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen(!open); setQuery(''); setActive(Math.max(0, options.findIndex(item => item.value === value))) }}><span className="dropdown-copy">{selected?.icon && <img className="mods-loader-icon" src={selected.icon} alt="" />}<strong>{selected?.content ?? selected?.label ?? placeholder}</strong></span><ChevronDown size={16} /></button>
    {open && createPortal(<div className="mods-select mods-select-portal"><div ref={menuRef} style={menuStyle} className="dropdown-menu" role="listbox" aria-label={label}>
      {searchable && <><div className="dropdown-search"><Search size={16} /><input autoFocus value={query} onChange={event => { setQuery(event.target.value); setActive(0) }} placeholder={placeholder} /></div><div className="dropdown-search-divider" role="separator" /></>}
      <DropdownOptions listRef={optionsRef}>{shown.length ? shown.map((item, index) => <button type="button" key={item.value} role="option" aria-selected={item.value === value} className={active === index ? 'keyboard-active' : ''} onMouseEnter={() => setActive(index)} onClick={() => choose(item.value)}>{item.icon && <img className="mods-loader-icon" src={item.icon} alt="" />}<span className="dropdown-option-copy"><strong>{item.content ?? item.label}</strong></span></button>) : <div className="dropdown-empty">{placeholder}</div>}</DropdownOptions>
      {menuAction && <div className="dropdown-action-section"><div className="dropdown-action-divider" role="separator" /><button type="button" className="dropdown-menu-action" onClick={menuAction.onClick}>{menuAction.label}</button></div>}
    </div></div>, document.body)}
  </div>
}

export function ModsPage({ state, versions, language, onState, onNotice, onDownloads, onPresenceChange }: {
  state: LauncherState; versions: GameVersion[]; language: Language
  onState: (state: LauncherState) => void; onNotice: (message: string) => void
  onDownloads: () => void
  onPresenceChange?: (context: LauncherPresenceContext) => void
}) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [source, setSource] = useState<'custom' | ModProvider>('custom')
  const [connected, setConnected] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [providerCategories, setProviderCategories] = useState<Array<{value:string;label:string}>>([])
  const [reload, setReload] = useState(0)
  const provider: ModProvider = source === 'custom' ? 'modrinth' : source
  const providerName = source === 'curseforge' ? 'CurseForge' : source === 'technic' ? 'Technic' : 'Modrinth'
  useEffect(() => { window.launcher.getProviderStatus().then(value => setConnected(value.curseforge)).catch(() => {}) }, [])
  const [contentType, setContentType] = useState<ModContentType>('mod')
  const [showFavorites, setShowFavorites] = useState(false)
  useEffect(() => { onPresenceChange?.({ page: 'mods', section: source, contentType, favorites: showFavorites }) }, [source, contentType, showFavorites, onPresenceChange])
  const [favorites, setFavorites] = useState<ModFavorite[]>([])
  const [savingFavorite, setSavingFavorite] = useState(false)
  useEffect(() => { window.launcher.getModFavorites().then(setFavorites).catch(error => onNotice(String(error))) }, [])
  const [profileId, setProfileId] = useState(state.selectedProfileId ?? state.profiles[0]?.id ?? '')
  const profile = state.profiles.find(item => item.id === profileId)
  const releaseVersions = versions.filter(item => item.type === 'release')
  const baseVersion = (value?: string) => releaseVersions.find(item => item.id === value || value?.startsWith(`${item.id}-`))?.id ?? releaseVersions[0]?.id ?? ''
  const [gameVersion, setGameVersion] = useState(baseVersion(profile?.versionId))
  useEffect(() => { if (!gameVersion && releaseVersions.length) setGameVersion(baseVersion(profile?.versionId)) }, [gameVersion, releaseVersions.length, profile?.versionId])
  const [loader, setLoader] = useState<ModLoader>(profile?.modLoader ?? 'fabric')
  const [sort, setSort] = useState<ModSort>('relevance')
  const [category, setCategory] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchText, setSearchText] = useState('')
  const [hits, setHits] = useState<ModSearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<(ModSearchHit & { selectionKey: string }) | null>(null)
  const [project, setProject] = useState<ModProject | null>(null)
  const [projectVersions, setProjectVersions] = useState<ModVersion[]>([])
  const [allGameVersions, setAllGameVersions] = useState(false)
  const [versionId, setVersionId] = useState('')
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [installed, setInstalled] = useState<InstalledMod[]>([])
  const pending = useRef(new Set<string>())
  const [pendingKeys, setPendingKeys] = useState<string[]>([])
  const currentProfileId = useRef(profileId)
  currentProfileId.current = profileId
  const loaderKey = `loader:${profileId}:${gameVersion}:${loader}`
  const contentKey = `${provider}:${project?.projectType ?? contentType}:${versionId}:${project?.projectType === 'modpack' ? '' : profileId}`
  const installing = pendingKeys.includes(contentKey)
  const installingLoader = pendingKeys.includes(loaderKey)
  const begin = (key: string) => { if (pending.current.has(key)) { onDownloads(); return false }; pending.current.add(key); setPendingKeys([...pending.current]); return true }
  const finish = (key: string) => { pending.current.delete(key); setPendingKeys([...pending.current]) }
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchToken = useRef(0)
  const pageInFlight = useRef(false)
  const selectionKey = JSON.stringify([source, gameVersion, loader, contentType, searchText, sort, category, reload, showFavorites])

  const selectSource = (next: 'custom' | ModProvider) => {
    searchToken.current++
    setSelected(null); setHits([]); setProject(null); setProjectVersions([]); setVersionId(''); setDetailsLoading(false)
    setShowFavorites(false)
    setSource(next); setCategory('all'); setSort('relevance'); setQuery(''); setSearchText(''); setError('')
    setContentType(next === 'technic' ? 'modpack' : 'mod')
    setGameVersion(next === 'technic' ? 'all' : baseVersion(profile?.versionId))
  }
  useEffect(() => { setProfileId(state.selectedProfileId ?? state.profiles[0]?.id ?? ''); setInstalled([]) }, [state.selectedAccountId])
  useEffect(() => {
    if(source !== 'curseforge' || !connected) { setProviderCategories([]); return }
    let active=true
    window.launcher.getModCategories('curseforge',contentType).then(value=>{if(active)setProviderCategories(value)}).catch(()=>{if(active)setProviderCategories([])})
    return()=>{active=false}
  },[source,contentType,connected])
  useEffect(() => { const timer = window.setTimeout(() => setSearchText(query), 350); return () => window.clearTimeout(timer) }, [query])
  useEffect(() => { if (!profileId && state.profiles.length) chooseProfile(state.selectedProfileId ?? state.profiles[0].id) }, [profileId, state.profiles.length, state.selectedProfileId])
  useEffect(() => {
    if (!profileId) { setInstalled([]); return }
    let active = true
    window.launcher.getInstalledMods(profileId).then(items => { if (active) setInstalled(items) }).catch(() => { if (active) setInstalled([]) })
    return () => { active = false }
  }, [profileId])
  useEffect(() => {
    if (source === 'custom' || (!gameVersion && !showFavorites) || (source === 'curseforge' && !connected)) { setHits([]); setSelected(null); setTotal(0); setLoading(false); return }
    const token = ++searchToken.current
    resultsRef.current?.scrollTo({ top: 0 })
    if (showFavorites) {
      const saved = favorites.filter(item => item.provider === provider && `${item.title} ${item.description} ${item.author}`.toLocaleLowerCase().includes(searchText.toLocaleLowerCase()))
      setHits(saved); setTotal(saved.length); setLoading(false); setLoadingMore(false); setError('')
      setSelected(current => saved.some(item => item.projectId === current?.projectId) ? current?.selectionKey === selectionKey ? current : { ...current!, selectionKey } : saved[0] ? { ...saved[0], selectionKey } : null)
      return () => { if (token === searchToken.current) searchToken.current++ }
    }
    setHits([]); setTotal(0); setSelected(null); setProject(null); setError(''); setLoading(true); setLoadingMore(false)
    window.launcher.searchMods(searchText, gameVersion, loader, sort, 0, category, contentType, provider)
      .then(result => { if (token === searchToken.current) { setHits(result.hits); setTotal(result.total); setSelected(result.hits[0] ? { ...result.hits[0], selectionKey } : null) } })
      .catch(reason => { if (token === searchToken.current) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (token === searchToken.current) setLoading(false) })
    return () => { if(token === searchToken.current) searchToken.current++ }
  }, [source, searchText, gameVersion, loader, sort, category, contentType, connected, reload, showFavorites, showFavorites ? favorites : null])
  useEffect(() => {
    // A selected result belongs to its original source and filters. Never send
    // an old result to the next provider while React is clearing the search.
    if (!selected || selected.selectionKey !== selectionKey || source === 'custom' || (source === 'curseforge' && !connected)) { setProject(null); setProjectVersions([]); setVersionId(''); setDetailsLoading(false); return }
    let active = true
    setDetailsLoading(true); setProject(null); setProjectVersions([]); setVersionId('')
    window.launcher.getModProject(selected.projectId, provider)
      .then(details => { if (active) setProject(details) })
      .catch(reason => { if (active) onNotice(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (active) setDetailsLoading(false) })
    return () => { active = false }
  }, [selected, selectionKey, connected])
  useEffect(() => {
    if (!selected || selected.selectionKey !== selectionKey || source === 'custom' || (source === 'curseforge' && !connected)) { setProjectVersions([]); setVersionId(''); return }
    let active = true
    window.launcher.getModVersions(selected.projectId, gameVersion, loader, provider, allGameVersions)
      .then(items => { if (active) { setProjectVersions(items); setVersionId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? '') } })
      .catch(reason => { if (active) onNotice(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [selected, selectionKey, connected, allGameVersions])

  const loadMore = async () => {
    if (showFavorites || pageInFlight.current || loading || loadingMore || hits.length >= total || !gameVersion) return
    pageInFlight.current = true
    setLoadingMore(true)
    const token = searchToken.current
    try {
      const result = await window.launcher.searchMods(searchText, gameVersion, loader, sort, hits.length, category, contentType, provider)
      if (token === searchToken.current) { setHits(current => [...current, ...result.hits]); setTotal(result.total) }
    } catch (reason) { if (token === searchToken.current) onNotice(reason instanceof Error ? reason.message : String(reason)) }
    finally { pageInFlight.current = false; if (token === searchToken.current) setLoadingMore(false) }
  }
  const onResultsScroll = () => {
    const element = resultsRef.current
    if (element && element.scrollTop + element.clientHeight >= element.scrollHeight - 180) void loadMore()
  }
  const chooseProfile = (id: string) => {
    setProfileId(id)
    const selectedProfile = state.profiles.find(item => item.id === id)
    if (selectedProfile) { setGameVersion(baseVersion(selectedProfile.versionId)); setLoader(selectedProfile.modLoader ?? 'fabric') }
  }
  const loaderReady = !!profile && profile.versionId === gameVersion && profile.modLoader === loader && !!profile.modLoaderVersion
  const selectedType = project?.projectType ?? favorites.find(item => item.provider === provider && item.projectId === selected?.projectId)?.contentType ?? contentType
  const packBrowsing = source !== 'custom' && (showFavorites ? selectedType === 'modpack' : contentType === 'modpack')
  const noSavedFavorites = showFavorites && !favorites.some(item => item.provider === provider)
  const favoriteSaved = !!selected && favorites.some(item => item.provider === provider && item.projectId === selected.projectId)
  const versionMismatch = provider !== 'technic' && projectVersions.find(item => item.id === versionId)?.gameVersions.includes(gameVersion) === false
  const installNote = versionMismatch ? t('Bu sürüm için yukarıdan uygun Minecraft sürümünü seç.') : selectedType === 'modpack' ? t('Mod paketi ayrı bir profil olarak kurulur. İsteğe bağlı dosyalar atlanır.') : !loaderReady ? t('Kurmak için önce yukarıdan yükleyiciyi kur.') : ''
  const toggleFavorite = async () => {
    if (!selected || !project || savingFavorite) return
    setSavingFavorite(true)
    try { setFavorites(await window.launcher.setModFavorite({ ...selected, provider, contentType: project.projectType, savedAt: new Date().toISOString() }, !favoriteSaved)); onNotice(t(favoriteSaved ? 'Favorilerden kaldırıldı.' : 'Favorilere eklendi.')) }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)) }
    finally { setSavingFavorite(false) }
  }
  const installLoader = async () => {
    if (!profile) return
    if (profile.versionId !== gameVersion) { onNotice(t('Bu profil farklı bir Minecraft sürümüne ait. Uygun profili seç veya yeni profil oluştur.')); return }
    const key = loaderKey
    if (!begin(key)) return
    try {
      const updated = await window.launcher.installModLoader(profile.id, gameVersion, loader)
      onState(updated)
      onNotice(`${loaders.find(item => item.id === loader)?.label} kuruldu. ${profile.name} profili hazır.`)
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : String(reason)) }
    finally { finish(key) }
  }
  const install = async () => {
    if (!profile || !versionId) return
    const key = contentKey, targetProfileId = profile.id
    if (!begin(key)) return
    try {
      const items = await window.launcher.installMod(profile.id, versionId, provider, project ? { title: project.title, iconUrl: project.iconUrl } : undefined)
      if (currentProfileId.current === targetProfileId) setInstalled(items)
      onNotice(`${project?.title ?? selected?.title ?? 'Mod'} ve gerekli bağımlılıklar kuruldu.`)
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : String(reason)) }
    finally { finish(key) }
  }
  const installPack = async () => {
    if (!versionId) return
    const key = contentKey
    if (!begin(key)) return
    try {
      const result = await window.launcher.installModpack(versionId, gameVersion, loader, provider, project ? { title: project.title, iconUrl: project.iconUrl } : undefined)
      onState(result.state)
      onNotice(t('{name} yeni profil olarak kuruldu.', { name: project?.title ?? selected?.title ?? t('Mod paketi') }))
    } catch (reason) { onNotice(reason instanceof Error ? reason.message : String(reason)) }
    finally { finish(key) }
  }

  return <div className="mods-page content-page">
    <div className="page-heading"><div><h2>{t('Modlar')}</h2><p>{t('Modları ve mod paketlerini keşfet, uygun sürümü kur.')}</p></div></div>
    <div className="mods-layout">
      <aside className="mods-source-nav" aria-label={t('Mod kaynağı')}>
        <span className="mods-source-label">{t('KAYNAKLAR')}</span>
        <button className={source === 'custom' ? 'active' : ''} onClick={() => selectSource('custom')}><img src={releaseIcon} alt="" /> {t('Özel')}</button>
        <button className={source === 'modrinth' ? 'active' : ''} onClick={() => selectSource('modrinth')}><img src={modrinthIcon} alt="" /> Modrinth</button>
        <button className={source === 'curseforge' ? 'active' : ''} onClick={() => selectSource('curseforge')}><img src={curseforgeIcon} alt="" /> CurseForge</button>
        <button className={source === 'technic' ? 'active' : ''} onClick={() => selectSource('technic')}><img src={technicIcon} alt="" /> Technic</button>
        <div className="mods-source-foot" title={profile?.modpack?.title}><Package size={17} /><span>{profile ? profile.modpack ? t('Mod paketi kurulu') : `${installed.length} ${t('kurulu mod')}` : t('Profil seç')}</span></div>
      </aside>
      <section className={`mods-main ${source === 'curseforge' && !connected && !showFavorites ? 'provider-unavailable' : ''}`}>
        <div className="mods-setup">
          <div className="mods-setup-heading"><span className="mods-setup-icon"><img src={releaseIcon} alt="" /></span><div><strong>Minecraft · {source === 'custom' ? t('Özel') : providerName}</strong><small>{source === 'technic' ? t('Paketin oyun sürümü ve yükleyicisi kurulumda otomatik seçilir.') : t('Önce sürümü, sonra mod yükleyicisini seç.')}</small></div></div>
          <div className={`mods-setup-fields ${packBrowsing ? 'pack' : ''}`}>
            {!packBrowsing && <div className="mods-field"><span>{t('Profil')}</span><ModSelect label={t('Profil')} value={profileId} onChange={chooseProfile} options={state.profiles.map(item => ({ value: item.id, label: item.name }))} placeholder={t('Profil seç')} searchable /></div>}
            <div className="mods-field"><span>{t('Minecraft sürümü')}</span><ModSelect label={t('Minecraft sürümü')} value={gameVersion} onChange={setGameVersion} options={[...(source === 'technic' ? [{value:'all',label:t('Tüm sürümler')}] : []), ...releaseVersions.map(item => ({ value: item.id, label: item.id }))]} placeholder={t('Sürüm ara')} searchable /></div>
            {source !== 'technic' && <div className="mods-field"><span>{t('Mod yükleyicisi')}</span><ModSelect label={t('Mod yükleyicisi')} value={loader} onChange={value => setLoader(value as ModLoader)} options={loaders.map(item => ({ value: item.id, label: item.label, icon: item.icon }))} placeholder={t('Mod yükleyicisi')} /></div>}
          </div>
          {packBrowsing ? <div className="mods-loader-row"><span>{t('Mod paketi için ayrı bir profil oluşturulur.')}</span></div> : <div className="mods-loader-row"><span>{loaderReady ? <>{t('Bu profile yüklendi')} · {profile?.modLoaderVersion}</> : loader === 'liteloader' ? t('LiteLoader yalnızca desteklenen eski sürümlerde kurulabilir.') : t('Modları çalıştırmak için yükleyiciyi bu profile kur.')}</span><button className="heading-action primary" disabled={!profile || !gameVersion || profile.versionId !== gameVersion || (loaderReady && !installingLoader)} onClick={installingLoader ? onDownloads : installLoader}>{installingLoader ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}{installingLoader ? t('Kuruluyor...') : t('Yükleyiciyi kur')}</button></div>}
        </div>
        {source === 'custom' ? <div className="mods-welcome"><img src={releaseIcon} alt="" /><h3>{t('Modlarını kendi dünyana ekle.')}</h3><p>{t('Minecraft sürümünü ve yükleyicisini seç. Kaynaklardan modları ve mod paketlerini keşfet.')}</p><button onClick={() => selectSource('modrinth')}>Modrinth’te {t('modları keşfet')} <ArrowRight size={16} /></button></div> : <>
          <div className="mods-browser-heading"><div><strong>{providerName}</strong><small>{showFavorites ? t('Kaydettiğin modlar ve paketler') : source === 'technic' ? t('Technic mod paketlerini keşfet') : contentType === 'modpack' ? t('Seçili sürüm ve yükleyiciye uygun mod paketleri') : t('Seçili sürüm ve yükleyiciye uygun modlar')}</small></div></div>
          <div className="mods-type-row"><div className="mods-type-tabs" role="tablist" aria-label={t('İçerik türü')}>
            {source !== 'technic' && <button role="tab" aria-selected={!showFavorites && contentType === 'mod'} className={!showFavorites && contentType === 'mod' ? 'active' : ''} onClick={() => { setShowFavorites(false); setContentType('mod'); setCategory('all') }}>{t('Modlar')}</button>}
            <button role="tab" aria-selected={!showFavorites && contentType === 'modpack'} className={!showFavorites && contentType === 'modpack' ? 'active' : ''} onClick={() => { setShowFavorites(false); setContentType('modpack'); setCategory('all') }}>{t('Mod paketleri')}</button>
            <button role="tab" aria-selected={showFavorites} className={showFavorites ? 'active' : ''} onClick={() => { setShowFavorites(true); setFiltersOpen(false) }}>{t('Favoriler')}</button>
          </div><span className="mods-result-count">{total ? `${compactNumber(total)} ${t('sonuç')}` : ''}</span></div>
          {!noSavedFavorites && <div className="mods-toolbar"><div className="mods-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={showFavorites ? t('Favorilerde ara...') : contentType === 'modpack' ? t('Mod paketi ara...') : t('Mod ara...')} />{query && <button aria-label={t('Aramayı temizle')} onClick={() => setQuery('')}><X size={15} /></button>}</div>{!showFavorites && <button className={`mods-filter-button ${filtersOpen ? 'active' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}><SlidersHorizontal size={17} /> {t('Filtreler')} <ChevronDown size={15} /></button>}</div>}
          {filtersOpen && !showFavorites && <div className="mods-filters">{source !== 'technic' && <div className="mods-field"><span>{t('Kategori')}</span><ModSelect label={t('Kategori')} value={category} onChange={setCategory} options={source === 'curseforge' ? [{value:'all',label:t('Tüm kategoriler')}, ...providerCategories] : categories.map(([id, label]) => ({ value: id, label: t(label) }))} placeholder={t('Tüm kategoriler')} /></div>}<div className="mods-field"><span>{t('Sırala')}</span><ModSelect label={t('Sırala')} value={sort} onChange={value => setSort(value as ModSort)} options={sorts.filter(item => source !== 'technic' || ['relevance','downloads','updated'].includes(item.id)).map(item => ({ value: item.id, label: t(item.label) }))} placeholder={t('Sırala')} /></div></div>}
          {source === 'curseforge' && !connected && !showFavorites ? <div className="provider-connection-state"><img src={curseforgeIcon} alt="" /><h3>{t('CurseForge bağlantısı hazır değil')}</h3><p>{t('CurseForge kataloğu için uygulama bağlantısını yapılandır.')}</p><button className="heading-action primary" onClick={() => setConnectionOpen(true)}>{t('Bağlantıyı yapılandır')} <ArrowRight size={16}/></button><button className="provider-browse-link" onClick={()=>window.launcher.openExternal('https://www.curseforge.com/minecraft/search?class=mc-mods').catch(error=>onNotice(String(error)))}>{t('CurseForge’da keşfet')}</button></div>  : showFavorites && !loading && !hits.length ? <div className="mods-favorites-empty">
            <h3>{t(searchText && favorites.some(item => item.provider === provider) ? 'Sonuç bulunamadı.' : 'Henüz favorin yok')}</h3>
            <p>{t('Beğendiğin modları ve paketleri kalp simgesiyle kaydet; daha sonra burada bulabilirsin.')}</p>
            <button className="heading-action primary" onClick={() => { if (source === 'curseforge' && !connected) { void window.launcher.openExternal('https://www.curseforge.com/minecraft/search?class=mc-mods').catch(error => onNotice(String(error))); return }; setShowFavorites(false); setQuery(''); setSearchText(''); setCategory('all'); setContentType(source === 'technic' ? 'modpack' : 'mod') }}>{t(source === 'technic' ? '{provider} paketlerini keşfet' : '{provider} modlarını keşfet', { provider: providerName })}<ArrowRight size={17} /></button>
          </div> : <div className="mods-browser-body">
            <div className="mods-results" ref={resultsRef} onScroll={onResultsScroll}>
              {loading && <div className="mods-state"><LoaderCircle className="spin" size={23} /> {contentType === 'modpack' ? t('Mod paketleri yükleniyor...') : t('Modlar yükleniyor...')}</div>}
              {!loading && error && <div className="mods-state error">{error}<button onClick={() => { setReload(value => value + 1) }}>{t('Tekrar dene')}</button></div>}
              {!loading && !error && !hits.length && <div className="mods-state">{showFavorites ? t('Henüz favori yok. Beğendiğin projeleri kalp simgesiyle kaydet.') : contentType === 'modpack' ? t('Bu filtrelere uygun mod paketi bulunamadı.') : t('Bu filtrelere uygun mod bulunamadı.')}</div>}
              {!loading && hits.map(hit => <button className={`mods-hit ${selected?.projectId === hit.projectId ? 'selected' : ''}`} key={hit.projectId} onClick={() => setSelected({ ...hit, selectionKey })}><span className="mods-hit-icon">{safeIcon(hit.iconUrl) ? <img src={safeIcon(hit.iconUrl)} alt="" /> : <Package size={23} />}</span><span className="mods-hit-copy"><strong>{hit.title}</strong><small>{hit.description}</small><em>{hit.author} · {compactNumber(hit.downloads)} {t('indirme')}</em></span></button>)}
              {loadingMore && <div className="mods-more"><LoaderCircle className="spin" size={18} /> {contentType === 'modpack' ? t('Daha fazla mod paketi yükleniyor...') : t('Daha fazla mod yükleniyor...')}</div>}
              {!loading && hits.length < total && !loadingMore && <button className="mods-load-more" onClick={() => void loadMore()}>{t('Daha fazla göster')}</button>}
            </div>
            <div className="mods-detail">
              {selected ? <>{detailsLoading ? <div className="mods-state"><LoaderCircle className="spin" size={23} /></div> : project && <>
                <div className="mods-detail-top"><span className="mods-detail-icon">{safeIcon(project.iconUrl) ? <img src={safeIcon(project.iconUrl)} alt="" /> : <Package size={31} />}</span><div className="mods-detail-title"><div className="mods-title-row"><h3>{project.title}</h3>{project.sourceUrl && <button className="release-link mods-project-link" title={t('Proje sayfasında aç')} aria-label={`${project.title}: ${t('Proje sayfasında aç')}`} onClick={() => window.launcher.openExternal(project.sourceUrl!).catch(error => onNotice(String(error)))}><ExternalLink size={15} /></button>}</div><small>{selected.author} · {compactNumber(project.downloads)} {t('indirme')}</small></div><button className={`mods-favorite ${favoriteSaved ? 'saved' : ''}`} aria-label={favoriteSaved ? t('Favorilerden kaldır') : t('Favorilere ekle')} title={favoriteSaved ? t('Favorilerden kaldır') : t('Favorilere ekle')} aria-pressed={favoriteSaved} disabled={savingFavorite} onClick={() => void toggleFavorite()}><Heart size={20} /></button></div>
                <p className="mods-detail-description">{project.description}</p>
                <div className="mods-detail-meta"><span>{t('Lisans')}: <strong>{project.license}</strong></span><span>{t('Güncelleme')}: <strong>{selected.updated ? new Date(selected.updated).toLocaleDateString(language) : '—'}</strong></span></div>
                <div className="mods-detail-text">{plainDescription(project.body) || project.description}</div>
                <div className="mods-detail-footer">
                  <div className="mods-field"><span>{selectedType === 'modpack' ? t('Paket sürümü') : t('Mod sürümü')}</span><ModSelect label={selectedType === 'modpack' ? t('Paket sürümü') : t('Mod sürümü')} value={versionId} onChange={setVersionId} options={projectVersions.map(item => {
                    const kind = item.type === 'recommended' ? t('Önerilen') : item.type === 'release' ? t('Kararlı sürüm') : item.type === 'beta' ? t('Beta') : item.type === 'alpha' ? t('Alfa') : item.type
                    const games = item.gameVersions.includes(gameVersion) ? [gameVersion, ...item.gameVersions.filter(value => value !== gameVersion)] : item.gameVersions
                    const game = games.slice(0, 2).join(', ') + (games.length > 2 ? ` +${games.length - 2}` : '')
                    return { value: item.id, label: `${item.versionNumber} • ${kind} • for ${game}`, content: <span className="mod-version-copy">{item.versionNumber}<b>•</b>{kind}<b>•</b><span>for {game || '—'}</span></span> }
                  })} placeholder={t('Sürüm ara')} searchable up menuAction={provider !== 'technic' ? { label: t(allGameVersions ? 'Yalnızca seçili Minecraft sürümü' : 'Diğer Minecraft sürümlerini de göster'), onClick: () => setAllGameVersions(value => !value) } : undefined} /></div>
                  {!projectVersions.length && <small>{selectedType === 'modpack' ? t('Uyumlu paket sürümü bulunamadı.') : t('Uyumlu mod sürümü bulunamadı.')}</small>}
                  {selectedType === 'mod' && installed.some(item => item.projectId === project.id && (item.provider ?? 'modrinth') === provider) && <small>{t('Kurulu')}: {installed.find(item => item.projectId === project.id && (item.provider ?? 'modrinth') === provider)?.versionNumber}</small>}
                  <div className="mods-install-row"><small className="mods-install-note">{installNote}</small>
                    <div className="mods-detail-actions"><button className="primary" disabled={!installing && (!state.selectedAccountId || !(selectedType === 'modpack' || loaderReady) || !versionId || (provider !== 'technic' && projectVersions.find(item => item.id === versionId)?.gameVersions.includes(gameVersion) === false))} onClick={installing ? onDownloads : selectedType === 'modpack' ? installPack : install}>{installing ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}{installing ? t('Kuruluyor...') : selectedType === 'modpack' ? t('Yeni profil olarak kur') : t('İndir ve kur')}</button></div>
                  </div>
                </div>
              </>}</> : <div className="mods-state">{contentType === 'modpack' ? t('Bilgilerini görmek için bir mod paketi seç.') : t('Bilgilerini görmek için bir mod seç.')}</div>}
            </div>
          </div>}
        </>}
      </section>
      {connectionOpen && <CurseForgeConnection language={language} onClose={() => setConnectionOpen(false)} onConnected={() => { setConnected(true); setConnectionOpen(false); setReload(value => value + 1) }} />}
    </div>
  </div>
}
