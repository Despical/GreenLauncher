import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMenuScrollbar } from './DropdownOptions'
import { Check, ChevronDown, ChevronRight, Info, LoaderCircle, Plus, ShieldCheck, Trash2, UserRound, UsersRound, WifiOff, X } from 'lucide-react'
import type { GameAccount, LauncherState } from '../../shared/types'
import { diagnoseError } from '../../shared/errors'
import { skinHead } from './skin-head'

type Translate = (source: string, values?: Record<string, string | number>) => string
type Actions = { state: LauncherState; t: Translate; onState: (state: LauncherState) => void; onNotice: (message: string) => void }
const heads = new Map<string, { request: Promise<string | null>; expires: number }>()

function cachedHead(key: string, request: Promise<string | null>): Promise<string | null> {
  heads.delete(key)
  heads.set(key, { request, expires: Date.now() + 60_000 })
  while (heads.size > 128) heads.delete(heads.keys().next().value!)
  return request
}

export function AccountAvatar({ account, className = '' }: { account?: GameAccount; className?: string }) {
  const [head, setHead] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    let revision = 0
    setHead(null)
    const unsubscribe = window.launcher.on('skinUpdated', update => {
      if (!account || update.accountId !== account.id) return
      const key = `${account.id}:${account.name}:${account.skinUrl ?? ''}`
      const latest = ++revision
      const request = cachedHead(key, update.skin ? skinHead(update.skin).catch(() => null) : Promise.resolve(null))
      void request.then(value => { if (current && latest === revision) setHead(value) })
    })
    if (account) {
      const key = `${account.id}:${account.name}:${account.skinUrl ?? ''}`
      const cached = heads.get(key)
      let request = cached && cached.expires > Date.now() ? cached.request : undefined
      if (!request) {
        request = window.launcher.getAccountSkin(account.id).then(skin => skin ? skinHead(skin) : null).catch(() => null)
        cachedHead(key, request)
      }
      void request.then(value => { if (current && revision === 0) setHead(value) })
    }
    return () => { current = false; unsubscribe() }
  }, [account?.id, account?.name, account?.skinUrl])
  return <span className={`player-avatar ${className}`} aria-hidden="true">{head ? <img src={head} alt="" draggable={false} /> : <UserRound size={20} />}</span>
}

function MicrosoftMark({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true"><path fill="#f25022" d="M0 0h8v8H0z" /><path fill="#7fba00" d="M10 0h8v8h-8z" /><path fill="#00a4ef" d="M0 10h8v8H0z" /><path fill="#ffb900" d="M10 10h8v8h-8z" /></svg>
}

export function DialogHeading({ title, description, closeLabel, onClose, locked = false, icon, titleId, descriptionId }: { title: ReactNode; description: ReactNode; closeLabel: string; onClose: () => void; locked?: boolean; icon?: ReactNode; titleId?: string; descriptionId?: string }) {
  return <div className="dialog-heading">{icon && <span className="account-dialog-symbol">{icon}</span>}<div className="dialog-heading-copy"><h2 id={titleId}>{title}</h2><p id={descriptionId}>{description}</p></div><button type="button" className="modal-close" disabled={locked} aria-label={closeLabel} onClick={onClose}><X size={19} /></button></div>
}

export function AccountDialog({ title, description, closeLabel, children, onClose, locked = false, className = '', icon }: { title: string; description: string; closeLabel: string; children: ReactNode; onClose: () => void; locked?: boolean; className?: string; icon?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>('input') ?? root.current?.querySelector<HTMLElement>('button:not(:disabled)') ?? root.current)?.focus())
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLElement>('.account-tile')?.focus() }
  }, [])
  return <div className="modal-backdrop account-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !locked) close.current() }}>
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" aria-describedby="account-dialog-description" className={`modal account-dialog ${className}`} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!locked) close.current() }
      if (event.key === 'Tab') {
        const items = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <DialogHeading title={title} description={description} closeLabel={closeLabel} onClose={onClose} locked={locked} icon={icon !== null ? icon ?? <UsersRound size={22} /> : undefined} titleId="account-dialog-title" descriptionId="account-dialog-description" />
      {children}
    </div>
  </div>
}

