import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Globe2, Info, LoaderCircle, Pencil, Play, Plus, RefreshCw, Search, Server, Signal, Trash2, UsersRound } from 'lucide-react'
import type { GameVersion, LauncherState, LaunchRequest, SavedServer, ServerStatus, ResourcePackPolicy } from '../../shared/types'
import { diagnoseError } from '../../shared/errors'
import { serverLaunchMode } from '../../shared/server-launch'
import { profileLaunchVersion } from '../../shared/profile-version'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import defaultServerIcon from '../assets/minecraft-server-default.png'
import './servers.css'

type Props = {
  state: LauncherState; versions: GameVersion[]; language: Language; launchBusy: boolean; isVisible: boolean
  scopedProfileId?: string
  onBusyChange?: (busy: boolean) => void
  onCreateProfile: () => void
  onNotice: (message: string) => void; onJoin: (request: LaunchRequest) => void
  choicePicker: (value: string, options: { value: string; label: string }[], onChange: (value: string) => void, label: string, className: string) => ReactNode
  profilePicker: (value: string, onChange: (id: string) => void) => ReactNode
  listProfilePicker: (value: string, onChange: (id: string) => void, disabled: boolean) => ReactNode
  versionPicker: (value: string, onChange: (id: string) => void) => ReactNode
}
export function ServersPage({ state, versions, language, launchBusy, isVisible, scopedProfileId, onBusyChange, onCreateProfile, onNotice, onJoin, profilePicker, listProfilePicker, versionPicker, choicePicker }: Props) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [servers, setServers] = useState<SavedServer[]>([])
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [listProfile, setListProfile] = useState(state.selectedProfileId ?? state.profiles[0]?.id ?? '')
  const listProfileId = scopedProfileId !== undefined ? state.profiles.find(item => item.id === scopedProfileId)?.id ?? null : state.profiles.find(item => item.id === listProfile)?.id ?? state.profiles.find(item => item.id === state.selectedProfileId)?.id ?? state.profiles[0]?.id ?? null
  const listScope = `${state.selectedAccountId ?? ''}:${listProfileId ?? ''}`
  const scope = useRef(listScope); scope.current = listScope
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [reordering, setReordering] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [draft, setDraft] = useState<{ id?: string; name: string; address: string; resourcePacks?: ResourcePackPolicy } | null>(null)
  const [deleting, setDeleting] = useState<SavedServer | null>(null)
  const [joining, setJoining] = useState<SavedServer | null>(null)
  const [joinProfile, setJoinProfile] = useState('')
  const [joinVersion, setJoinVersion] = useState('')
  const [offlineName, setOfflineName] = useState('')
  const [temporaryJoin, setTemporaryJoin] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => { onBusyChange?.(pending || reordering); return () => onBusyChange?.(false) }, [pending, reordering, onBusyChange])
  const [error, setError] = useState('')
  const active = useRef(true), requests = useRef(new Map<string, string>())
  const refresh = async (items: SavedServer[], notify: false | 'list' | 'server' = false) => {
    const tasks = items.filter(server => requests.current.get(server.id) !== server.address)
    if (!tasks.length) return
    for (const server of tasks) requests.current.set(server.id, server.address)
    setRefreshing(new Set(requests.current.keys()))
    await Promise.all(tasks.map(async server => {
      try {
        const status = await window.launcher.refreshServer(server.id, listProfileId)
        if (active.current && scope.current === listScope) {
          setStatuses(current => ({ ...current, [server.id]: status }))
          setServers(current => current.map(item => item.id === server.id && item.address === status.address ? { ...item, icon: status.icon } : item))
        }
      } catch (reason) { if (active.current && scope.current === listScope) onNotice(diagnoseError(reason).message) }
      finally { if (scope.current === listScope) { if (requests.current.get(server.id) === server.address) requests.current.delete(server.id); if (active.current) setRefreshing(new Set(requests.current.keys())) } }
    }))
    if (notify && active.current && scope.current === listScope) onNotice(t(notify === 'server' ? 'Sunucu bilgileri güncellendi.' : 'Sunucu listesi güncellendi.'))
  }
  useEffect(() => {
    active.current = isVisible
    if (!isVisible) return
    let cancelled = false, fetching = false, previous: SavedServer[] = [], lastError = ''
    setLoading(true); setServers([]); setStatuses({}); setRefreshing(new Set()); requests.current.clear()
    setDraft(null); setDeleting(null); setJoining(null); setDragOrder(null)
    if (!listProfileId) { setLoading(false); setSelected(null); return }
    const sync = async () => {
      if (fetching) return
      fetching = true
      try {
        const items = await window.launcher.getServers(listProfileId)
        if (cancelled || scope.current !== listScope) return
        if (JSON.stringify(items) !== JSON.stringify(previous)) {
          const changed = items.filter(item => !previous.some(old => old.id === item.id && old.address === item.address))
          previous = items
          setServers(items); setSelected(current => items.some(item => item.id === current) ? current : items[0]?.id ?? null)
          setJoining(current => current && items.find(item => item.id === current.id && item.address === current.address) || null)
          if (changed.length) void refresh(changed)
        }
        lastError = ''
      } catch (reason) {
        if (!cancelled && scope.current === listScope) { const message = diagnoseError(reason).message; if (message !== lastError) onNotice(message); lastError = message }
      } finally { fetching = false; if (!cancelled && scope.current === listScope) setLoading(false) }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), 2000)
    const focus = () => void sync()
    window.addEventListener('focus', focus)
    return () => { cancelled = true; active.current = false; window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [listScope, isVisible])
  const selectedServer = servers.find(server => server.id === selected)
  const statusFor = (server: SavedServer) => statuses[server.id]?.address === server.address ? statuses[server.id] : undefined
  const selectedStatus = selectedServer && statusFor(selectedServer)
  const resourceOptions = [{ value: 'enabled', label: t('Her zaman indir') }, { value: 'prompt', label: t('Her zaman sor') }, { value: 'disabled', label: t('Asla indirme') }]
  const filtered = servers.filter(server => `${server.name} ${server.address}`.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)))
  const visible = dragOrder ? dragOrder.map(id => servers.find(server => server.id === id)!).filter(Boolean) : filtered
  const reorder = async ({ active: dragged, over }: DragEndEvent) => {
    const ids = dragOrder ?? visible.map(server => server.id)
    setDragOrder(null)
    if (!over || dragged.id === over.id || reordering) return
    const from = ids.indexOf(String(dragged.id)), to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    const ordered = arrayMove(ids, from, to), shown = new Set(ids)
    let index = 0
    const previous = servers, next = servers.map(server => {
      if (!shown.has(server.id)) return server
      const id = ordered[index++]
      return servers.find(item => item.id === id)!
    })
    setServers(next); setReordering(true)
    try { setServers(await window.launcher.reorderServers(next.map(server => server.id), listProfileId)) }
    catch (reason) { setServers(previous); onNotice(diagnoseError(reason).message) }
    finally { setReordering(false) }
  }
  const standaloneJoin = temporaryJoin || !state.profiles.length
  const profile = standaloneJoin ? undefined : state.profiles.find(item => item.id === joinProfile)
  const joinSupported = serverLaunchMode(profile ? profileLaunchVersion(profile) : joinVersion) !== null
  const startJoin = (server: SavedServer) => {
    if (loading || refreshing.has(server.id) || !statusFor(server)?.online || launchBusy || reordering) return
    setError(''); setTemporaryJoin(false); setJoinProfile(listProfileId ?? '')
    const version = statusFor(server)?.version?.match(/(?:^|[^\d])(\d+\.\d+(?:\.\d+)?)(?:[^\d]|$)/)?.[1]
    const matching = versions.find(item => item.id === version)
    setJoinVersion(matching?.id ?? versions.find(item => item.installed && serverLaunchMode(item.id))?.id ?? versions.find(item => item.type === 'release' && !item.custom && serverLaunchMode(item.id))?.id ?? '')
    setOfflineName(''); setJoining(server)
  }
  const save = async () => {
    if (!draft || pending) return
    setPending(true); setError('')
    try {
      const items = await window.launcher.saveServer(draft, listProfileId)
      const saved = draft.id ? items.find(item => item.id === draft.id) : items.find(item => !servers.some(old => old.id === item.id))
      setServers(items); setSelected(saved?.id ?? selected); setDraft(null)
      if (saved) void refresh([saved])
      onNotice(t('Sunucu kaydedildi.'))
    } catch (reason) { setError(diagnoseError(reason).message) }
    finally { setPending(false) }
  }
  const remove = async () => {
    if (!deleting || pending) return
    setPending(true); setError('')
    try {
      const items = await window.launcher.deleteServer(deleting.id, listProfileId)
      setServers(items); if (selected === deleting.id) setSelected(items[0]?.id ?? null)
      setDeleting(null); onNotice(t('Sunucu listeden kaldırıldı.'))
    } catch (reason) { setError(diagnoseError(reason).message) }
    finally { setPending(false) }
  }
  const join = async () => {
    if (!joining || pending || !joinSupported) return
    setPending(true); setError('')
    try {
      if (standaloneJoin && !/^[A-Za-z0-9_]{3,16}$/.test(offlineName.trim())) return
      const latest = await window.launcher.refreshServer(joining.id, listProfileId)
      setStatuses(current => ({ ...current, [joining.id]: latest }))
      if (!latest.online) { setError(t('Sunucu çevrimdışı. Katılmak için yeniden çevrimiçi olmasını bekle.')); return }
      if (!standaloneJoin && !state.selectedAccountId) throw new Error(t('Oynamak için bir hesap seç veya çevrimdışı hesap oluştur.'))
      const request: LaunchRequest = { profileId: profile?.id ?? null, ...(profile ? {} : { versionId: joinVersion }), accountId: state.selectedAccountId ?? '', ...(standaloneJoin ? { temporaryOfflineName: offlineName.trim() } : {}), serverAddress: joining.address, serverPreference: { name: joining.name, resourcePacks: joining.resourcePacks ?? 'prompt' } }
      setJoining(null); onJoin(request)
    } catch (reason) { setError(diagnoseError(reason).message) }
    finally { setPending(false) }
  }
  return <div className="content-page servers-page">
    <div className="page-heading"><div><h2>{t('Sunucular')}</h2><p>{t('Favori sunucularını bir arada tut ve maceraya katıl.')}</p></div><div className="servers-heading-actions"><button className="heading-action" disabled={loading || refreshing.size > 0 || !servers.length} onClick={() => void refresh(servers, 'list')}><RefreshCw size={17} className={refreshing.size ? 'spin' : ''} />{t('Listeyi yenile')}</button><button className="heading-action primary" disabled={!listProfileId} onClick={() => { setError(''); setDraft({ name: '', address: '', resourcePacks: 'prompt' }) }}><Plus size={17} />{t('Sunucu ekle')}</button></div></div>
    {!listProfileId ? <div className="servers-list-panel servers-empty" style={{minHeight:340}}><Server size={36} /><h3>{t('Önce bir profil oluştur')}</h3><p>{t('Sunucu ekleyebilmek için önce bir profil oluştur.')}</p><button className="secondary" onClick={onCreateProfile}><Plus size={16} />{t('Yeni profil')}</button></div> : <div className="servers-workspace">
      <section className="servers-list-panel"><div className="servers-toolbar"><div className="search-box"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Sunucu ara') + '...'} /></div>{scopedProfileId === undefined && listProfilePicker(listProfileId ?? '', setListProfile, loading || pending || reordering)}</div>
        <div className="servers-table-head" role="row"><span>{t('Sunucu adı ve ikonu')}</span><span>{t('Oyuncular')}</span><span>{t('Sunucu adresi')}</span></div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragOrder(visible.map(server => server.id))} onDragCancel={() => setDragOrder(null)} onDragEnd={event => void reorder(event)}>
        <SortableContext items={visible.map(server => server.id)} strategy={verticalListSortingStrategy}>
        <div className="servers-list">{loading ? <div className="servers-empty"><LoaderCircle className="spin" size={25} />{t('Sunucular yükleniyor...')}</div> : !servers.length ? <div className="servers-empty"><Server size={34} /><h3>{t('İlk sunucunu ekle')}</h3><p>{t('Bir isim ve sunucu adresiyle listeni oluşturmaya başla.')}</p><button className="secondary" onClick={() => { setError(''); setDraft({ name: '', address: '', resourcePacks: 'prompt' }) }}><Plus size={16} />{t('Sunucu ekle')}</button></div> : !visible.length ? <div className="servers-empty"><Search size={25} />{t('Bu aramada sunucu bulunamadı.')}</div> : visible.map(server => {
          const status = statusFor(server), scanning = refreshing.has(server.id)
          return <SortableServerRow key={server.id} server={server} status={status} selected={selected === server.id} disabled={reordering} onSelect={() => setSelected(server.id)} onJoin={() => startJoin(server)} connectionLabel={scanning ? t('Sunucu sorgulanıyor...') : t(status?.online ? 'Çevrimiçi' : 'Çevrimdışı')} />
        })}</div></SortableContext></DndContext>
      </section>
      <aside className="server-details"><div className="server-details-heading"><h3>{t('Sunucu bilgileri')}</h3><p>{t('Bağlantı ve oyuncu bilgilerini buradan incele.')}</p></div>{selectedServer ? <>
        <div className="server-details-identity"><span className="server-icon"><img src={selectedServer.icon ?? defaultServerIcon} alt="" draggable={false} /></span><div><h3 title={selectedServer.name}>{selectedServer.name}</h3><span className={`server-connection ${refreshing.has(selectedServer.id) ? '' : selectedStatus?.online ? 'online' : 'offline'}`}>{refreshing.has(selectedServer.id) ? t('Sorgulanıyor') : t(selectedStatus?.online ? 'Çevrimiçi' : 'Çevrimdışı')}</span></div><button className="server-refresh server-details-refresh" disabled={refreshing.has(selectedServer.id) || reordering} title={t('Sunucuyu yenile')} aria-label={t('Sunucuyu yenile')} onClick={() => void refresh([selectedServer], 'server')}><RefreshCw size={17} className={refreshing.has(selectedServer.id) ? 'spin' : ''} /></button></div>
        <dl className="server-facts"><div className="server-address-detail"><dt><Globe2 size={15} />{t('Sunucu adresi')}</dt><dd>{selectedServer.address}</dd></div><div className="server-player-count"><dt><UsersRound size={15} />{t('Oyuncular')}</dt><dd>{serverPlayerCount(selectedStatus)}</dd></div><div><dt><Server size={15} />{t('Minecraft sürümü')}</dt><dd>{selectedStatus?.version ?? '—'}</dd></div><div className={`server-latency ${selectedStatus?.online ? 'online' : selectedStatus ? 'offline' : ''}`}><dt><Signal size={15} />{t('Gecikme')}</dt><dd>{selectedStatus?.online && validServerNumber(selectedStatus.latency) ? `${selectedStatus.latency} ms` : '—'}</dd></div></dl>
        {!!selectedStatus?.sample?.length && <div className="server-player-sample"><h4>{t('Çevrimiçi oyuncular')}</h4><p>{selectedStatus.sample.join(', ')}</p></div>}
        <div className="server-details-actions server-management-actions"><button className="server-join secondary" disabled={launchBusy || reordering || refreshing.has(selectedServer.id) || !selectedStatus?.online} onClick={() => startJoin(selectedServer)}><Play size={16} fill="currentColor" />{t('Katıl')}</button><button className="secondary" disabled={reordering} onClick={() => { setError(''); setDraft({ ...selectedServer }) }}><Pencil size={16} />{t('Sunucuyu düzenle')}</button><button className="secondary danger" disabled={reordering} onClick={() => { setError(''); setDeleting(selectedServer) }}><Trash2 size={16} />{t('Listeden kaldır')}</button></div>
      </> : <div className="server-details-placeholder"><Info size={20} /><p>{t('Ayrıntıları görmek için listeden bir sunucu seç.')}</p></div>}</aside>
    </div>}
    {draft && <AccountDialog className="server-edit-dialog" title={t(draft.id ? 'Sunucuyu düzenle' : 'Sunucu ekle')} description={t('Sunucuna bir isim ver ve bağlanmak için adresini gir.')} closeLabel={t('Kapat')} icon={null} locked={pending} onClose={() => setDraft(null)}><form onSubmit={event => { event.preventDefault(); void save() }}><div className="server-form"><label>{t('Sunucu adı')}<input maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder={t('Sunucum')} disabled={pending} required /></label><label>{t('Sunucu adresi')}<input maxLength={260} value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} placeholder="play.example.com:25565" disabled={pending} required /><small>{t('Gerekirse adresin sonuna :port ekleyebilirsin.')}</small></label><label>{t('Kaynak paketleri')}{choicePicker(draft.resourcePacks ?? 'prompt', resourceOptions, value => setDraft({ ...draft, resourcePacks: value as ResourcePackPolicy }), t('Kaynak paketleri'), 'server-resource-select')}<small>{t('Doğrudan katılımda Minecraft 1.20 ve sonrası bu tercihi kullanır.')}</small></label></div>{error && <p className="server-form-error" role="alert">{t(error)}</p>}<div className="modal-actions"><button className="secondary" type="button" disabled={pending} onClick={() => setDraft(null)}>{t('Vazgeç')}</button><button className="modal-primary" type="submit" disabled={pending || !draft.name.trim() || !draft.address.trim()}>{pending && <LoaderCircle size={16} className="spin" />}{t('Kaydet')}</button></div></form></AccountDialog>}
    {deleting && <AccountDialog className="server-delete-dialog" title={t('Sunucu listeden kaldırılsın mı?')} description={t('{name} sunucusunu listenden kaldıracaksın. Tekrar katılmak istersen adresini yeniden eklemen gerekir.', { name: deleting.name })} closeLabel={t('Kapat')} icon={null} locked={pending} onClose={() => setDeleting(null)}><div className="server-delete-summary"><Server size={24} /><div><strong>{deleting.name}</strong><span>{deleting.address}</span></div></div>{error && <p className="server-form-error" role="alert">{t(error)}</p>}<div className="modal-actions"><button className="secondary" disabled={pending} onClick={() => setDeleting(null)}>{t('Vazgeç')}</button><button className="secondary danger" disabled={pending} onClick={() => void remove()}><Trash2 size={16} />{t('Listeden kaldır')}</button></div></AccountDialog>}
    {joining && <AccountDialog className="server-join-dialog" title={standaloneJoin ? t('Çevrimdışı hesapla katılmak ister misin?') : t('Sunucuya katıl')} description={!standaloneJoin ? scopedProfileId !== undefined ? t('{name} sunucusuna açık profille katıl.', { name: joining.name }) : t('{name} sunucusuna katılmak için bir profil seç.', { name: joining.name }) : t('Bir oyuncu adı ve Minecraft sürümü seç. Oyun profil oluşturmadan açılır.')} closeLabel={t('Kapat')} icon={null} locked={pending} onClose={() => setJoining(null)}><form onSubmit={event => { event.preventDefault(); void join() }}><div className="server-join-summary"><span className="server-icon"><img src={joining.icon ?? defaultServerIcon} alt="" draggable={false} /></span><div><strong>{joining.name}</strong><span>{joining.address}</span></div></div><div className="server-form">{!standaloneJoin ? <div className="server-form-field"><span className="server-field-label">{t('Profil')}</span>{scopedProfileId === undefined ? profilePicker(joinProfile, setJoinProfile) : <strong className="server-scoped-profile">{state.profiles.find(item => item.id === scopedProfileId)?.name}</strong>}<button className="server-temporary-join" type="button" disabled={pending} onClick={() => { setError(''); setTemporaryJoin(true); setOfflineName('') }}>{t('Geçici çevrimdışı hesapla katıl')}</button></div> : <>
      <label>{t('Oyuncu adı')}<input value={offlineName} onChange={event => setOfflineName(event.target.value)} maxLength={16} placeholder="PlayerName" disabled={pending} required pattern="[A-Za-z0-9_]{3,16}" /><small>{t('3–16 karakter; harf, rakam ve alt çizgi kullanabilirsin.')}</small></label>
      <div className="server-form-field"><span className="server-field-label">{t('Minecraft sürümü')}</span>{versionPicker(joinVersion, setJoinVersion)}<small>{t('Sunucunun desteklediği Minecraft sürümünü seç.')}</small></div><p className="server-account-note"><Info size={17} /><span>{t('Çevrimdışı hesaplar yalnızca bu hesaplara izin veren sunuculara katılabilir.')}</span></p>
      </>}</div>{!joinSupported && <p className="server-form-error">{t('Bu Minecraft sürümü doğrudan sunucuya katılmayı desteklemiyor.')}</p>}{error && <p className="server-form-error" role="alert">{t(error)}</p>}<div className="modal-actions"><button className="secondary" type="button" disabled={pending} onClick={() => setJoining(null)}>{t('Vazgeç')}</button><button className="modal-primary" type="submit" disabled={pending || launchBusy || !joinSupported || !statusFor(joining)?.online || (standaloneJoin && !/^[A-Za-z0-9_]{3,16}$/.test(offlineName.trim()))}>{pending && <LoaderCircle size={16} className="spin" />}{t('Katıl')}</button></div></form></AccountDialog>}
  </div>
}

