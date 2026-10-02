import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Copy, FolderOpen, Globe2, Info, KeyRound, LoaderCircle, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { LauncherState, LaunchRequest, RunningInstance, SavedWorld } from '../../shared/types'
import { serverLaunchMode } from '../../shared/server-launch'
import { profileLaunchVersion } from '../../shared/profile-version'
import { diagnoseError } from '../../shared/errors'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import defaultIcon from '../assets/minecraft-server-default.png'
import './servers.css'
import './worlds.css'

type Props = {
  state: LauncherState; language: Language; launchBusy: boolean; instances: RunningInstance[]; isVisible: boolean
  onNotice: (message: string) => void; onJoin: (request: LaunchRequest) => void; onCreateProfile: () => void
  profilePicker: (value: string, onChange: (id: string) => void, disabled: boolean) => ReactNode
}
export function WorldsPage({ state, language, launchBusy, instances, isVisible, onNotice, onJoin, onCreateProfile, profilePicker }: Props) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [choice, setChoice] = useState(state.selectedProfileId ?? state.profiles[0]?.id ?? '')
  const profile = state.profiles.find(item => item.id === choice) ?? state.profiles.find(item => item.id === state.selectedProfileId) ?? state.profiles[0]
  const profileId = profile?.id, scope = `${state.selectedAccountId}:${profileId}`, current = useRef(scope); current.current = scope
  const [worlds, setWorlds] = useState<SavedWorld[]>([]), [selected, setSelected] = useState(''), [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false)
  const [renaming, setRenaming] = useState<SavedWorld | null>(null), [name, setName] = useState(''), [deleting, setDeleting] = useState<SavedWorld | null>(null), [error, setError] = useState('')
  const request = useRef(0), busy = useRef(false)
  const update = async (refresh = false, select?: string) => {
    if (!profileId) return
    const revision = ++request.current
    const items = await window.launcher.getWorlds(profileId, refresh)
    if (current.current !== scope || request.current !== revision) return
    setWorlds(old => JSON.stringify(old) === JSON.stringify(items) ? old : items)
    setSelected(old => items.some(item => item.id === (select ?? old)) ? select ?? old : items[0]?.id ?? '')
  }
  useEffect(() => {
    if (!isVisible) return
    let cancelled = false, fetching = false, previousError = ''
    setWorlds([]); setSelected(''); setRenaming(null); setDeleting(null); setError(''); setLoading(!!profileId)
    const sync = async () => {
      if (!profileId || fetching || busy.current) return
      fetching = true
      try { await update(); previousError = '' } catch (reason) {
        if (!cancelled && current.current === scope) { const message = diagnoseError(reason).message; if (message !== previousError) onNotice(t(message)); previousError = message }
      } finally { fetching = false; if (!cancelled && current.current === scope) setLoading(false) }
    }
    void sync(); const timer = window.setInterval(() => void sync(), 5000)
    window.addEventListener('focus', sync)
    return () => { cancelled = true; request.current++; window.clearInterval(timer); window.removeEventListener('focus', sync) }
  }, [scope, isVisible])
  const world = worlds.find(item => item.id === selected)
  const filtered = worlds.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)))
  const mode = (item: SavedWorld) => item.hardcore ? t('Zorlu') : (item.gameMode !== undefined && Number.isInteger(item.gameMode) && item.gameMode >= 0 && item.gameMode <= 3 ? t(['Hayatta kalma', 'Yaratıcı', 'Macera', 'İzleyici'][item.gameMode]) : '—')
  const date = (value?: number) => value ? new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(value) : '—'
  const size = (value?: number) => value === undefined ? '—' : value < 1024 ? `${value} B` : `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / (value >= 1024 ** 3 ? 1024 ** 3 : value >= 1024 ** 2 ? 1024 ** 2 : 1024))} ${value >= 1024 ** 3 ? 'GB' : value >= 1024 ** 2 ? 'MB' : 'KB'}`
  const running = instances.some(item => item.profileId === profileId || state.profiles.find(other => other.id === item.profileId)?.gameDirectory && state.profiles.find(other => other.id === item.profileId)?.gameDirectory === profile?.gameDirectory)
  const supported = profile && serverLaunchMode(profileLaunchVersion(profile)) === 'quick-play'
  const locked = pending || loading || launchBusy || running
  const act = async (action: () => Promise<string | void | null>, notice: string, dialog = false) => {
    if (busy.current) return
    busy.current = true; request.current++; setPending(true); setError('')
    try {
      const id = await action()
      if (current.current !== scope) return
      if (id === null) return
      await update(true, typeof id === 'string' ? id : undefined)
      setRenaming(null); setDeleting(null); onNotice(t(notice))
    } catch (reason) { if (current.current === scope) { const message = t(diagnoseError(reason).message); if (dialog) setError(message); else onNotice(message) } }
    finally { busy.current = false; setPending(false) }
  }
  const join = (item: SavedWorld) => {
    if (!profileId || !state.selectedAccountId || locked || !supported) return
    onJoin({ profileId, accountId: state.selectedAccountId, worldId: item.id })
  }
  return <div className="content-page servers-page worlds-page">
    <div className="page-heading"><div><h2>{t('Dünyalar')}</h2><p>{t('Profilindeki dünyaları keşfet ve macerana devam et.')}</p></div><div className="servers-heading-actions"><button className="heading-action" disabled={!profileId || pending || loading} onClick={() => void act(async () => { await update(true) }, 'Dünya listesi güncellendi.')}><RefreshCw size={17} className={pending ? 'spin' : ''} />{t('Listeyi yenile')}</button><button className="heading-action primary" disabled={!profileId || locked} onClick={() => void act(() => window.launcher.importWorld(profileId!), 'Dünya eklendi.')}><Plus size={17} />{t('Dünya ekle')}</button></div></div>
    {!profileId ? <div className="servers-list-panel servers-empty worlds-profile-required"><Globe2 size={36} /><h3>{t('Önce bir profil oluştur')}</h3><p>{t('Dünyalarını görmek ve eklemek için önce bir profil oluştur.')}</p><button className="secondary" onClick={onCreateProfile}><Plus size={16} />{t('Yeni profil')}</button></div> : <div className="servers-workspace">
      <section className="servers-list-panel"><div className="servers-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Dünya ara') + '...'} /></div>{profilePicker(profileId, setChoice, pending || loading)}</div>
        <div className="worlds-table-head"><span>{t('Dünya adı ve ikonu')}</span><span>{t('Oyun modu')}</span><span>{t('Son oynanma')}</span><span>{t('Boyut')}</span></div>
        <div className="servers-list">{loading ? <div className="servers-empty"><LoaderCircle size={25} className="spin" />{t('Dünyalar yükleniyor...')}</div> : !worlds.length ? <div className="servers-empty"><Globe2 size={34} /><h3>{t('Henüz dünya yok')}</h3><p>{t('Oyunda oluşturduğun dünyalar burada görünür. Bir dünya klasörünü de elle ekleyebilirsin.')}</p><button className="secondary" disabled={locked} onClick={() => void act(() => window.launcher.importWorld(profileId), 'Dünya eklendi.')}><Plus size={16} />{t('Dünya ekle')}</button></div> : !filtered.length ? <div className="servers-empty"><Search size={25} />{t('Bu aramada dünya bulunamadı.')}</div> : filtered.map(item => <div className={`server-row ${selected === item.id ? 'selected' : ''}`} key={item.id}><button className="world-select" aria-pressed={selected === item.id} aria-label={item.name} onClick={() => setSelected(item.id)} onDoubleClick={() => join(item)}>
          <span className="world-identity"><span className="server-icon"><img src={item.icon ?? defaultIcon} alt="" draggable={false} /></span><strong title={item.name}>{item.name}</strong></span><span title={mode(item)}>{mode(item)}</span><span title={date(item.lastPlayed)}>{date(item.lastPlayed)}</span><span>{size(item.size)}</span>
        </button></div>)}</div>
      </section>
      <aside className="server-details"><div className="server-details-heading"><h3>{t('Dünya bilgileri')}</h3><p>{t('Seçili dünyanı buradan yönet.')}</p></div>{world ? <>
        <div className="server-details-identity world-details-identity"><span className="server-icon"><img src={world.icon ?? defaultIcon} alt="" /></span><div><h3 title={world.name}>{world.name}</h3></div></div>
        <dl className="server-facts"><div><dt>{t('Oyun modu')}</dt><dd>{mode(world)}</dd></div><div><dt>{t('Son oynanma')}</dt><dd>{date(world.lastPlayed)}</dd></div><div><dt>{t('Boyut')}</dt><dd>{size(world.size)}</dd></div><div><dt>{t('Minecraft sürümü')}</dt><dd>{world.version ?? '—'}</dd></div></dl>
        <div className="world-management-actions"><button className="secondary world-join" disabled={locked || !supported} onClick={() => join(world)}><Play size={16} fill="currentColor" />{t('Katıl')}</button>
          <button className="secondary world-action-pair" disabled={locked} onClick={() => { setError(''); setName(world.name); setRenaming(world) }}><Pencil size={16} /><span>{t('Adını değiştir')}</span></button>
          <button className="secondary world-action-pair" disabled={locked} onClick={() => void act(() => window.launcher.duplicateWorld(profileId, world.id, t('{name} (kopya)', { name: world.name })), 'Dünya kopyalandı.')}><Copy size={16} /><span>{t('Kopyala')}</span></button>
          <button className="secondary world-action-pair" disabled={locked || !world.icon} onClick={() => void act(() => window.launcher.resetWorldIcon(profileId, world.id), 'Dünya simgesi sıfırlandı.')}><RotateCcw size={16} /><span>{t('Simgeyi sıfırla')}</span></button>
          <button className="secondary world-action-pair" disabled={pending || world.seed === undefined} title={world.seed === undefined ? t('Dünya tohumu okunamadı.') : undefined} onClick={() => void act(() => window.launcher.copyWorldSeed(profileId, world.id), 'Dünya tohumu kopyalandı.')}><KeyRound size={16} /><span>{t('Seedi kopyala')}</span></button>
          <button className="secondary world-wide" disabled={pending} onClick={() => void window.launcher.openWorldFolder(profileId, world.id).catch(reason => onNotice(t(diagnoseError(reason).message)))}><FolderOpen size={16} />{t('Klasörü göster')}</button>
          <button className="secondary danger world-wide" disabled={locked} onClick={() => { setError(''); setDeleting(world) }}><Trash2 size={16} />{t('Sil')}</button>
        </div>{!supported && <p className="world-launch-note"><Info size={15} />{t('Dünyaya doğrudan katılım Minecraft 1.20 ve sonrasında desteklenir.')}</p>}{running && <p className="world-launch-note"><Info size={15} />{t('Dünya açıkken bu işlem yapılamaz.')}</p>}
      </> : <div className="server-details-placeholder"><Info size={20} /><p>{t('Ayrıntıları görmek için listeden bir dünya seç.')}</p></div>}</aside>
    </div>}
    {renaming && profileId && <AccountDialog className="server-edit-dialog" title={t('Adını değiştir')} description={t('Dünyanın oyun içinde görünen adını değiştir.')} closeLabel={t('Kapat')} icon={null} locked={pending} onClose={() => setRenaming(null)}><form onSubmit={event => { event.preventDefault(); void act(() => window.launcher.renameWorld(profileId, renaming.id, name), 'Dünya adı değiştirildi.', true) }}><div className="server-form"><label>{t('Dünya adı')}<input autoFocus maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={pending} required /></label></div>{error && <p className="server-form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" type="button" disabled={pending} onClick={() => setRenaming(null)}>{t('Vazgeç')}</button><button className="modal-primary" type="submit" disabled={pending || !name.trim()}>{t('Kaydet')}</button></div></form></AccountDialog>}
    {deleting && profileId && <AccountDialog className="server-edit-dialog" title={t('Dünyayı sil')} description={t('Bu dünya geri dönüşüm kutusuna taşınacak.')} closeLabel={t('Kapat')} icon={null} locked={pending} onClose={() => setDeleting(null)}><div className="server-delete-summary"><span className="server-icon"><img src={deleting.icon ?? defaultIcon} alt="" /></span><div><strong>{deleting.name}</strong><span>{deleting.id}</span></div></div>{error && <p className="server-form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="secondary" disabled={pending} onClick={() => setDeleting(null)}>{t('Vazgeç')}</button><button className="secondary danger" disabled={pending} onClick={() => void act(() => window.launcher.deleteWorld(profileId, deleting.id), 'Dünya geri dönüşüm kutusuna taşındı.', true)}>{pending && <LoaderCircle size={16} className="spin" />}{t('Sil')}</button></div></AccountDialog>}
  </div>
}