export function AccountSwitcher({ state, t, onState, onNotice, open, setOpen, onManage, onOffline, onProfile, active }: Actions & { open: boolean; setOpen: (open: boolean) => void; onManage: () => void; onOffline: () => void; onProfile: () => void; active: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useMenuScrollbar(list)
  const trigger = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const account = state.accounts.find(item => item.id === state.selectedAccountId)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', outside)
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitem"]')?.focus())
    return () => { document.removeEventListener('mousedown', outside); cancelAnimationFrame(frame) }
  }, [open])
  const choose = async (id: string) => {
    if (pending) return
    setPending(true)
    try { onState(await window.launcher.selectAccount(id)); setOpen(false); trigger.current?.focus() }
    catch (error) { onNotice(t(diagnoseError(error).message)) }
    finally { setPending(false) }
  }
  const action = (callback: () => void) => { setOpen(false); callback() }
  return <div className="sidebar-account" ref={root} onKeyDown={event => {
    if (!open) return
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    if (event.key === 'Tab') setOpen(false)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }
  }}>
    {open && <div className="account-switcher" id="account-switcher-menu" role="menu" aria-label={t('Hesap değiştir')}>
      <div className="account-switcher-heading"><span>{t('Hesap değiştir')}</span><span className="account-count">{state.accounts.length}</span></div>
      <div className="account-switcher-list" ref={list}>{state.accounts.length ? state.accounts.map(item => <button type="button" role="menuitemradio" aria-checked={item.id === state.selectedAccountId} disabled={pending} key={item.id} className={item.id === state.selectedAccountId ? 'selected' : ''} onClick={() => void choose(item.id)}><AccountAvatar account={item} /><span className="account-identity"><strong>{item.name}</strong><small>{item.kind === 'offline' ? <WifiOff size={14} /> : <MicrosoftMark size={14} />}{item.kind === 'offline' ? t('Çevrimdışı hesap') : t('Microsoft hesabı')}</small></span></button>) : <div className="account-switcher-empty">{t('Henüz hesap yok.')}</div>}</div>
      <div className="account-switcher-divider" />
      <button type="button" role="menuitem" className="account-switcher-action" onClick={() => action(onProfile)}><UserRound size={17} /><span>{t('Profilim')}</span><ChevronRight size={15} /></button>
      <button type="button" role="menuitem" className="account-switcher-action" onClick={() => action(onManage)}><UsersRound size={17} /><span>{t('Hesapları yönet')}</span><ChevronRight size={15} /></button>
      <div className="account-switcher-divider" role="separator" /><button type="button" role="menuitem" className="account-switcher-action account-quick-add" onClick={() => action(onOffline)}><Plus size={17} /><span>{t('Çevrimdışı hesap ekle')}</span></button>
    </div>}
    <button ref={trigger} type="button" className={`account-tile ${active || open ? 'active' : ''}`} aria-haspopup="menu" aria-controls={open ? 'account-switcher-menu' : undefined} aria-expanded={open} onClick={() => setOpen(!open)}><AccountAvatar account={account} /><div><strong>{account?.name || t('Hesap seç')}</strong><span>{account ? account.kind === 'offline' ? t('Çevrimdışı hesap') : t('Microsoft hesabı') : t('Hesabını bağla')}</span></div><ChevronDown size={16} className={open ? 'account-chevron-open' : ''} /></button>
  </div>
}