function SortableServerRow({ server, status, selected, disabled, onSelect, onJoin, connectionLabel }: { server: SavedServer; status?: ServerStatus; selected: boolean; disabled: boolean; onSelect: () => void; onJoin: () => void; connectionLabel: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: server.id, disabled })
  return <div ref={setNodeRef} className={`server-row ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined }}>
    <button {...attributes} {...listeners} className="server-select" onClick={onSelect} onDoubleClick={onJoin} aria-pressed={selected} aria-label={server.name}>
      <span className="server-cell server-identity"><span className="server-icon"><img src={server.icon ?? defaultServerIcon} alt="" draggable={false} /></span><strong title={server.name}>{server.name}</strong></span>
      <span className={`server-cell server-online ${status?.online ? 'online' : ''}`} title={status?.online ? `${connectionLabel} · ${serverPlayerCount(status)}` : connectionLabel}><small>{serverPlayerCount(status)}</small></span>
      <span className="server-cell server-address" title={server.address}>{server.address}</span>
    </button>
  </div>
}

function validServerNumber(value: number | undefined): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function serverPlayerCount(status?: ServerStatus): string {
  return status?.online && validServerNumber(status.players) && validServerNumber(status.maxPlayers) ? `${status.players} / ${status.maxPlayers}` : '—'
}