export function AccountManager({ state, t, onState, onNotice, onClose, onOffline }: Actions & { onClose: () => void; onOffline: () => void }) {
  const [pending, setPending] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removal, setRemoval] = useState<{ account: GameAccount; index: number; exiting: boolean } | null>(null)
  const busy = useRef(false)
  // State events arrive before the IPC promise resolves. Retain the removed row
  // until its successful-removal animation completes.
  const accounts = [...state.accounts]
  if (removal && !accounts.some(item => item.id === removal.account.id)) accounts.splice(removal.index, 0, removal.account)
  const run = async (key: string, work: () => Promise<LauncherState>) => {
    if (busy.current) return
    busy.current = true
    setPending(key)
    try { onState(await work()); setRemoving(null) }
    catch (error) { onNotice(t(diagnoseError(error).message)) }
    finally { busy.current = false; setPending(null) }
  }
  const remove = async (account: GameAccount) => {
    if (busy.current) return
    busy.current = true
    setPending(`remove:${account.id}`)
    setRemoval({ account, index: accounts.findIndex(item => item.id === account.id), exiting: false })
    try {
      onState(await window.launcher.signOut(account.id))
      setRemoval(current => current ? { ...current, exiting: true } : null)
      await new Promise(resolve => window.setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280))
      setRemoving(null)
      setRemoval(null)
      onNotice(t('{name} hesabı silindi.', { name: account.name }))
      window.requestAnimationFrame(() => (document.querySelector<HTMLButtonElement>('.account-card-select:not(:disabled)') ?? document.querySelector<HTMLButtonElement>('.dialog-heading button'))?.focus())
    } catch (error) { setRemoval(null); onNotice(t(diagnoseError(error).message)) }
    finally { busy.current = false; setPending(null) }
  }
  return <AccountDialog title={t('Hesapları yönet')} description={t('Hesapların arasında geçiş yap veya yeni bir hesap ekle.')} closeLabel={t('Kapat')} onClose={onClose} locked={!!pending} className="account-manager-dialog">
    <div className="account-section-label"><span>{t('Kayıtlı hesaplar')}</span><span className="account-count">{state.accounts.length}</span></div>
    <div className="managed-account-list">{accounts.length ? accounts.map(item => <div key={item.id} className={`managed-account-presence ${removal?.account.id === item.id && removal.exiting ? 'leaving' : ''}`}><div className="managed-account-clip"><div className={`managed-account ${item.id === state.selectedAccountId ? 'selected' : ''}`}>
      <div className="managed-account-main"><button type="button" className="account-card-select" aria-pressed={item.id === state.selectedAccountId} disabled={!!pending} onClick={() => { if (item.id !== state.selectedAccountId) void run(item.id, () => window.launcher.selectAccount(item.id)) }}><AccountAvatar account={item} /><span className="account-identity"><strong>{item.name}</strong><small>{item.kind === 'offline' ? <WifiOff size={14} /> : <MicrosoftMark size={14} />}{item.kind === 'offline' ? t('Çevrimdışı hesap') : t('Microsoft hesabı')}</small></span>
        {item.id === state.selectedAccountId ? <span className="account-active-label"><Check size={15} />{t('Seçili')}</span> : pending === item.id ? <LoaderCircle size={16} className="spin" /> : null}</button>
        <button type="button" className={`account-icon-button account-remove-button ${removing === item.id ? 'active' : ''}`} disabled={!!pending} aria-label={`${item.name} — ${t('Hesabı kaldır')}`} title={t('Hesabı kaldır')} aria-expanded={removing === item.id} onClick={() => setRemoving(removing === item.id ? null : item.id)}><Trash2 size={16} /></button>
      </div>
      <div className={`account-remove-reveal ${removing === item.id ? 'open' : ''}`} aria-hidden={removing !== item.id} inert={removing !== item.id}><div className="account-remove-clip"><div className="account-remove-confirm"><p>{t('Hesap launcher’dan kaldırılacak. Dünyaların ve profillerin korunur.')}</p><div><button type="button" disabled={!!pending || removing !== item.id} onClick={event => { setRemoving(null); event.currentTarget.closest('.managed-account')?.querySelector<HTMLButtonElement>('.account-remove-button')?.focus() }}>{t('Vazgeç')}</button><button type="button" className="account-confirm-danger" disabled={!!pending || removing !== item.id} onClick={() => void remove(item)}>{pending === `remove:${item.id}` ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}{t('Hesabı kaldır')}</button></div></div></div></div>
    </div></div></div>) : <div className="managed-account-empty"><UserRound size={25} /><strong>{t('Henüz hesap yok.')}</strong><span>{t('Microsoft hesabını bağla veya bir çevrimdışı oyuncu adı seç.')}</span></div>}</div>
    <div className="account-add-section"><div className="account-section-label">{t('Hesap ekle')}</div>
      <button type="button" className="account-provider-button microsoft" disabled={!!pending} onClick={() => void run('microsoft', () => window.launcher.signIn())}><span className="account-provider-icon">{pending === 'microsoft' ? <LoaderCircle className="spin" size={20} /> : <MicrosoftMark />}</span><span><strong>{pending === 'microsoft' ? t('Giriş bekleniyor...') : t('Microsoft ile giriş yap')}</strong><small>{t('Minecraft: Java Edition hesabını bağla')}</small></span><ChevronRight size={17} /></button>
      <button type="button" className="account-provider-button" disabled={!!pending} onClick={onOffline}><span className="account-provider-icon"><WifiOff size={20} /></span><span><strong>{t('Çevrimdışı hesap ekle')}</strong><small>{t('Bir oyuncu adıyla yerel olarak oyna')}</small></span><Plus size={17} /></button>
    </div>
    <p className="account-security-note"><ShieldCheck size={16} /><span>{t('Microsoft giriş penceresi açılır. E-posta ve şifreni orada girersin; Green Launcher şifreni saklamaz.')}</span></p>
  </AccountDialog>
}

export function OfflineAccountDialog({ state, t, onState, onNotice, onClose }: Actions & { onClose: () => void }) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const trimmed = name.trim()
  const duplicate = state.accounts.some(item => item.name.toLowerCase() === trimmed.toLowerCase())
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(trimmed)
  const error = duplicate ? t('Bu oyuncu adıyla bir hesap zaten var.') : trimmed && !valid ? t('3-16 karakter: harf, rakam veya alt çizgi.') : ''
  const submit = async () => {
    if (!valid || duplicate || submitting.current) return
    submitting.current = true
    setPending(true)
    try { onState(await window.launcher.createOfflineAccount(trimmed)); onNotice(t('Çevrimdışı hesap oluşturuldu.')); onClose() }
    catch (error) { onNotice(t(diagnoseError(error).message)) }
    finally { submitting.current = false; setPending(false) }
  }
  return <AccountDialog title={t('Çevrimdışı hesap ekle')} description={t('Bir oyuncu adıyla yerel olarak oyna')} closeLabel={t('Kapat')} onClose={onClose} locked={pending} className="offline-account-dialog">
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <label className="offline-account-name" htmlFor="offline-player-name">{t('Oyuncu adı')}</label>
      <div className={`offline-name-field ${error ? 'invalid' : ''}`}><UserRound size={19} /><input id="offline-player-name" value={name} maxLength={16} disabled={pending} onChange={event => setName(event.target.value)} placeholder="Steve" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby="offline-name-help" /><span>{trimmed.length}/16</span></div>
      <p className={`offline-name-help ${error ? 'invalid' : ''}`} id="offline-name-help" aria-live="polite">{error || t('3-16 karakter: harf, rakam veya alt çizgi.')}</p>
      <div className="offline-skin-note"><Info size={17} /><p>{t('Çevrimdışı hesap ile çevrimiçi sunucu oturumlarına katılamazsın.')}</p></div>
      <div className="account-dialog-footer"><button type="button" className="account-cancel-button" disabled={pending} onClick={onClose}>{t('Vazgeç')}</button><button type="submit" className="account-create-button" disabled={!valid || duplicate || pending}>{pending ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}{t('Hesap oluştur')}</button></div>
    </form>
  </AccountDialog>
}
