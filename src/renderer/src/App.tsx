import { profilePlaytime } from '../../shared/profile-settings'
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Layers3, Check, ChevronDown, ChevronRight, ChevronUp, CloudDownload, ExternalLink, FolderOpen,
  Copy, FileText, Home, LoaderCircle, LogIn, LogOut, Maximize2, MemoryStick, Minus, Monitor, MoreHorizontal, Pause,
  GripVertical, HardDrive, Image as ImageIcon, Info, Languages, Package, Pencil, Pin, Play, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, UserRound,
  Globe2, Sparkles, Server, UsersRound, WifiOff, X
} from 'lucide-react'
import type { CleanupPreview, DownloadSnapshot, DiskUsage, GameVersion, JavaRuntimeInfo, LauncherActivity, LauncherErrorEntry, LauncherProfile, LauncherSettings, LauncherState, OfflineStatus, ScreenshotItem, ScreenshotSort, VersionType, RunningInstance, LaunchRequest, LauncherPresenceContext } from '../../shared/types'
import { screenshotPageSize } from '../../shared/types'
import { UpdateIndicator, UpdatePanel, useLauncherUpdate, updateErrorText } from './LauncherUpdates'
import { PlaytimeStatus, TotalPlaytime } from './Playtime'
import { profileLaunchVersion, profileVersionLabel } from '../../shared/profile-version'
import { memoryGb } from '../../shared/memory'
import { serverLaunchMode } from '../../shared/server-launch'
import { JavaSettings } from './JavaSettings'
import { LauncherMenu } from './LauncherMenu'
import { ProfileIcon } from './ProfileIcon'
import { diagnoseError } from '../../shared/errors'
import { languages, translate, type Language } from './i18n'
import { SkinPreview } from './SkinPreview'
import { DownloadsPage } from './DownloadsPage'
import { DropdownOptions } from './DropdownOptions'
import { ScreenshotThumbnail } from './ScreenshotThumbnail'
import { ErrorLogPanel } from './ErrorLogPanel'
import { AboutPanel } from './AboutPanel'
import { ProfileEmptyState } from './ProfileEmptyState'
import { ProfileMenu, ProfileCoverEditor, ProfileDropHint, type ProfileAction } from './ProfileTools'
import { RunningPlayButton, LaunchConfirmation } from './RunningGames'
import { AccountAvatar, AccountManager, AccountSwitcher, OfflineAccountDialog, DialogHeading } from './AccountControls'
import logo from '../../../build/launcher-mark.png'
import customIcon from '../assets/cracked-stone-bricks.svg'
import releaseIcon from '../assets/minecraft-release.png'
import snapshotIcon from '../assets/minecraft-snapshot.png'
import classicIcon from '../assets/minecraft-classic.png'
import optifineIcon from '../assets/optifine-mark.png'
import javaIcon from '../assets/java-original.svg'
import overworldImage from '../assets/green-landscape.png'
import netherImage from '../assets/nether-landscape.png'
import endImage from '../assets/end-landscape.png'
import packageJson from '../../../package.json'
import './profile-workspace.css'
import { ProfileSettingsPage } from './ProfileSettingsPage'
import { installedContentCache, installedContentScope } from './installed-content-cache'

const ProfileVersionPage = lazy(() => import('./ProfileVersionPage').then(module => ({ default: module.ProfileVersionPage })))
const WorldsPage = lazy(() => import('./WorldsPage').then(module => ({ default: module.WorldsPage })))
const ServersPage = lazy(() => import('./ServersPage').then(module => ({ default: module.ServersPage })))
const ModsPage = lazy(() => import('./ModsPage').then(module => ({ default: module.ModsPage })))
const ResourcePacksPage = lazy(() => import('./ResourcePacksPage').then(module => ({ default: module.ResourcePacksPage })))
const MinecraftLogPage = lazy(() => import('./MinecraftLogPage').then(module => ({ default: module.MinecraftLogPage })))
const Changelog = lazy(() => import('./Changelog').then(module => ({ default: module.Changelog })))

type Page = 'home' | 'versions' | 'profiles' | 'servers' | 'worlds' | 'mods' | 'gallery' | 'downloads' | 'storage' | 'settings' | 'account' | 'profile-settings' | 'minecraft-log' | 'resource-packs' | 'shader-packs' | 'profile-version'
const profileWorkspacePages: Page[] = ['servers', 'worlds', 'mods', 'gallery', 'profile-settings', 'minecraft-log', 'resource-packs', 'shader-packs', 'profile-version']
type Filter = VersionType | 'all'
type Scope = 'all' | 'installed' | 'optifine' | 'custom'
type ProfileDraft = Omit<LauncherProfile, 'id' | 'createdAt' | 'lastPlayed'> & { id?: string }
type Option = { value: string; label: string; detail?: string; recent?: string; type?: VersionType; optifine?: boolean; custom?: boolean; icon?: ReactNode; detailIcon?: ReactNode }
type SettingsTab = 'launcher' | 'java' | 'storage' | 'logs' | 'about'
const date = (value: string, language: Language = 'tr') => new Intl.DateTimeFormat({ tr: 'tr-TR', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', ru: 'ru-RU', pl: 'pl-PL' }[language], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
const friendlyError = (error: unknown) => diagnoseError(error).message
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`
const relativeDate = (value: string, language: Language) => {
  const minutes = Math.round((Date.parse(value) - Date.now()) / 60000)
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  return Math.abs(hours) < 24 ? formatter.format(hours, 'hour') : formatter.format(Math.round(hours / 24), 'day')
}
const releaseNotesUrl = (version: GameVersion) => version.type === 'release'
  ? `https://www.minecraft.net/en-us/article/minecraft-java-edition-${version.id.replaceAll('.', '-')}`
  : 'https://www.minecraft.net/en-us/articles'
const heroSlides = [
  { label: '01 / THE OVERWORLD', short: 'Overworld', image: overworldImage, titleA: 'Yeni bir dünya', titleB: 'seni bekliyor.', description: 'Macerana kaldığın yerden devam et. Profilini seç ve oynamaya başla.' },
  { label: '02 / THE NETHER', short: 'Nether', image: netherImage, titleA: 'Ateşin ötesine', titleB: 'yolculuk et.', description: 'Bilinmeyene açılan kapı burada. Hazırsan macerana devam et.' },
  { label: '03 / THE END', short: 'End', image: endImage, titleA: 'Sonun ötesinde', titleB: 'yeni bir başlangıç.', description: 'Her keşif başka bir hikâye. Kendi yolunu seç ve dünyana dön.' }
]

function VersionGlyph({ type = 'release', custom = false }: { type?: VersionType; custom?: boolean }) {
  return <img src={custom ? customIcon : type === 'release' ? releaseIcon : type === 'snapshot' ? snapshotIcon : classicIcon} alt="" draggable={false} />
}

function OptifineGlyph() { return <img className="optifine-glyph" src={optifineIcon} alt="" draggable={false} /> }

function FlagIcon({ code }: { code: Language }) {
  return <svg className="language-flag" viewBox="0 0 32 22" aria-hidden="true">
    {code === 'en' && <><rect width="32" height="22" fill="#173b78" /><path d="M0 0 32 22M32 0 0 22" stroke="#fff" strokeWidth="5" /><path d="M0 0 32 22M32 0 0 22" stroke="#d32439" strokeWidth="2" /><path d="M16 0v22M0 11h32" stroke="#fff" strokeWidth="7" /><path d="M16 0v22M0 11h32" stroke="#d32439" strokeWidth="3.5" /></>}
    {code === 'tr' && <><rect width="32" height="22" fill="#e30a17" /><circle cx="13" cy="11" r="6" fill="#fff" /><circle cx="15.2" cy="11" r="4.8" fill="#e30a17" /><path d="m21 7.3 1 2.5 2.6.1-2 1.7.7 2.5-2.3-1.4-2.1 1.5.6-2.6-2-1.6 2.6-.2z" fill="#fff" /></>}
    {code === 'de' && <><rect width="32" height="22" fill="#ffce00" /><rect width="32" height="14.67" fill="#dd0000" /><rect width="32" height="7.33" fill="#111" /></>}
    {code === 'fr' && <><rect width="32" height="22" fill="#ed2939" /><rect width="21.33" height="22" fill="#fff" /><rect width="10.67" height="22" fill="#002395" /></>}
    {code === 'ru' && <><rect width="32" height="22" fill="#d52b1e" /><rect width="32" height="14.67" fill="#0039a6" /><rect width="32" height="7.33" fill="#fff" /></>}
    {code === 'pl' && <><rect width="32" height="22" fill="#dc143c" /><rect width="32" height="11" fill="#fff" /></>}
  </svg>
}

function LanguageMenu({ value, onChange, language }: { value: Language; onChange: (value: Language) => void; language: Language }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  const selected = languages.find(item => item.code === value)!
  return <div className="language-select" ref={root}>
    <button className="language-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><FlagIcon code={value} /><span>{selected.nativeName}</span><ChevronDown size={17} /></button>
    {open && <div className="language-menu" role="listbox" aria-label={translate(language, 'Arayüz dili')}>{languages.map(item => <button key={item.code} role="option" aria-selected={item.code === value} className={item.code === value ? 'selected' : ''} onClick={() => { onChange(item.code); setOpen(false) }}><FlagIcon code={item.code} /><span lang={item.code}>{item.nativeName}</span></button>)}</div>}
  </div>
}

function Dropdown({ value, options, onChange, placeholder, searchable = false, className = '', language, disabled = false, title, searchPlaceholder, showAll = false, leadingIcon }: { value: string; options: Option[]; onChange: (value: string) => void; placeholder: string; searchable?: boolean; className?: string; language: Language; disabled?: boolean; title?: string; searchPlaceholder?: string; showAll?: boolean; leadingIcon?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const profilePicker = ['home-profile-select', 'gallery-profile-select', 'servers-profile-select', 'servers-list-profile-select', 'workspace-profile-select'].includes(className)
  const portalled = className === 'profile-version-select' || className === 'server-resource-select' || className === 'profile-setting-select' || profilePicker
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useEffect(() => {
    if (!open || searchable) return
    const frame = requestAnimationFrame(() => (menu.current?.querySelector<HTMLButtonElement>('[role=option][aria-selected=true]') ?? menu.current?.querySelector<HTMLButtonElement>('[role=option]'))?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, searchable, position])
  useLayoutEffect(() => {
    if (!open || !portalled || !root.current) return
    const rect = root.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 18
    const above = rect.top - 18
    const upwards = below < 230 && above > below
    const height = Math.min(340, upwards ? above : below)
    setPosition({ position: 'fixed', left: rect.left, width: rect.width, ...(upwards ? { top: 'auto', bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8, bottom: 'auto' }), maxHeight: height, zIndex: 1000 })
    const close = (event: Event) => { if (event.type === 'resize' || event.target === document || event.target === window || (event.target instanceof Element && event.target.contains(root.current))) setOpen(false) }
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('resize', close); document.removeEventListener('scroll', close, true) }
  }, [open, portalled])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const selected = options.find(item => item.value === value)
  const accountPicker = options.some(item => item.icon && item.detailIcon)
  const matching = options.filter(item => `${item.label} ${profilePicker ? '' : item.detail ?? ''}`.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')))
  const shown = showAll ? matching : matching.slice(0, 100)
  const choices = <div ref={menu} style={portalled ? position ?? undefined : undefined} className={`dropdown-menu ${portalled ? 'profile-version-menu' : ''} ${className === 'server-resource-select' ? 'server-resource-menu' : ''} ${profilePicker ? 'profile-picker-menu' : ''} ${accountPicker ? 'profile-account-menu' : ''}`} role="listbox" aria-label={placeholder} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setOpen(false); root.current?.querySelector('button')?.focus(); return } const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]')); if (['ArrowDown', 'ArrowUp'].includes(event.key) || event.target instanceof HTMLButtonElement && ['Home', 'End'].includes(event.key)) { event.preventDefault(); const index = options.indexOf(document.activeElement as HTMLButtonElement); options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index < 0 ? event.key === 'ArrowDown' ? 0 : options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus() } }}>
      {searchable && <><div className="dropdown-search"><Search size={15} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={searchPlaceholder ?? translate(language, 'Sürüm ara')} aria-label={searchPlaceholder ?? translate(language, 'Sürüm ara')} /></div><div className="dropdown-search-divider" role="separator" /></>}
      <DropdownOptions>{shown.length ? shown.map(item => <button type="button" role="option" aria-selected={item.value === value} key={item.value} onClick={() => { onChange(item.value); setOpen(false); root.current?.querySelector('button')?.focus() }}>
        {item.icon}{item.type && <span className={`version-glyph ${item.type}`}>{item.optifine ? <OptifineGlyph /> : <VersionGlyph type={item.type} custom={item.custom} />}</span>}<span className="dropdown-option-copy"><strong>{item.label}</strong>{item.detail && <small>{item.detailIcon}{item.detail}</small>}</span>{item.recent && <span className="dropdown-recent">{item.recent}</span>}
      </button>) : <div className="dropdown-empty">{translate(language, 'Sonuç bulunamadı.')}</div>}</DropdownOptions>
    </div>
  return <div ref={root} title={title} className={`custom-dropdown ${className} ${accountPicker ? 'profile-account-select' : ''} ${open && !disabled ? 'open' : ''}`}>
    <button type="button" disabled={disabled} className="dropdown-trigger" aria-label={placeholder} aria-haspopup="listbox" aria-expanded={open && !disabled} onClick={() => { setPosition(null); setOpen(!open); setQuery('') }}>
      {leadingIcon}
      {selected?.icon}
      {selected?.type && <span className={`version-glyph ${selected.type}`}>{selected.optifine ? <OptifineGlyph /> : <VersionGlyph type={selected.type} custom={selected.custom} />}</span>}
      <span className="dropdown-copy"><strong>{selected?.label ?? placeholder}</strong>{selected?.detail && <small>{selected.detailIcon}{selected.detail}</small>}</span><ChevronDown size={17} />
    </button>
    {open && !disabled && (portalled ? position && createPortal(choices, document.body) : choices)}
  </div>
}

function VersionVariantMenu({ version, selectedId, onSelect, language }: {
  version: GameVersion
  selectedId: string | null
  onSelect: (id: string) => void
  language: Language
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const automaticId = `${version.id}-OptiFine_auto`
  const activeOptifine = selectedId === automaticId || version.optifineVersions.some(item => item.id === selectedId)
  return <div className="variant-picker" ref={root} onClick={event => event.stopPropagation()}>
    <button className="variant-trigger" aria-label={`${version.id}: ${translate(language, 'Oyun türünü seç')}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className={`version-glyph ${version.type}`}>{activeOptifine ? <OptifineGlyph /> : <VersionGlyph type={version.type} />}</span>
      <ChevronDown size={13} />
    </button>
    {open && <div className="variant-menu">
      <div className="variant-menu-title">{version.id} · {translate(language, 'Oyun türü')}</div>
      <button className={!activeOptifine ? 'selected' : ''} onClick={() => { onSelect(version.id); setOpen(false) }}><span className="version-glyph"><VersionGlyph type={version.type} /></span><span><strong>Minecraft</strong><small>{translate(language, 'Standart sürüm')}</small></span></button>
      {version.optifineVersions.length ? version.optifineVersions.map(item => <button className={selectedId === item.id ? 'selected' : ''} key={item.id} onClick={() => { onSelect(item.id); setOpen(false) }}><span className="version-glyph"><OptifineGlyph /></span><span><strong>OptiFine</strong><small>{item.id.slice(version.id.length).replace(/^-OptiFine_/i, '').replaceAll('_', ' ')}</small></span></button>) : (version.optifineAvailable || selectedId === automaticId) && <button className={selectedId === automaticId ? 'selected' : ''} onClick={() => { onSelect(automaticId); setOpen(false) }}><span className="version-glyph"><OptifineGlyph /></span><span><strong>OptiFine</strong><small>{translate(language, 'Oynarken otomatik kurulur')}</small></span></button>}
    </div>}
  </div>
}

function ProfileCardContent({ item, language, busy, instances = [], onPlay, onMenu, onPin }: {
  item: LauncherProfile
  language: Language
  busy: boolean
  instances?: RunningInstance[]
  onPlay: () => void
  onMenu: (event: ReactMouseEvent) => void
  onPin: () => void
}) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [modCount, setModCount] = useState(0)
  useEffect(() => {
    let active = true
    window.launcher.getProfileMods(item.id).then(mods => { if (active) setModCount(mods.length) }).catch(() => { if (active) setModCount(0) })
    return () => { active = false }
  }, [item])
  const versionDescription = `${profileVersionLabel(item)}${modCount ? ` · ${t('{count} mod', { count: modCount })}` : ''}`
  return <>
    <div className="profile-card-cover" style={{ '--profile-color': item.cover?.color ?? '#567fa3' } as CSSProperties}>{item.cover?.image && <img src={item.cover.image} alt="" />}</div>
    <div className="profile-card-top"><h3 title={item.name}>{item.name}</h3><div className="profile-card-top-actions"><button className={`profile-pin ${item.pinned ? 'active' : ''}`} title={item.pinned ? t('Sabitlemeyi kaldır') : t('Üste sabitle')} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onPin() }}><Pin size={16} fill={item.pinned ? 'currentColor' : 'none'} /></button><button className="profile-more" title={t('Profil seçenekleri')} aria-label={`${item.name}: ${t('Profil seçenekleri')}`} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onMenu(event) }}><MoreHorizontal size={18} /></button></div></div>
    <div className="profile-card-mid">{item.cover?.description && <p className="profile-description" title={item.cover.description}>{item.cover.description}</p>}<p className="profile-version" title={versionDescription}>{versionDescription}</p></div>
    <div className="profile-stats"><span><MemoryStick size={14} /> {memoryGb(item.memoryMb)} GB RAM</span><span><Monitor size={14} /> {item.width} × {item.height}</span></div>
    <RunningPlayButton compact instances={instances.filter(instance => instance.profileId === item.id)} disabled={busy} onPlay={onPlay} t={t} />

  </>
}

function SortableProfileCard({ item, focused, sortable, language, busy, instances = [], onManage, onPlay, onMenu, onPin }: {
  item: LauncherProfile
  focused: boolean
  sortable: boolean
  language: Language
  busy: boolean
  instances?: RunningInstance[]
  onManage: () => void
  onPlay: () => void
  onMenu: (event: ReactMouseEvent) => void
  onPin: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !sortable || !!item.pinned,
    transition: { duration: 310, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return <div ref={setNodeRef} style={style} className={`profile-card ${focused ? 'focus-target' : ''} ${sortable && !item.pinned ? 'sortable' : ''} ${isDragging ? 'is-dragging' : ''}`} onDoubleClick={event => { if (!(event.target as Element).closest('button')) onManage() }} onContextMenu={event => { event.preventDefault(); onMenu(event) }} {...attributes} {...listeners} onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); onManage() } else listeners?.onKeyDown?.(event) }}>
    <ProfileCardContent item={item} language={language} busy={busy} instances={instances} onPlay={onPlay} onMenu={onMenu} onPin={onPin} />
  </div>
}

function ProfilePageButton({ index, active, language, onClick }: { index: number; active: boolean; language: Language; onClick: () => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `profile-page-${index}` })
  return <button ref={setNodeRef} className={`${active ? 'active' : ''} ${isOver ? 'drop-page' : ''}`} aria-label={translate(language, 'Sayfa {page}', { page: index + 1 })} aria-current={active ? 'page' : undefined} onClick={onClick}>{index + 1}</button>
}

function App() {
  const updates = useLauncherUpdate()
  const [state, setState] = useState<LauncherState | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const [managedProfileId, setManagedProfileId] = useState<string | null>(null)
  const profileTabs = useRef<Record<string, Page>>(useMemo(() => {
    try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('green-launcher.profile-tabs') ?? '{}')).filter(([, page]) => profileWorkspacePages.includes(page as Page))) as Record<string, Page> } catch { return {} }
  }, []))
  const [isGlobalMods, setIsGlobalMods] = useState(false)
  const globalModsRef = useRef(isGlobalMods)
  globalModsRef.current = isGlobalMods
  const [profileSettingsBusy, setProfileSettingsBusy] = useState(false)
  const [worldsBusy, setWorldsBusy] = useState(false)
  const [serversBusy, setServersBusy] = useState(false)
  const managedProfileRef = useRef(managedProfileId)
  managedProfileRef.current = managedProfileId
  const [versions, setVersions] = useState<GameVersion[]>([])
  const [page, setPageState] = useState<Page>('home')
  const [visited, setVisited] = useState<Set<Page>>(() => new Set(['home']))
  const pageRef = useRef<Page>(page)
  const main = useRef<HTMLElement>(null)
  const scrollPositions = useRef<Partial<Record<Page, number>>>({})
  const setPage = (next: Page, globalMods = next === 'mods' && (!profileWorkspacePages.includes(pageRef.current) || globalModsRef.current)) => {
    globalModsRef.current = next === 'mods' && globalMods
    setIsGlobalMods(globalModsRef.current)
    if (profileWorkspacePages.includes(next) && !(next === 'mods' && globalMods)) {
      const current = stateRef.current
      const id = current?.profiles.find(item => item.id === managedProfileRef.current)?.id ?? current?.selectedProfileId ?? current?.profiles[0]?.id
      if (!id) next = 'profiles'
      else {
        managedProfileRef.current = id; setManagedProfileId(id)
        profileTabs.current[id] = next
        try { localStorage.setItem('green-launcher.profile-tabs', JSON.stringify(profileTabs.current)) } catch {}
      }
    }
    if (main.current) scrollPositions.current[pageRef.current] = main.current.scrollTop
    pageRef.current = next
    setVisited(current => current.has(next) ? current : new Set([...current, next]))
    setPageState(next)
  }
  const openProfileWorkspace = (id: string, next?: Page) => {
    managedProfileRef.current = id
    setManagedProfileId(id)
    setAccountSwitcherOpen(false)
    setPage(next ?? profileTabs.current[id] ?? 'worlds', false)
  }
  useEffect(() => {
    if (managedProfileId && state && !state.profiles.some(item => item.id === managedProfileId)) {
      managedProfileRef.current = null
      setManagedProfileId(null)
      if (profileWorkspacePages.includes(pageRef.current)) setPage('profiles')
    }
  }, [managedProfileId, state?.profiles, state?.selectedAccountId])
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = scrollPositions.current[page] ?? 0 }, [page, !!state])
  useEffect(() => {
    const pages: Page[] = ['home','versions','profiles','servers','worlds','mods','gallery','downloads','settings']
    const navigateKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat || event.defaultPrevented || !/^[1-9]$/.test(event.key) || document.querySelector('[aria-modal="true"], .modal-backdrop')) return
      event.preventDefault(); setPage(pages[Number(event.key) - 1])
    }
    window.addEventListener('keydown', navigateKey)
    return () => window.removeEventListener('keydown', navigateKey)
  }, [])

  const [downloads, setDownloads] = useState<DownloadSnapshot | null>(null)
  const [filter, setFilter] = useState<Filter>('release')
  const [scope, setScope] = useState<Scope>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(30)
  const [loadingVersions, setLoadingVersions] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [activity, setActivity] = useState<LauncherActivity>({ kind: 'idle', label: 'Hazır' })
  const [toast, setToast] = useState('')
  const [toastLeaving, setToastLeaving] = useState(false)
  const [toastRevision, setToastRevision] = useState(0)
  const toastRevisionRef = useRef(toastRevision)
  toastRevisionRef.current = toastRevision
  const notifyCape = (message: string) => { setToast(message); setToastRevision(value => value + 1) }
  const [instances, setInstances] = useState<RunningInstance[]>([])
  const [consoleTarget, setConsoleTarget] = useState<{ profileId: string; instanceId: string } | null>(null)
  const [launchRequest, setLaunchRequest] = useState<LaunchRequest | null>(null)
  const [launchPending, setLaunchPending] = useState(false)
  const launchLock = useRef(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false)
  const [offlineCreateOpen, setOfflineCreateOpen] = useState(false)
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null)
  const [browsedVersionId, setBrowsedVersionId] = useState<string | null>(null)
  const [profilePage, setProfilePage] = useState(0)
  const [focusedProfileId, setFocusedProfileId] = useState<string | null>(null)
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null)
  const skipProfileClick = useRef(false)
  const profileSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [profileMenu, setProfileMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [coverProfileId, setCoverProfileId] = useState<string | null>(null)
  const [profileTasks, setProfileTasks] = useState<string[]>([])
  const profileTaskLock = useRef(new Set<string>())
  const [profileDrop, setProfileDrop] = useState(false)
  const [importingProfiles, setImportingProfiles] = useState(0)
  useEffect(() => { setProfileMenu(null); setProfileDrop(false) }, [page, state?.selectedAccountId])
  const [settingsDraft, setSettingsDraft] = useState<LauncherSettings | null>(null)
  const [javaTab, setJavaTab] = useState<'general' | 'installations'>('general')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('launcher')
  useEffect(() => { if (page === 'storage') { setSettingsTab('storage'); setPage('settings') } }, [page])
  const [modsPresence, setModsPresence] = useState<LauncherPresenceContext>({ page: 'mods', section: 'custom' })
  const [accountView, setAccountView] = useState<'account' | 'capes'>('account')
  useEffect(() => {
    const section = changelogOpen ? 'changelog' : coverProfileId ? 'profile-cover' : profileDraft ? 'edit-profile' : page === 'settings' ? settingsTab : page === 'account' ? accountView : undefined
    const presencePage = page === 'profile-settings' || page === 'minecraft-log' || page === 'profile-version' ? 'profiles' : page
    const context = section ? { page: presencePage, section } : page === 'profile-settings' ? { page: presencePage, section: 'edit-profile' } : page === 'mods' ? modsPresence : { page: presencePage }
    void window.launcher.setPresenceContext(context).catch(() => {})
  }, [page, settingsTab, accountView, modsPresence, changelogOpen, coverProfileId, !!profileDraft])
  const [savingSettings, setSavingSettings] = useState(false)
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntimeInfo[]>([])
  const [javaLoading, setJavaLoading] = useState(false)
  const [deletingJavaPath, setDeletingJavaPath] = useState<string | null>(null)
  const [pendingJavaDelete, setPendingJavaDelete] = useState<JavaRuntimeInfo | null>(null)
  const [errorLogs, setErrorLogs] = useState<LauncherErrorEntry[]>([])
  const [heroIndex, setHeroIndex] = useState(0)
  const [heroMenuOpen, setHeroMenuOpen] = useState(false)
  const [pendingVersionDelete, setPendingVersionDelete] = useState<string | null>(null)
  const [versionContextMenu, setVersionContextMenu] = useState<{ id: string; installed: boolean; x: number; y: number } | null>(null)
  const versionContextMenuRef = useRef<HTMLDivElement>(null)
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([])
  const [screenshotProfile, setScreenshotProfile] = useState('all')
  const screenshotScope = managedProfileId && profileWorkspacePages.includes(page) ? managedProfileId : screenshotProfile
  const [screenshotSort, setScreenshotSort] = useState<ScreenshotSort>('newest')
  const screenshotRequest = useRef(0)
  const [screenshotsHasMore, setScreenshotsHasMore] = useState(false)
  const [screenshotsLoading, setScreenshotsLoading] = useState(false)
  const [screenshotOpen, setScreenshotOpen] = useState<{ name: string; url: string } | null>(null)
  const [screenshotContextMenu, setScreenshotContextMenu] = useState<{ item: ScreenshotItem; x: number; y: number } | null>(null)
  const screenshotContextMenuRef = useRef<HTMLDivElement>(null)
  const [pendingScreenshotDelete, setPendingScreenshotDelete] = useState<ScreenshotItem | null>(null)
  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>({ accountReady: false, versionReady: false })

  const downloadReceived = useRef(false)
  useEffect(() => {
    window.launcher.getDownloads().then(value => { if (!downloadReceived.current) setDownloads(value) }).catch(() => {})
    const unsub = [window.launcher.on('state', setState), window.launcher.on('instances', setInstances), window.launcher.on('consoleRequest', target => { if (!stateRef.current?.profiles.some(profile => profile.id === target.profileId)) return; setConsoleTarget(target); openProfileWorkspace(target.profileId, 'minecraft-log') }), window.launcher.on('navigate', setPage), window.launcher.on('launchRequest', setLaunchRequest), window.launcher.on('activity', setActivity), window.launcher.on('downloads', value => { downloadReceived.current = true; setDownloads(value) }), window.launcher.on('shortcutError', error => setToast(friendlyError(error))), window.launcher.on('notice', setToast), window.launcher.on('errorLog', setErrorLogs)]
    window.launcher.getRunningInstances().then(setInstances).catch(() => {})
    window.launcher.getState().then(setState).catch(error => setToast(friendlyError(error)))
    let active = true
    void (async () => {
      let cached: GameVersion[] = []
      try {
        cached = await window.launcher.getVersions()
        if (active) { setVersions(cached); if (cached.length) setLoadingVersions(false) }
      } catch (error) { if (active) setCatalogError(friendlyError(error)) }
      try {
        const fresh = await window.launcher.getVersions('if-stale')
        if (active) { setVersions(fresh); setCatalogError('') }
      } catch (error) { if (active && !cached.length) setCatalogError(friendlyError(error)) }
      finally { if (active) setLoadingVersions(false) }
    })()
    return () => { active = false; unsub.forEach(fn => fn()) }
  }, [])
  const catalogAccount = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!state) return
    const changedAccount = catalogAccount.current !== undefined && catalogAccount.current !== state.selectedAccountId
    catalogAccount.current = state.selectedAccountId
    if (!changedAccount) return
    let current = true
    setProfileDraft(null)
    setFocusedProfileId(null)
    setProfilePage(0)
    setScreenshotProfile('all')
    setScreenshots([])
    setScreenshotOpen(null)
    setScreenshotContextMenu(null)
    setPendingScreenshotDelete(null)
    window.launcher.getVersions().then(value => { if (current) setVersions(value) }).catch(error => { if (current) setToast(friendlyError(error)) })
    return () => { current = false }
  }, [state?.selectedAccountId])
  useEffect(() => { if (state && !settingsDraft) setSettingsDraft(state.settings) }, [state, settingsDraft])
  useLayoutEffect(() => { if (toast) setToastLeaving(false) }, [toast, toastRevision])
  useEffect(() => {
    if (!toast) return
    const exit = window.setTimeout(() => setToastLeaving(true), 5700)
    const remove = window.setTimeout(() => setToast(''), 6000)
    return () => { window.clearTimeout(exit); window.clearTimeout(remove) }
  }, [toast, toastRevision])
  useEffect(() => {
    if (page !== 'settings' || settingsTab !== 'java' || javaTab !== 'installations') return
    let active = true
    setJavaLoading(true)
    window.launcher.getJavaRuntimes().then(items => { if (active) setJavaRuntimes(items) }).catch(error => { if (active) setToast(friendlyError(error)) }).finally(() => { if (active) setJavaLoading(false) })
    return () => { active = false }
  }, [page, settingsTab, javaTab])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  useEffect(() => {
    if (!state || online) return
    let active = true
    window.launcher.getOfflineStatus().then(value => { if (active) setOfflineStatus(value) }).catch(() => {})
    return () => { active = false }
  }, [online, state?.selectedAccountId, state?.selectedVersionId, state?.profiles, versions])
  useEffect(() => {
    if (page === 'storage' || (page === 'settings' && settingsTab === 'storage')) {
      window.launcher.getDiskUsage().then(setDiskUsage).catch(error => setToast(friendlyError(error)))
      window.launcher.getCleanupPreview().then(setCleanupPreview).catch(error => setToast(friendlyError(error)))
    }
  }, [page, settingsTab, state?.selectedAccountId])
  const screenshotKey = useRef('')
  useEffect(() => {
    if (page !== 'gallery') return
    const key = `${screenshotScope}:${screenshotSort}:${state?.selectedAccountId}`
    const cached = screenshotKey.current === key
    screenshotKey.current = key
    const request = ++screenshotRequest.current
    const pages = cached ? Math.max(1, Math.ceil(screenshots.length / screenshotPageSize)) : 1
    if (!cached) { setScreenshots([]); setScreenshotsHasMore(false) }
    setScreenshotsLoading(true)
    Promise.all(Array.from({ length: pages }, (_, index) => window.launcher.getScreenshots(screenshotScope, index * screenshotPageSize, screenshotSort)))
      .then(parts => { if (request === screenshotRequest.current) { setScreenshots(parts.flat()); setScreenshotsHasMore(parts.at(-1)?.length === screenshotPageSize) } })
      .catch(error => { if (request === screenshotRequest.current) setToast(friendlyError(error)) })
      .finally(() => { if (request === screenshotRequest.current) setScreenshotsLoading(false) })
  }, [page, screenshotScope, screenshotSort, state?.selectedAccountId])
  useEffect(() => { setVersionContextMenu(null) }, [page, filter, scope, query])
  useEffect(() => { if (page !== 'gallery') setScreenshotContextMenu(null) }, [page])
  useEffect(() => {
    if (!screenshotContextMenu) return
    const close = (event: MouseEvent) => { if (!(event.target as Element).closest('.screenshot-more') && !screenshotContextMenuRef.current?.contains(event.target as Node)) setScreenshotContextMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setScreenshotContextMenu(null) }
    const scroll = () => setScreenshotContextMenu(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    document.querySelector('.main-content')?.addEventListener('scroll', scroll)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); document.querySelector('.main-content')?.removeEventListener('scroll', scroll) }
  }, [screenshotContextMenu])
  useEffect(() => {
    if (!focusedProfileId || page !== 'profiles') return
    document.querySelector('.profile-card.focus-target')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const clear = () => setFocusedProfileId(null)
    document.addEventListener('pointerdown', clear, { once: true })
    document.addEventListener('keydown', clear, { once: true })
    return () => { document.removeEventListener('pointerdown', clear); document.removeEventListener('keydown', clear) }
  }, [focusedProfileId, page, profilePage])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFilterOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => { setProfilePage(current => Math.min(current, Math.max(0, Math.ceil((state?.profiles.length ?? 0) / 9) - 1))) }, [state?.profiles.length])
  useEffect(() => {
    if (!versionContextMenu) return
    const closeOnPointer = (event: MouseEvent) => { if (!versionContextMenuRef.current?.contains(event.target as Node)) setVersionContextMenu(null) }
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setVersionContextMenu(null) }
    const closeOnScroll = () => setVersionContextMenu(null)
    document.addEventListener('mousedown', closeOnPointer)
    document.addEventListener('keydown', closeOnKey)
    document.querySelector('.main-content')?.addEventListener('scroll', closeOnScroll)
    return () => {
      document.removeEventListener('mousedown', closeOnPointer)
      document.removeEventListener('keydown', closeOnKey)
      document.querySelector('.main-content')?.removeEventListener('scroll', closeOnScroll)
    }
  }, [versionContextMenu])

  const profile = state?.profiles.find(item => item.id === state.selectedProfileId)
  const managedProfile = state?.profiles.find(item => item.id === managedProfileId)
  const inProfileWorkspace = !!managedProfile && profileWorkspacePages.includes(page) && !(page === 'mods' && isGlobalMods)
  useEffect(() => {
    if (!managedProfile || !inProfileWorkspace) return
    for (const kind of ['mod', 'resourcepack', 'shader'] as const) {
      void installedContentCache.load(installedContentScope(managedProfile, kind), () => kind === 'resourcepack' ? window.launcher.getResourcePacks(managedProfile.id) : window.launcher.getProfileContent(managedProfile.id, kind)).catch(() => {})
    }
  }, [managedProfile?.id, managedProfile?.gameDirectory, managedProfile?.versionId, managedProfile?.modLoader, managedProfile?.modLoaderVersion, inProfileWorkspace])
  const profilePages = Math.max(1, Math.ceil((state?.profiles.length ?? 0) / 9))
  const visibleProfiles = state?.profiles.slice(profilePage * 9, profilePage * 9 + 9) ?? []
  const account = state?.accounts.find(item => item.id === state.selectedAccountId)
  const latest = versions.find(item => item.type === 'release')
  const footerProfile = inProfileWorkspace ? managedProfile : profile
  const selectedVersionLabel = footerProfile ? profileVersionLabel(footerProfile).replace(/^Minecraft /, '') : '—'
  const language = settingsDraft?.language ?? 'tr'
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  useEffect(() => {
    const result = updates.checkResult?.value
    if (!result) return
    notifyCape(result.error ? t(updateErrorText(result)) : result.phase === 'current' ? t('En son sürümü kullanıyorsun.') : result.phase === 'available' ? `${t('Yeni bir güncelleme var')} · v${result.version}` : t('Güncellemeler kurulu Windows uygulamasında kullanılabilir.'))
  }, [updates.checkResult])
  useEffect(() => { if (updates.failure) notifyCape(t(updateErrorText(updates.failure.value))) }, [updates.failure])
  const localVersionLabels: Record<VersionType, string> = { release: t('Kararlı sürüm'), snapshot: 'Snapshot', old_beta: t('Eski Beta'), old_alpha: t('Eski Alpha') }
  const busy = launchPending || ['installing', 'launching'].includes(activity.kind)
  const launchBusy = launchPending || activity.kind === 'launching'
  const versionOptions = useMemo(() => versions.filter(item => item.type === 'release' || state?.settings.showSnapshots || item.id === state?.selectedVersionId || `${item.id}-OptiFine_auto` === state?.selectedVersionId || item.optifineVersions.some(variant => variant.id === state?.selectedVersionId)).flatMap(item => {
    const recent = (id: string) => {
      const entry = state?.playHistory.find(history => history.versionId === id)
      return entry ? t('Son oynama: {time}', { time: relativeDate(entry.at, language) }) : undefined
    }
    return [
      { value: item.id, label: item.id, detail: item.custom ? t('Özel istemci') : localVersionLabels[item.type], recent: recent(item.id), type: item.type, custom: item.custom },
      ...(item.optifineVersions.length ? item.optifineVersions.map(variant => ({ value: variant.id, label: `${item.id} · OptiFine`, detail: variant.id.slice(item.id.length).replace(/^-OptiFine_/i, '').replaceAll('_', ' '), recent: recent(variant.id), type: item.type, optifine: true })) : item.optifineAvailable || state?.selectedVersionId === `${item.id}-OptiFine_auto` ? [{ value: `${item.id}-OptiFine_auto`, label: `${item.id} · OptiFine`, detail: t('Oynarken otomatik kurulur'), recent: undefined, type: item.type, optifine: true }] : [])
    ]
  }), [versions, state?.settings.showSnapshots, state?.selectedVersionId, state?.playHistory, language])
  const serverVersionOptions = versions.filter(item => item.type === 'release' && !item.custom).map(item => ({ value: item.id, label: item.id, detail: localVersionLabels.release, type: item.type }))
  const filteredVersions = useMemo(() => versions.flatMap(item => {
    if (filter !== 'all' && item.type !== filter) return []
    const base = { item, variantId: null as string | null }
    const variants = item.optifineVersions.map(variant => ({ item, variantId: variant.id }))
    const entries = scope === 'custom' ? (item.custom ? [base] : []) : scope === 'optifine' ? variants : scope === 'installed' ? [...(item.installed ? [base] : []), ...variants] : [base]
    const search = query.trim().toLowerCase()
    return entries.filter(entry => (entry.variantId ?? item.id).toLowerCase().includes(search))
  }), [versions, filter, scope, query])
  const visibleVersions = filteredVersions.slice(0, count)
  const totalVisible = filteredVersions.length
  const dirty = !!state && !!settingsDraft && JSON.stringify(settingsDraft) !== JSON.stringify(state.settings)
  const run = async (task: () => Promise<unknown>, success?: string) => { try { await task(); if (success) setToast(success) } catch (error) { setToast(friendlyError(error)) } }
  const dismissToast = () => {
    const message = toast
    const revision = toastRevision
    setToastLeaving(true)
    window.setTimeout(() => setToast(current => current === message && toastRevisionRef.current === revision ? '' : current), 240)
  }
  const deleteJava = async (item: JavaRuntimeInfo) => {
    setPendingJavaDelete(null)
    setDeletingJavaPath(item.path)
    try {
      await window.launcher.deleteJavaRuntime(item.path)
      setJavaRuntimes(current => current.filter(runtime => runtime.path !== item.path))
      setToast(t('Java kurulumu kaldırıldı.'))
    } catch (error) { setToast(friendlyError(error)) }
    finally { setDeletingJavaPath(null) }
  }
  const chooseVersion = (id: string) => setBrowsedVersionId(id)
  const openVersionContextMenu = (event: ReactMouseEvent, id: string, installed: boolean) => {
    event.preventDefault()
    setVersionContextMenu({ id, installed, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 252)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 184)) })
  }
  const openScreenshotContextMenu = (item: ScreenshotItem, x: number, y: number) => {
    setScreenshotContextMenu({ item, x: Math.max(8, Math.min(x, window.innerWidth - 252)), y: Math.max(8, Math.min(y, window.innerHeight - 188)) })
  }
  const toggleScreenshotContextMenu = (item: ScreenshotItem, x: number, y: number) => {
    setScreenshotContextMenu(current => current?.item.id === item.id ? null : { item, x: Math.max(8, Math.min(x, window.innerWidth - 252)), y: Math.max(8, Math.min(y, window.innerHeight - 188)) })
  }
  const launchTarget = async (request: LaunchRequest, confirmed = false) => {
    if (launchLock.current) return
    launchLock.current = true
    setLaunchPending(true)
    try {
      const current = await window.launcher.getState()
      if (request.temporaryOfflineName === undefined && current.selectedAccountId !== request.accountId) { setLaunchRequest(null); setToast(t('Hesap değişti. Oyunu yeniden başlatmayı dene.')); return }
      const active = await window.launcher.getRunningInstances()
      setInstances(active)
      if (active.length && !confirmed) { setLaunchRequest(request); return }
      const result = request.profileId === null
        ? await window.launcher.playVersion(request.versionId!, confirmed, request.serverAddress, request.serverPreference, request.temporaryOfflineName)
        : await window.launcher.play(request.profileId, confirmed, undefined, request.serverAddress, request.serverPreference, request.worldId)
      if (result.status === 'confirmation-required') { setInstances(result.instances); setLaunchRequest(request); return }
      setLaunchRequest(null)
      setVersions(await window.launcher.getVersions())
    } catch (error) { setToast(friendlyError(error)) }
    finally { launchLock.current = false; setLaunchPending(false) }
  }
  const playVersion = (id: string) => {
    if (!account) { setAccountSwitcherOpen(true); setToast(t('Oynamak için bir hesap seç veya çevrimdışı hesap oluştur.')); return }
    void launchTarget({ profileId: null, accountId: account.id, versionId: id })
  }
  const deleteSelectedVersion = () => {
    if (!pendingVersionDelete) return
    const id = pendingVersionDelete
    run(async () => {
      await window.launcher.deleteVersion(id)
      const updated = await window.launcher.getVersions()
      setVersions(updated)
      if (browsedVersionId === id) setBrowsedVersionId(null)
      setPendingVersionDelete(null)
    }, t('{version} Geri Dönüşüm Kutusu’na taşındı.', { version: id }))
  }
  const createDraft = () => { if (!account) { setAccountSwitcherOpen(true); setToast(t('Önce bir hesap seçin.')); return } if (state) setProfileDraft({ name: t('Yeni profil'), versionId: browsedVersionId ?? latest?.id ?? '', javaPath: '', memoryMb: state.settings.memoryMb, minMemoryMb: Math.min(1024, state.settings.memoryMb), width: state.settings.width, height: state.settings.height, jvmArgs: '', fullscreen: false, gameDirectory: '' }) }
  const editProfile = (item: LauncherProfile) => openProfileWorkspace(item.id, 'profile-settings')
  const openProfileMenu = (event: ReactMouseEvent, id: string) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setProfileMenu(current => event.type !== 'contextmenu' && current?.id === id ? null : { id, x: event.type === 'contextmenu' ? event.clientX : rect.right - 260, y: event.type === 'contextmenu' ? event.clientY : rect.bottom + 6 })
  }
  const importProfileFiles = async (paths?: string[]) => {
    setProfileDrop(false)
    const files = paths?.length ? paths.slice(0, 8) : [undefined]
    setImportingProfiles(value => value + files.length)
    await Promise.all(files.map(async path => {
      try {
        const result = await window.launcher.importProfile(path)
        if (result) { setState(result.state); void window.launcher.getVersions().then(setVersions).catch(() => {}); notifyCape(t('{name} içe aktarıldı.', { name: result.state.profiles.find(item => item.id === result.profileId)?.name ?? t('Profil') })) }
      } catch (error) { notifyCape(friendlyError(error)) }
      finally { setImportingProfiles(value => value - 1) }
    }))
  }
  const profileAction = async (id: string, action: ProfileAction) => {
    const item = state?.profiles.find(value => value.id === id)
    if (!item) return
    if (action === 'manage') { openProfileWorkspace(id); return }
    if (action === 'edit') { editProfile(item); return }
    if (action === 'cover') { setCoverProfileId(id); return }
    if (action === 'delete') { setDeleteId(id); return }
    if (action === 'mods-folder') { await run(() => window.launcher.openProfileMods(id)); return }
    if (profileTaskLock.current.has(id)) { setPage('downloads'); return }
    profileTaskLock.current.add(id); setProfileTasks([...profileTaskLock.current])
    try {
      if (action === 'clone') { const result = await window.launcher.cloneProfile(id); setState(result.state); notifyCape(t('Profil klonlandı.')) }
      if (action === 'export') { const path = await window.launcher.exportProfile(id); if (path) notifyCape(t('Profil paketi dışa aktarıldı.')) }
      if (action === 'repair') { setState(await window.launcher.repairProfile(id)); void window.launcher.getVersions().then(setVersions).catch(() => {}); notifyCape(t('Profil dosyaları doğrulandı ve gerekli dosyalar onarıldı.')) }
      if (action === 'shortcut') { await window.launcher.createProfileShortcut(id); notifyCape(t('Masaüstü kısayolu oluşturuldu.')) }
    } catch (error) { notifyCape(friendlyError(error)) }
    finally { profileTaskLock.current.delete(id); setProfileTasks([...profileTaskLock.current]) }
  }
  const saveProfile = () => { if (profileDraft) run(async () => {
    if ((profileDraft.minMemoryMb ?? 1024) > profileDraft.memoryMb) throw new Error(t('Minimum bellek maksimum bellekten büyük olamaz.'))
    const wasNew = !profileDraft.id
    const updated = await window.launcher.saveProfile(profileDraft)
    setState(updated)
    if (wasNew) setProfilePage(Math.floor((updated.profiles.length - 1) / 9))
    setProfileDraft(null)
  }, t('Profil kaydedildi.')) }
  const handleProfileDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggedProfileId(null)
    if (!state || !over || active.id === over.id || state.profiles.find(item => item.id === active.id)?.pinned) return
    const ids = state.profiles.map(item => item.id)
    const from = ids.indexOf(String(active.id))
    if (from < 0) return
    let reordered: string[]
    const target = String(over.id)
    if (target.startsWith('profile-page-')) {
      const nextPage = Number(target.slice('profile-page-'.length))
      if (!Number.isInteger(nextPage) || nextPage < 0 || nextPage >= profilePages) return
      ids.splice(from, 1)
      ids.splice(Math.min(nextPage * 9, ids.length), 0, String(active.id))
      reordered = ids
      setProfilePage(nextPage)
    } else {
      const to = ids.indexOf(target)
      if (to < 0 || state.profiles[to]?.pinned) return
      reordered = arrayMove(ids, from, to)
    }
    if (reordered.every((id, index) => id === state.profiles[index].id)) return
    const byId = new Map(state.profiles.map(item => [item.id, item]))
    setState({ ...state, profiles: reordered.map(id => byId.get(id)!) })
    window.launcher.reorderProfiles(reordered).then(setState).catch(error => { setState(state); setToast(friendlyError(error)) })
  }
  const playProfile = (id: string) => { if (!account) { setAccountSwitcherOpen(true); setToast(t('Oynamak için bir hesap seç veya çevrimdışı hesap oluştur.')); return } void launchTarget({ profileId: id, accountId: account.id }) }
  const saveSettings = async () => { if (!settingsDraft) return; setSavingSettings(true); try { const updated = await window.launcher.saveSettings(settingsDraft); setState(updated); setSettingsDraft(updated.settings); setToast(t('Ayarlar kaydedildi.')) } catch (error) { setToast(friendlyError(error)) } finally { setSavingSettings(false) } }
  const togglePin = (id: string) => run(async () => setState(await window.launcher.toggleProfilePin(id)))
  const openScreenshot = (item: ScreenshotItem) => run(async () => setScreenshotOpen({ name: item.name, url: await window.launcher.getScreenshot(item.id) }))
  const deleteScreenshot = (item: ScreenshotItem) => run(async () => {
    await window.launcher.deleteScreenshot(item.id)
    setPendingScreenshotDelete(null)
    setScreenshotOpen(null)
    setScreenshots(current => current.filter(candidate => candidate.id !== item.id))
    setToast(t('Ekran görüntüsü Geri Dönüşüm Kutusu’na taşındı.'))
  })
  const refreshScreenshots = () => run(async () => {
    const request = ++screenshotRequest.current
    setScreenshotsLoading(true)
    setScreenshotContextMenu(null)
    try {
      const items = await window.launcher.getScreenshots(screenshotScope, 0, screenshotSort)
      if (request === screenshotRequest.current) { setScreenshots(items); setScreenshotsHasMore(items.length === screenshotPageSize); setToast(t('Ekran görüntüleri yenilendi.')) }
    } finally { if (request === screenshotRequest.current) setScreenshotsLoading(false) }
  })
  const loadMoreScreenshots = () => run(async () => {
    const request = screenshotRequest.current
    setScreenshotsLoading(true)
    try {
      const next = await window.launcher.getScreenshots(screenshotScope, screenshots.length, screenshotSort)
      if (request === screenshotRequest.current) { setScreenshots(current => [...current, ...next]); setScreenshotsHasMore(next.length === screenshotPageSize) }
    } finally { if (request === screenshotRequest.current) setScreenshotsLoading(false) }
  })
  const cleanFiles = (approvedPaths: string[]) => run(async () => {
    setCleaning(true)
    try {
      const result = await window.launcher.cleanUnusedFiles(approvedPaths)
      setCleanupPreview(await window.launcher.getCleanupPreview())
      setDiskUsage(await window.launcher.getDiskUsage())
      setVersions(await window.launcher.getVersions())
      setToast(t('{size} Geri Dönüşüm Kutusu’na taşındı.', { size: formatBytes(result.bytes) }))
    } finally { setCleaning(false) }
  })
  const toggleHeroAnimation = () => {
    if (!state) return
    run(async () => {
      const updated = await window.launcher.saveSettings({ animateHero: !state.settings.animateHero })
      setState(updated)
      setSettingsDraft(current => current ? { ...current, animateHero: updated.settings.animateHero } : updated.settings)
    })
  }

  if (!state || !settingsDraft) return <div className="boot-screen"><img src={logo} /><span>Green Launcher</span><LoaderCircle className="spin" size={20} /></div>
  const updateSettings = (changes: Partial<LauncherSettings>) => setSettingsDraft({ ...settingsDraft, ...changes })

  const pendingDownloads = downloads?.jobs.filter(job => !['completed', 'failed'].includes(job.phase)) ?? []
  const activeDownload = pendingDownloads.find(job => !job.queued && job.phase !== 'queued') ?? pendingDownloads[0]
  const waiting = pendingDownloads.length - (activeDownload ? 1 : 0)
  const downloadStatus = activeDownload ? `${activeDownload.title} · ${t(activeDownload.phase === 'paused' ? 'İndirme duraklatıldı.' : activeDownload.phase === 'queued' ? 'Kuyrukta bekliyor.' : activeDownload.phase === 'downloading' ? 'İndiriliyor.' : activeDownload.phase === 'retrying' ? 'Bağlantı yeniden kuruluyor.' : activeDownload.phase === 'verifying' ? 'Doğrulanıyor.' : 'Hazırlanıyor.')} ${activeDownload.totalBytes ? `${formatBytes(activeDownload.downloadedBytes)} / ${formatBytes(activeDownload.totalBytes)}` : ''}${activeDownload.phase === 'downloading' && activeDownload.bytesPerSecond ? ` · ${formatBytes(activeDownload.bytesPerSecond)}/sn` : ''}${waiting ? ` · ${t('{count} indirme kuyrukta', { count: waiting })}` : ''}` : ''
  return <div className="app-shell">
    <div className="titlebar"><div className="titlebar-left"><img src={logo} /> Green Launcher</div><div className="titlebar-actions"><button aria-label={t('Küçült')} onClick={() => window.launcher.windowAction('minimize')}><Minus size={16} /></button><button aria-label={t('Büyüt')} onClick={() => window.launcher.windowAction('maximize')}><Maximize2 size={13} /></button><button aria-label={t('Kapat')} className="close-window" onClick={() => window.launcher.windowAction('close')}><X size={17} /></button></div></div>
    <div className="app-body">
      <aside className={`sidebar ${inProfileWorkspace ? 'profile-sidebar' : ''}`}>{inProfileWorkspace && managedProfile ? <>
        <button type="button" className="profile-workspace-back" onClick={() => setPage('profiles')}><ArrowLeft size={18} />{t('Profillerim’e dön')}</button>
        <div className="profile-workspace-identity">
          <div className="workspace-profile-select"><LauncherMenu language={language} version={packageJson.version} onAbout={() => { setSettingsTab('about'); setPage('settings') }} onOpen={url => run(() => window.launcher.openExternal(url))} identity={{ name: managedProfile.name, icon: <span className="profile-workspace-icon"><ProfileIcon profile={managedProfile} /></span> }} /></div>
        </div>
        <div className="brand-separator" />
        <nav className="side-nav profile-workspace-nav" aria-label={t('Profil yönetimi')}>
          <button className={page === 'worlds' ? 'active' : ''} aria-current={page === 'worlds' ? 'page' : undefined} onClick={() => setPage('worlds')}><Globe2 size={19} />{t('Dünyalar')}</button>
          <button className={page === 'servers' ? 'active' : ''} aria-current={page === 'servers' ? 'page' : undefined} onClick={() => setPage('servers')}><Server size={19} />{t('Sunucular')}</button>
          <div className="nav-divider" />
          <button className={page === 'mods' ? 'active' : ''} aria-current={page === 'mods' ? 'page' : undefined} onClick={() => setPage('mods')}><Package size={19} />{t('Modlar')}</button>
          <button className={page === 'resource-packs' ? 'active' : ''} aria-current={page === 'resource-packs' ? 'page' : undefined} onClick={() => setPage('resource-packs')}><ImageIcon size={19} />{t('Kaynak paketleri')}</button>
          <button className={page === 'shader-packs' ? 'active' : ''} aria-current={page === 'shader-packs' ? 'page' : undefined} onClick={() => setPage('shader-packs')}><Sparkles size={19} />{t('Shader paketleri')}</button>
          <div className="nav-divider" />
          <button data-profile-page="profile-settings" className={page === 'profile-settings' ? 'active' : ''} aria-current={page === 'profile-settings' ? 'page' : undefined} onClick={() => editProfile(managedProfile)}><Settings2 size={19} />{t('Ayarlar')}</button>
          <button data-profile-page="profile-version" className={page === 'profile-version' ? 'active' : ''} aria-current={page === 'profile-version' ? 'page' : undefined} onClick={() => setPage('profile-version')}><Layers3 size={19} />{t('Sürüm')}</button>
          <div className="nav-divider" />
          <button className={page === 'gallery' ? 'active' : ''} aria-current={page === 'gallery' ? 'page' : undefined} onClick={() => setPage('gallery')}><ImageIcon size={19} />{t('Ekran görüntüleri')}</button>
          <button data-profile-page="minecraft-log" className={page === 'minecraft-log' ? 'active' : ''} aria-current={page === 'minecraft-log' ? 'page' : undefined} onClick={() => setPage('minecraft-log')}><FileText size={19} />{t('Minecraft günlüğü')}</button>
        </nav>
      </> : <><LauncherMenu language={language} version={packageJson.version} onAbout={() => { setPage('settings'); setSettingsTab('about') }} onOpen={url => run(() => window.launcher.openExternal(url))} /><div className="brand-separator" />
        <nav className="side-nav">
          <div className="nav-heading">{t('OYUN')}</div>
          <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}><Home size={19} /> {t('Ana Sayfa')}</button>
          <button className={page === 'versions' ? 'active' : ''} onClick={() => setPage('versions')}><Layers3 size={19} /> {t('Sürümler')}</button>
          <button className={page === 'profiles' ? 'active' : ''} onClick={() => setPage('profiles')}><UsersRound size={19} /> {t('Profillerim')}</button>
          <button className={page === 'mods' ? 'active' : ''} onClick={() => setPage('mods', true)}><Package size={19} /> {t('Modlar')}</button>
          <div className="nav-divider" />
          <div className="nav-heading">{t('UYGULAMA')}</div>
          <button className={page === 'downloads' ? 'active' : ''} onClick={() => setPage('downloads')}><CloudDownload size={19} /> {t('İndirmeler')}</button>
          <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}><Settings2 size={19} /> {t('Ayarlar')}</button>
        </nav>
        <div className="sidebar-spacer" />
        </>}<AccountSwitcher state={state} t={t} onState={setState} onNotice={setToast} open={accountSwitcherOpen} setOpen={setAccountSwitcherOpen} active={page === 'account'} onManage={() => setAccountOpen(true)} onOffline={() => setOfflineCreateOpen(true)} onProfile={() => setPage('account')} />
      </aside>
      <main ref={main} onScroll={() => { if (main.current) scrollPositions.current[page] = main.current.scrollTop }} className={`main-content page-${page}`}>
        {visited.has('minecraft-log') && managedProfile && <div className="retained-page" hidden={page !== 'minecraft-log'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}><MinecraftLogPage key={managedProfile.id} profile={managedProfile} requestedSession={consoleTarget?.profileId === managedProfile.id ? consoleTarget : undefined} language={language} isVisible={page === 'minecraft-log'} instances={instances} onNotice={notifyCape} sessionPicker={(value, options, onChange) => <Dropdown className="minecraft-log-session" language={language} value={value} options={options} onChange={onChange} placeholder={t('Oyun oturumu')} showAll />} /></Suspense></div>}
        {visited.has('profile-version') && managedProfile && <div className="retained-page" hidden={page !== 'profile-version'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}><ProfileVersionPage key={managedProfile.id} profile={managedProfile} versions={versions} language={language} isVisible={page === 'profile-version'} running={instances.some(instance => instance.profileId === managedProfile.id)} onState={setState} onVersions={setVersions} onNotice={setToast} picker={(value, options, onChange, label, disabled, searchable) => <Dropdown className="profile-version-choice" language={language} value={value} options={options} onChange={onChange} placeholder={label} disabled={disabled} searchable={searchable} searchPlaceholder={t('Sürüm ara')} showAll />} /></Suspense></div>}
        {visited.has('profile-settings') && managedProfile && <div className="retained-page" hidden={page !== 'profile-settings'}><ProfileSettingsPage profile={managedProfile} selectedProfileId={state.selectedProfileId} selectedAccountId={state.selectedAccountId} language={language} isVisible={page === 'profile-settings'} settings={state.settings} accounts={state.accounts} choicePicker={(value, options, onChange, label, disabled) => <Dropdown className="profile-setting-select" language={language} value={value} options={options} onChange={onChange} placeholder={label} disabled={disabled} showAll />} onState={setState} onNotice={setToast} onBusyChange={setProfileSettingsBusy} onOpenGeneral={tab => { setSettingsTab(tab); setPage('settings') }} /></div>}
        {visited.has('worlds') && <div className="retained-page" hidden={page !== 'worlds'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}><WorldsPage scopedProfileId={managedProfileId ?? undefined} onBusyChange={setWorldsBusy} state={state} language={language} instances={instances} launchBusy={launchBusy} isVisible={page === 'worlds'} onCreateProfile={createDraft} onNotice={setToast} onJoin={request => void launchTarget(request)} profilePicker={(value, onChange, disabled) => <Dropdown className="servers-list-profile-select" searchable showAll searchPlaceholder={t('Profil ara')} language={language} value={value} placeholder={t('Profil seç')} disabled={disabled} options={state.profiles.map(item => ({value:item.id,label:item.name}))} onChange={onChange} />} /></Suspense></div>}
        {visited.has('servers') && <div className="retained-page" hidden={page !== 'servers'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}><ServersPage scopedProfileId={managedProfileId ?? undefined} onBusyChange={setServersBusy} onCreateProfile={createDraft} isVisible={page === 'servers'} state={state} versions={versions} language={language} launchBusy={launchBusy} onNotice={setToast} onJoin={request => void launchTarget(request)} listProfilePicker={(value, onChange, disabled) => <Dropdown className="servers-list-profile-select" searchable showAll searchPlaceholder={t('Profil ara')} language={language} value={value} placeholder={t('Profil seç')} disabled={disabled || !state.profiles.length} options={state.profiles.map(item => ({value:item.id,label:item.name}))} onChange={onChange} />} profilePicker={(value, onChange) => <Dropdown className="servers-profile-select" searchable searchPlaceholder={t('Profil ara')} language={language} value={value} placeholder={t('Profil seç')} options={state.profiles.map(item => ({value:item.id,label:item.name,detail:profileVersionLabel(item)}))} onChange={onChange} />} choicePicker={(value, options, onChange, label, className) => <Dropdown language={language} value={value} options={options} onChange={onChange} placeholder={label} className={className} />} versionPicker={(value, onChange) => <Dropdown className="profile-version-select" searchable showAll language={language} value={value} placeholder={t('Sürüm seç')} options={serverVersionOptions} onChange={onChange} />} /></Suspense></div>}
        {visited.has('mods') && <div className="retained-page" hidden={page !== 'mods'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}>{!isGlobalMods && managedProfile ? <ResourcePacksPage key={installedContentScope(managedProfile, 'mod')} kind="mod" profile={managedProfile} language={language} isVisible={page === 'mods'} running={instances.some(instance => instance.profileId === managedProfile.id)} onNotice={notifyCape} /> : <ModsPage state={state} versions={versions} language={language} onState={setState} onNotice={notifyCape} onDownloads={() => setPage('downloads')} onPresenceChange={setModsPresence} />}</Suspense></div>}
        {visited.has('resource-packs') && managedProfile && <div className="retained-page" hidden={page !== 'resource-packs'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}><ResourcePacksPage key={installedContentScope(managedProfile, 'resourcepack')} profile={managedProfile} language={language} isVisible={page === 'resource-packs'} running={instances.some(instance => instance.profileId === managedProfile.id)} onNotice={notifyCape} /></Suspense></div>}
        {visited.has('shader-packs') && managedProfile && <div className="retained-page" hidden={page !== 'shader-packs'}><Suspense fallback={<div className="content-page page-loading" role="status"><LoaderCircle className="spin" size={28} /><span>{t('Yükleniyor...')}</span></div>}><ResourcePacksPage key={installedContentScope(managedProfile, 'shader')} kind="shader" profile={managedProfile} language={language} isVisible={page === 'shader-packs'} running={instances.some(instance => instance.profileId === managedProfile.id)} onNotice={notifyCape} /></Suspense></div>}
        {visited.has('account') && <div className="retained-page" hidden={page !== 'account'}><div className="content-page account-page">
          <div className="page-heading"><div><h2>{t('Profilim')}</h2><p>{account?.kind === 'offline' ? t('Çevrimdışı oyuncu bilgilerini burada görebilirsin.') : t('Minecraft hesabını ve karakter görünümünü burada görebilirsin.')}</p></div><button className="heading-action primary" onClick={() => setAccountOpen(true)}><UsersRound size={17} /> {t('Hesapları yönet')}</button></div>
          {account ? <SkinPreview key={account.id} account={account} t={t} onNotify={notifyCape} active={page === 'account'} onViewChange={setAccountView} /> : <div className="account-page-empty"><div className="account-page-empty-icon"><UserRound size={34} /></div><h3>{t('Hesap ekle')}</h3><p>{t('Microsoft hesabını bağla veya bir çevrimdışı oyuncu adı seç.')}</p><button className="modal-primary" onClick={() => setAccountOpen(true)}><UsersRound size={18} /> {t('Hesapları yönet')}</button><button className="account-page-offline-add" onClick={() => { setOfflineCreateOpen(true) }}><WifiOff size={17} /> {t('Çevrimdışı hesap ekle')}</button></div>}
        </div></div>}
        {page === 'home' && <><div className="home-hero">
          {heroSlides.map((slide, index) => <div key={slide.label} className={`hero-image ${index === heroIndex ? 'active' : ''}`} style={{ backgroundImage: `url("${slide.image}")` }} />)}
          <div className="hero-shade" />
          <div className="hero-content"><h1>{t(heroSlides[heroIndex].titleA)}<br /><em>{t(heroSlides[heroIndex].titleB)}</em></h1><p>{t(heroSlides[heroIndex].description)}</p><div className="hero-actions"><RunningPlayButton instances={instances} disabled={!profile || launchBusy} preparing={launchBusy} onPlay={() => profile && playProfile(profile.id)} t={t} /><button className="ghost-button" onClick={() => setPage('versions')}>{t('Sürümlere göz at')} <ChevronRight size={17} /></button></div></div>
          <div className={`hero-switcher ${heroMenuOpen ? 'open' : ''}`} onMouseEnter={() => setHeroMenuOpen(true)} onMouseLeave={() => setHeroMenuOpen(false)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHeroMenuOpen(false) }}><button className="hero-current" aria-expanded={heroMenuOpen} aria-haspopup="menu" onClick={() => setHeroMenuOpen(open => !open)}><span>{heroSlides[heroIndex].label}</span><ChevronUp size={14} /></button><div className="hero-switch-menu">{heroSlides.map((slide, index) => <button key={slide.label} className={index === heroIndex ? 'active' : ''} onClick={() => { setHeroIndex(index); setHeroMenuOpen(false) }}><span>{String(index + 1).padStart(2, '0')}</span>{slide.short}</button>)}<div className="hero-menu-divider" /><button className="hero-motion-toggle" onClick={toggleHeroAnimation}>{state.settings.animateHero ? <Pause size={14} /> : <Play size={14} />} {state.settings.animateHero ? t('Geçişleri durdur') : t('Geçişleri başlat')}</button></div></div>
          {state.settings.animateHero && <div className="hero-progress" key={heroIndex}><div className="hero-progress-fill" onAnimationEnd={() => setHeroIndex(current => (current + 1) % heroSlides.length)} /></div>}
        </div>
          {!online && <div className="offline-banner"><WifiOff size={19} /><div><strong>{t('Çevrimdışı görünüm')}</strong><span>{offlineStatus.accountReady && offlineStatus.versionReady ? t('Bu hesap ve kurulu sürümle oynayabilirsin.') : t('Çevrimdışı hesap veya doğrulanmış Microsoft oturumu ve kurulu sürüm gerekir.')}</span></div></div>}
          <div className="home-bottom">
            <section className="launch-panel">
              <div className="launch-panel-head"><div><h2>{t('Oyun profili')}</h2><p>{t('Macerana hangi profille devam edeceksin?')}</p></div>{profile && <button type="button" className="launch-profile-edit" aria-label={t('Profili yönet')} title={t('Profili yönet')} onClick={() => openProfileWorkspace(profile.id)}><Settings2 size={17} /></button>}</div>
              <div className="launch-controls">
                <div className="launch-field"><label>{t('Profil')}</label><Dropdown className="home-profile-select" searchable searchPlaceholder={t('Profil ara')} language={language} value={profile?.id ?? ''} placeholder={t('Profil seç')} options={state.profiles.map(item => ({ value: item.id, label: item.name, detail: `${memoryGb(item.memoryMb)} GB RAM · ${item.width} × ${item.height} · ${profileVersionLabel(item)}` }))} onChange={id => run(async () => setState(await window.launcher.selectProfile(id)))} /></div>
              </div>
            </section>
            <section className="latest-panel">
              <div className="latest-copy"><div className="latest-info"><span>{t('Son sürüm')}</span><h2>Minecraft {latest?.id ?? '—'}</h2><p>{latest ? t('{date} tarihinde yayınlandı', { date: date(latest.releaseTime, language) }) : t('Sürüm bilgileri yükleniyor')}</p></div>
                <p className="latest-description">{t('Neler değişti? Yenilikleri resmî sürüm notlarında keşfet.')}</p>
                <button className="release-notes" disabled={!latest} onClick={() => latest && run(() => window.launcher.openExternal(`https://www.minecraft.net/en-us/article/minecraft-java-edition-${latest.id.replace(/\./g, '-')}`))}>{t('Sürüm notlarını oku')} <ExternalLink size={16} /></button>
              </div><div className="latest-art"><VersionGlyph /></div>
            </section>
          </div>
        </>}
        {page === 'versions' && <div className="content-page">
          <div className="page-heading"><div><h2>{t('Sürümler')}</h2><p>{t('Minecraft sürümlerini indir veya profil oluşturmadan başlat.')}</p></div><div className="servers-heading-actions"><button className="heading-action" disabled={busy} onClick={() => run(async () => { const result = await window.launcher.importCustomClient(); if (result) { setVersions(result.versions); setBrowsedVersionId(result.id); setScope('custom'); setFilter('all'); setQuery(''); setCount(30); setToast(t('{name} içe aktarıldı.', { name: result.id })) } })}><ArrowDownToLine size={17} /> {t('İstemci içe aktar')}</button><button className="heading-action primary" onClick={() => run(async () => { setLoadingVersions(true); try { setVersions(await window.launcher.getVersions(true)); setCatalogError('') } finally { setLoadingVersions(false) } }, t('Sürüm listesi güncellendi.'))}><CloudDownload size={17} /> {t('Listeyi yenile')}</button></div></div>
          <div className="version-toolbar"><div className="filter-tabs">{(['release', 'snapshot', 'old_beta', 'old_alpha', 'all'] as Filter[]).map(item => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => { setFilter(item); setCount(30) }}>{item === 'all' ? t('Tümü') : localVersionLabels[item]}</button>)}</div><div className="version-search-tools"><div className="search-box"><Search size={17} /><input value={query} onChange={event => { setQuery(event.target.value); setCount(30) }} placeholder={t('Sürüm ara') + '...'} /></div>
            <div className="version-filter" ref={filterRef}><button className={`version-filter-trigger ${scope !== 'all' ? 'active' : ''}`} aria-haspopup="menu" aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><SlidersHorizontal size={17} /> {t('Filtrele')} {scope !== 'all' && <span className="filter-count">1</span>}<ChevronDown size={15} /></button>
              {filterOpen && <div className="version-filter-menu" role="menu"><div className="version-filter-title">{t('GÖSTER')}</div>{([
                { value: 'all', title: t('Tüm sürümler'), detail: '', icon: <VersionGlyph /> },
                { value: 'installed', title: t('Yüklü'), detail: t('Bilgisayarında bulunan sürümler'), icon: <Check size={18} /> },
                { value: 'optifine', title: 'OptiFine', detail: t('Kurulu OptiFine sürümleri'), icon: <OptifineGlyph /> },
                { value: 'custom', title: t('Özel istemci'), detail: t('İçe aktarılan istemci sürümleri'), icon: <VersionGlyph custom /> }
              ] as const).map(option => <button key={option.value} role="menuitemradio" aria-checked={scope === option.value} onClick={() => { setScope(option.value); setCount(30); setFilterOpen(false) }}><span className="version-filter-icon">{option.icon}</span><span className="version-filter-copy"><strong>{option.title}</strong>{option.detail && <small>{option.detail}</small>}</span></button>)}</div>}
            </div>
          </div></div>
          <div className="version-list"><div className="list-head"><span>{t('Sürüm')}</span><span>{t('Yayın tarihi')}</span><span>{t('Durum')}</span><span /></div>
            {loadingVersions ? <div className="empty-state"><LoaderCircle className="spin" size={26} /> {t('Sürümler yükleniyor...')}</div> : catalogError ? <div className="empty-state">{catalogError}</div> : visibleVersions.length === 0 ? <div className="empty-state">{t('Bu filtrede sürüm bulunamadı.')}</div> : visibleVersions.map(({ item, variantId }) => {
              const selectedVariant = item.optifineVersions.find(variant => variant.id === browsedVersionId)?.id
              const pendingOptifine = browsedVersionId === `${item.id}-OptiFine_auto`
              const id = variantId ?? item.id
              const actionId = variantId ?? selectedVariant ?? (pendingOptifine ? `${item.id}-OptiFine_auto` : item.id)
              const installed = !pendingOptifine && (!!variantId || !!selectedVariant || item.installed)
              const selected = variantId ? browsedVersionId === variantId : item.id === browsedVersionId || !!selectedVariant || pendingOptifine
              return <div className={`version-row ${selected ? 'selected' : ''}`} key={id} role="button" tabIndex={0} aria-label={`${id} sürümünü seç`} onClick={() => chooseVersion(id)} onContextMenu={event => openVersionContextMenu(event, actionId, installed)} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseVersion(id) } }}>
                <div className="version-main">{variantId ? <span className="version-glyph optifine-list-glyph"><OptifineGlyph /></span> : item.custom ? <span className="version-glyph"><VersionGlyph custom /></span> : <VersionVariantMenu language={language} version={item} selectedId={browsedVersionId} onSelect={chooseVersion} />}<div><strong>{id}</strong><span>{variantId || selectedVariant || pendingOptifine ? 'OptiFine' : item.custom ? t('Özel istemci') : localVersionLabels[item.type]}</span></div></div>
                <div className="row-date"><span>{date(item.releaseTime, language)}</span>{!item.custom && <button className="release-link" title={t('Minecraft resmî sitesinde aç')} aria-label={`${id}: ${t('Minecraft resmî sitesinde aç')}`} onClick={event => { event.stopPropagation(); run(() => window.launcher.openExternal(releaseNotesUrl(item))) }}><ExternalLink size={15} /></button>}</div>
                <div className="row-status">{installed ? <span className="installed-tag"><Check size={13} /> {t('Yüklü')}</span> : <span className="not-installed">{t('İndirilebilir')}</span>}</div>
                <div className="row-actions">{pendingOptifine
                  ? <button title={t('Başlat')} aria-label={`${actionId}: ${t('Başlat')}`} disabled={launchBusy} onClick={event => { event.stopPropagation(); playVersion(actionId) }}><Play size={17} /></button>
                  : installed
                  ? <><button title={t('Profilsiz başlat')} aria-label={`${actionId}: ${t('Profilsiz başlat')}`} disabled={launchBusy} onClick={event => { event.stopPropagation(); playVersion(actionId) }}><Play size={17} /></button><button title={t('Sürümü kaldır')} aria-label={`${actionId}: ${t('Sürümü kaldır')}`} disabled={busy} onClick={event => { event.stopPropagation(); setPendingVersionDelete(actionId) }}><Trash2 size={17} /></button></>
                  : <button title={t('Sürümü indir')} aria-label={`${item.id}: ${t('Sürümü indir')}`} disabled={launchBusy} onClick={event => { event.stopPropagation(); run(async () => { await window.launcher.install(item.id); setVersions(await window.launcher.getVersions()) }, t('{version} yüklendi.', { version: item.id })) }}><ArrowDownToLine size={17} /></button>}</div>
              </div>
            })}
          </div>
          {count < totalVisible && <button className="load-more" onClick={() => setCount(count + 30)}>{t('Daha fazla göster')} <ChevronDown size={16} /></button>}
        </div>}
        {page === 'profiles' && <div className="content-page profile-import-zone" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setProfileDrop(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setProfileDrop(false) }} onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); const paths = [...event.dataTransfer.files].map(file => window.launcher.getDroppedFilePath(file)); void importProfileFiles(paths) }}><div className="page-heading"><div><h2>{t('Profillerim')}</h2><p>{t('Farklı dünyalar ve ayarlar için dilediğinde yeni profil oluştur.')}</p></div><div className="profile-page-heading-actions"><button className="heading-action profile-import-button" onClick={() => void importProfileFiles()} disabled={importingProfiles > 0}>{importingProfiles ? <LoaderCircle size={17} className="spin" /> : <ArrowDownToLine size={17} />}{t('İçe aktar')}</button><button className="heading-action primary" onClick={createDraft}><Plus size={18} /> {t('Yeni profil')}</button></div></div>{profileDrop && <ProfileDropHint language={language} />}
          <TotalPlaytime state={state} language={language} />
          <DndContext sensors={profileSensors} collisionDetection={args => {
            const pageHits = pointerWithin(args).filter(hit => String(hit.id).startsWith('profile-page-'))
            return pageHits.length ? pageHits : closestCenter(args)
          }} onDragStart={event => { skipProfileClick.current = true; setDraggedProfileId(String(event.active.id)) }} onDragCancel={() => { setDraggedProfileId(null); window.setTimeout(() => { skipProfileClick.current = false }, 100) }} onDragEnd={event => { handleProfileDragEnd(event); window.setTimeout(() => { skipProfileClick.current = false }, 100) }}>
            {visibleProfiles.length ? <SortableContext items={visibleProfiles.map(item => item.id)} strategy={rectSortingStrategy}><div className={`profile-grid ${focusedProfileId ? 'focus-mode' : ''}`}>{visibleProfiles.map(item => <SortableProfileCard key={item.id} item={item} focused={focusedProfileId === item.id} sortable={state.profiles.length > 1 && !item.pinned} language={language} busy={launchBusy} instances={instances} onManage={() => { if (!skipProfileClick.current) openProfileWorkspace(item.id) }} onPlay={() => playProfile(item.id)} onMenu={event => openProfileMenu(event, item.id)} onPin={() => togglePin(item.id)} />)}</div></SortableContext> : <ProfileEmptyState language={language} onCreate={createDraft} />}
            {profilePages > 1 && <div className="profile-pagination"><button disabled={profilePage === 0} onClick={() => setProfilePage(profilePage - 1)}><ChevronRight className="rotate-180" size={16} /> {t('Önceki')}</button><div>{Array.from({ length: profilePages }, (_, index) => <ProfilePageButton key={index} index={index} active={profilePage === index} language={language} onClick={() => setProfilePage(index)} />)}</div><button disabled={profilePage === profilePages - 1} onClick={() => setProfilePage(profilePage + 1)}>{t('Sonraki')} <ChevronRight size={16} /></button></div>}
            <DragOverlay dropAnimation={{ duration: 330, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>{draggedProfileId && state.profiles.find(item => item.id === draggedProfileId) && <div className="profile-card profile-card-overlay"><ProfileCardContent item={state.profiles.find(item => item.id === draggedProfileId)!} language={language} busy={launchBusy} instances={instances} onPlay={() => {}} onMenu={() => {}} onPin={() => {}} /></div>}</DragOverlay>
          </DndContext>
          {!!state.profiles.length && <div className="profile-footnote"><ShieldCheck size={17} /> {t('Her profil tek bir Minecraft sürümüyle çalışır. Profilleri sürükleyerek sıralamalarını değiştirebilirsiniz.')}</div>}
        </div>}
        {page === 'gallery' && <div className="content-page library-page">
          <div className="page-heading"><div><h2>{t('Ekran görüntüleri')}</h2><p>{t('Minecraft ekran görüntülerin, profillerine göre bir arada.')}</p></div><button className="heading-action primary" disabled={screenshotsLoading} onClick={refreshScreenshots}>{screenshotsLoading ? <LoaderCircle size={17} className="spin" /> : <CloudDownload size={17} />} {t('Yenile')}</button></div>
          <div className="library-toolbar">{!inProfileWorkspace && <Dropdown className="gallery-profile-select" searchable searchPlaceholder={t('Profil ara')} language={language} value={screenshotProfile} placeholder={t('Tüm profiller')} options={[{ value: 'all', label: t('Tüm profiller') }, ...state.profiles.map(item => ({ value: item.id, label: item.name })), { value: 'standard', label: '.minecraft' }]} onChange={setScreenshotProfile} />}<span className="gallery-count">{screenshots.length} {t('görüntü')}</span><Dropdown className="gallery-sort-select" language={language} value={screenshotSort} placeholder={t('Sırala')} options={[{ value: 'newest', label: t('En yeniden eskiye') }, { value: 'oldest', label: t('En eskiden yeniye') }]} onChange={value => setScreenshotSort(value as ScreenshotSort)} /></div>
          {screenshots.length ? <><div className="screenshot-grid">{screenshots.map(item => <div key={item.id} className="screenshot-card" onContextMenu={event => { event.preventDefault(); openScreenshotContextMenu(item, event.clientX, event.clientY) }}><button className="screenshot-open" onClick={() => openScreenshot(item)}><ScreenshotThumbnail item={item} /><strong>{item.name}</strong></button><div className="screenshot-card-footer"><small>{item.profileId ? state.profiles.find(profile => profile.id === item.profileId)?.name : '.minecraft'} · {date(item.modifiedAt, language)}</small><button className="screenshot-more" aria-label={t('Görüntü seçenekleri')} aria-expanded={screenshotContextMenu?.item.id === item.id} title={t('Görüntü seçenekleri')} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); toggleScreenshotContextMenu(item, rect.right - 210, rect.bottom + 6) }}><MoreHorizontal size={19} /></button></div></div>)}</div>{screenshotsHasMore && <button className="load-more" disabled={screenshotsLoading} onClick={loadMoreScreenshots}>{screenshotsLoading ? <LoaderCircle className="spin" size={16} /> : t('Daha fazla göster')} <ChevronDown size={16} /></button>}</> : <div className="library-empty">{screenshotsLoading ? <><LoaderCircle className="spin" size={28} /><strong>{t('Ekran görüntüleri yükleniyor...')}</strong></> : <><ImageIcon size={32} /><strong>{t('Henüz ekran görüntüsü yok.')}</strong><span>{t('Oyunda F2 ile çektiğin görüntüler burada görünür.')}</span></>}</div>}
        </div>}
        {page === 'downloads' && <DownloadsPage updates={updates} state={state} language={language} onState={updated => { setState(updated); setSettingsDraft(current => current ? { ...current, downloadSpeedLimitKiB: updated.settings.downloadSpeedLimitKiB, pauseDownloadsWhilePlaying: updated.settings.pauseDownloadsWhilePlaying, downloadConcurrency: updated.settings.downloadConcurrency } : current) }} onNotice={setToast} />}
        {visited.has('settings') && <div className="retained-page" hidden={page !== 'settings'}><div className="content-page settings-page">
          <div className="page-heading"><div><h2>{t('Ayarlar')}</h2><p>{t('Oyun ve launcher tercihlerini düzenle.')}</p></div></div>
          <div className="settings-tabs" role="tablist" aria-label={t('Ayarlar')}>
            <button role="tab" aria-selected={settingsTab === 'launcher'} className={settingsTab === 'launcher' ? 'active' : ''} onClick={() => setSettingsTab('launcher')}><img className="launcher-tab-icon" src={logo} alt="" /> Launcher</button>
            <button role="tab" aria-selected={settingsTab === 'java'} className={settingsTab === 'java' ? 'active' : ''} onClick={() => setSettingsTab('java')}><img className="java-icon" src={javaIcon} alt="" /> Java</button>
            <button role="tab" aria-selected={settingsTab === 'storage'} className={settingsTab === 'storage' ? 'active' : ''} onClick={() => setSettingsTab('storage')}><HardDrive size={19} /> {t('Depolama')}</button>
            <button role="tab" aria-selected={settingsTab === 'logs'} className={settingsTab === 'logs' ? 'active' : ''} onClick={() => { setSettingsTab('logs'); window.launcher.getErrorLog().then(setErrorLogs).catch(() => {}) }}><FileText size={19} /> {t('Günlükler')}</button>
            <button role="tab" aria-selected={settingsTab === 'about'} className={settingsTab === 'about' ? 'active' : ''} onClick={() => setSettingsTab('about')}><Info size={19} /> {t('Hakkında')}</button>
          </div>
        {settingsTab === 'storage' && <div className="settings-panel settings-tab-panel storage-settings-panel" role="tabpanel">
          <div className="settings-panel-head"><div className="setting-icon"><HardDrive size={28} /></div><div><h3>{t('Depolama')}</h3><p>{t('Profillerin ve paylaşılan oyun dosyalarının kapladığı alan.')}</p></div><button className="heading-action primary" onClick={() => run(async () => { const [usage, preview] = await Promise.all([window.launcher.getDiskUsage(), window.launcher.getCleanupPreview()]); setDiskUsage(usage); setCleanupPreview(preview) }, t('Depolama taraması tamamlandı.'))}><HardDrive size={17} /> {t('Yeniden tara')}</button></div>
          {diskUsage ? <><div className="storage-summary"><strong>{formatBytes(diskUsage.totalBytes)}</strong><span>{t('Toplam kullanılan alan')}</span></div><div className="storage-list">{diskUsage.profiles.map(item => <button key={item.id} className="storage-profile" onClick={() => { const index = state.profiles.findIndex(profileItem => profileItem.id === item.id); if (index < 0) return; setFocusedProfileId(item.id); setProfilePage(Math.floor(index / 9)); setPage('profiles') }}><span className="version-glyph"><VersionGlyph /></span><strong>{item.name}</strong><span>{formatBytes(item.bytes)}</span><ChevronRight size={17} /></button>)}<button className="storage-shared" onClick={() => run(() => window.launcher.openSharedFolder())} title={t('Klasörde aç')}><img src={logo} alt="" /><strong>{t('Paylaşılan oyun dosyaları')}</strong><span>{formatBytes(diskUsage.sharedBytes)}</span><FolderOpen size={17} /></button></div></> : <div className="library-empty"><LoaderCircle className="spin" size={28} /> {t('Disk taranıyor...')}</div>}
          <section className="cleanup-section"><div><h3>{t('Tek tıkla temizle')}</h3><p>{t('14 günden eski günlükler, çökme raporları ve hiçbir profilde kullanılmayan launcher sürümleri Geri Dönüşüm Kutusu’na taşınır.')}</p>{cleanupPreview && <small>{t('{logs} günlük · {crashes} çökme raporu · {versions} sürüm · {size}', { logs: cleanupPreview.logs, crashes: cleanupPreview.crashReports, versions: cleanupPreview.versions, size: formatBytes(cleanupPreview.bytes) })}</small>}</div><button disabled={!cleanupPreview?.items.length || cleaning || busy} onClick={() => setConfirmCleanup(true)}><FileText size={17} /> {t('Temizlenecekleri gör')}</button></section>
        </div>}
          {settingsTab === 'java' && <JavaSettings settings={settingsDraft} language={language} tab={javaTab} onTab={setJavaTab} runtimes={javaRuntimes} loading={javaLoading} busy={busy} deletingPath={deletingJavaPath} onChange={updateSettings} onBrowse={() => run(async () => { const path = await window.launcher.chooseJava(); if (path) updateSettings({ javaPath: path }) })} onRescan={() => run(async () => { setJavaLoading(true); try { setJavaRuntimes(await window.launcher.getJavaRuntimes()) } finally { setJavaLoading(false) } }, t('Java taraması tamamlandı.'))} onOpen={path => run(() => window.launcher.openJavaLocation(path))} onDelete={setPendingJavaDelete} />}
          {settingsTab === 'launcher' && <><div className="settings-panel settings-tab-panel" role="tabpanel">
            <div className="settings-panel-head"><div className="setting-icon"><img className="launcher-panel-icon" src={logo} alt="" /></div><div><h3>{t('Launcher tercihleri')}</h3><p>{t('Sürüm listesi ve pencere davranışı')}</p></div></div>
            <div className="language-setting"><div><strong>{t('Arayüz dili')}</strong><p>{t('Menülerde ve sayfalarda kullanılacak dili seç.')}</p></div><LanguageMenu value={language} language={language} onChange={value => updateSettings({ language: value })} /></div>
            <button className="setting-toggle" onClick={() => updateSettings({ showSnapshots: !settingsDraft.showSnapshots })}><span><strong>{t('Snapshot sürümleri')}</strong><small>{t('Erken sürümleri hızlı seçimde göster')}</small></span><span className={`switch ${settingsDraft.showSnapshots ? 'on' : ''}`} /></button>
            <button className="setting-toggle" onClick={() => updateSettings({ closeOnLaunch: !settingsDraft.closeOnLaunch })}><span><strong>{t('Oyun açılınca küçült')}</strong><small>{t("Launcher'ı görev çubuğuna al")}</small></span><span className={`switch ${settingsDraft.closeOnLaunch ? 'on' : ''}`} /></button>
            <button className="setting-toggle" onClick={() => updateSettings({ animateHero: !settingsDraft.animateHero })}><span><strong>{t('Ana ekran geçişleri')}</strong><small>{t('Overworld, Nether ve End arasında otomatik geçiş yap')}</small></span><span className={`switch ${settingsDraft.animateHero ? 'on' : ''}`} /></button>
            <button className="setting-toggle" onClick={() => updateSettings({ discordPresence: !settingsDraft.discordPresence })}><span><strong>{t('Discord etkinliği')}</strong><small>{t('Launcher etkinliğini ve oynadığın Minecraft sürümünü Discord profilinde göster')}</small></span><span className={`switch ${settingsDraft.discordPresence ? 'on' : ''}`} /></button>
            <button className="setting-toggle" onClick={() => updateSettings({ minimizeToTray: !settingsDraft.minimizeToTray })}><span><strong>{t('Kapatınca sistem tepsisine küçült')}</strong><small>{t('Pencereyi kapattığında launcher arka planda açık kalsın')}</small></span><span className={`switch ${settingsDraft.minimizeToTray ? 'on' : ''}`} /></button>
            <section className="playtime-settings" aria-labelledby="playtime-settings-title">
              <h4 id="playtime-settings-title">{t('Oyun süresi ayarları')}</h4>
              <button type="button" role="checkbox" aria-checked={settingsDraft.showPlaytime !== false} className="setting-toggle" onClick={() => updateSettings({ showPlaytime: settingsDraft.showPlaytime === false })}><span><strong>{t('Profillerde oynanan süreyi göster')}</strong><small>{t('Seçili profilin son oturumunu ve toplam oyun süresini alt çubukta göster.')}</small></span><span aria-hidden="true" className={`switch ${settingsDraft.showPlaytime !== false ? 'on' : ''}`} /></button>
              <button type="button" role="checkbox" aria-checked={settingsDraft.savePlaytime !== false} className="setting-toggle" onClick={() => updateSettings({ savePlaytime: settingsDraft.savePlaytime === false })}><span><strong>{t('Profillerde oynanan süreyi kaydet')}</strong><small>{t('Kapalıyken süreler yalnızca launcher açıkken tutulur; kayıtlar diskte saklanmaz.')}</small></span><span aria-hidden="true" className={`switch ${settingsDraft.savePlaytime !== false ? 'on' : ''}`} /></button>
              <button type="button" role="checkbox" aria-checked={settingsDraft.showTotalPlaytime !== false} className="setting-toggle" onClick={() => updateSettings({ showTotalPlaytime: settingsDraft.showTotalPlaytime === false })}><span><strong>{t('Profiller arasında oynanan toplam süreyi göster')}</strong><small>{t('Seçili hesabın tüm profillerindeki toplam oyun süresini Profillerim sayfasında göster.')}</small></span><span aria-hidden="true" className={`switch ${settingsDraft.showTotalPlaytime !== false ? 'on' : ''}`} /></button>
            </section>
            <div className="launcher-files"><button className="folder-link" onClick={() => window.launcher.openFolder()}><FolderOpen size={17} /> {t('Launcher dosyalarını aç')} <ArrowRight size={16} /></button><small className="data-path">{state.dataPath}</small></div>
          </div></>}
          {<div hidden={settingsTab !== 'logs'}><ErrorLogPanel entries={errorLogs} language={language} onOpenFile={() => run(() => window.launcher.openErrorLog())} onClear={() => run(async () => { setErrorLogs(await window.launcher.clearErrorLog()) }, t('Hata günlükleri temizlendi.'))} /></div>}
          {settingsTab === 'about' && <><AboutPanel version={packageJson.version} language={language} onOpen={url => run(() => window.launcher.openExternal(url))} /><div className="launcher-update-settings"><UpdatePanel controls={updates} language={language} onNotes={() => setChangelogOpen(true)} onDownloads={() => setPage('downloads')} /></div></>}
        </div></div>}
      </main>
    </div>
    <div className="statusbar">{!downloadStatus && !instances.length && updates.update.phase !== 'downloading' && activity.kind === 'idle' && profilePlaytime(footerProfile, state.settings, 'showPlaytime') && state.playSessions?.some(session => session.profileId === footerProfile?.id && session.durationMs > 0) ? <PlaytimeStatus state={inProfileWorkspace ? { ...state, selectedProfileId: managedProfileId } : state} language={language} /> : <span className="statusbar-download" title={downloadStatus || undefined}>{downloadStatus || (updates.update.phase === 'downloading' ? `${t('Güncelleme indiriliyor...')} ${Math.floor(updates.update.percent ?? 0)}%` : activity.kind === 'idle' ? t(instances.length ? 'Oyun çalışıyor' : 'Başlatmaya hazır') : t(activity.label))}</span>}<div className="statusbar-end">{footerProfile && <button type="button" className="statusbar-profile" title={`Minecraft ${selectedVersionLabel} · ${footerProfile.name}`} aria-label={t('Profillerim')} onClick={() => setPage('profiles')}>Minecraft {selectedVersionLabel} · {footerProfile.name}</button>}<div className="statusbar-release"><UpdateIndicator controls={updates} language={language} onOpen={() => setPage('downloads')} /><button className="statusbar-changelog" aria-expanded={changelogOpen} aria-label={t('Değişiklik günlüğü')} aria-haspopup="dialog" onClick={()=>setChangelogOpen(true)}><FileText size={13}/>v{packageJson.version}<ChevronUp size={13}/></button></div></div></div>
    {changelogOpen && <Suspense fallback={null}><Changelog language={language} update={updates.update} onCheck={() => updates.action('check')} onUpdate={() => { setChangelogOpen(false); setPage('downloads'); void updates.action('download').catch(() => {}) }} onClose={()=>setChangelogOpen(false)}/></Suspense>}
    {profileMenu && page === 'profiles' && state.profiles.some(item => item.id === profileMenu.id) && <ProfileMenu profile={state.profiles.find(item => item.id === profileMenu.id)!} x={profileMenu.x} y={profileMenu.y} language={language} pending={profileTasks.includes(profileMenu.id) || instances.some(item => item.profileId === profileMenu.id)} onClose={() => setProfileMenu(null)} onAction={action => void profileAction(profileMenu.id, action)} />}
    {coverProfileId && state.profiles.some(item => item.id === coverProfileId) && <ProfileCoverEditor profile={state.profiles.find(item => item.id === coverProfileId)!} language={language} onClose={() => setCoverProfileId(null)} onNotice={notifyCape} onSaved={async cover => { setState(await window.launcher.saveProfileCover(coverProfileId, cover)); notifyCape(t('Profil kapağı güncellendi.')) }} />}
    {versionContextMenu && page === 'versions' && <div ref={versionContextMenuRef} className="version-context-menu" role="menu" style={{ left: versionContextMenu.x, top: versionContextMenu.y }}><div className="version-context-label">Minecraft {versionContextMenu.id}</div><div className="version-context-divider" /><button role="menuitem" disabled={launchBusy} onClick={() => { const id = versionContextMenu.id; setVersionContextMenu(null); playVersion(id) }}><Play size={16} fill="currentColor" /> {t('Başlat')}</button><button role="menuitem" onClick={() => { const id = versionContextMenu.id; setVersionContextMenu(null); run(() => window.launcher.createVersionShortcut(id), t('{version} için masaüstü kısayolu oluşturuldu.', { version: id })) }}><Monitor size={16} /> {t('Masaüstüne kısayol oluştur')}</button><button role="menuitem" disabled={!versionContextMenu.installed} title={versionContextMenu.installed ? t('Sürüm klasörünü aç') : t('Sürüm henüz yüklü değil')} onClick={() => { const id = versionContextMenu.id; setVersionContextMenu(null); run(() => window.launcher.openVersionLocation(id)) }}><FolderOpen size={16} /> {t('Dosya konumunda aç')}</button></div>}
    {screenshotContextMenu && page === 'gallery' && <div ref={screenshotContextMenuRef} className="version-context-menu screenshot-context-menu" role="menu" style={{ left: screenshotContextMenu.x, top: screenshotContextMenu.y }}><div className="version-context-label" title={screenshotContextMenu.item.name}>{screenshotContextMenu.item.name}</div><div className="version-context-divider" /><button role="menuitem" onClick={() => { const item = screenshotContextMenu.item; setScreenshotContextMenu(null); run(() => window.launcher.copyScreenshot(item.id), t('Ekran görüntüsü kopyalandı.')) }}><Copy size={16} /> {t('Görüntüyü kopyala')}</button><button role="menuitem" onClick={() => { const item = screenshotContextMenu.item; setScreenshotContextMenu(null); run(() => window.launcher.openScreenshotLocation(item.id)) }}><FolderOpen size={16} /> {t('Dosya konumunda aç')}</button><div className="version-context-divider" /><button role="menuitem" className="context-danger" onClick={() => { setPendingScreenshotDelete(screenshotContextMenu.item); setScreenshotContextMenu(null) }}><Trash2 size={16} /> {t('Sil')}</button></div>}
    {page === 'settings' && dirty && <div className="save-bar"><span>{t('Kaydedilmemiş değişikliklerin var.')}</span><button onClick={() => setSettingsDraft(state.settings)}>{t('Sıfırla')}</button><button className="save-confirm" disabled={savingSettings} onClick={saveSettings}>{savingSettings ? t('Kaydediliyor...') : t('Değişiklikleri kaydet')}</button></div>}
    {activity.kind === 'launching' && <div className="activity-screen"><div className="activity-card"><img src={logo} /><h2>{t(activity.label)}</h2><p>{activity.detail || t('Oyun hazırlanıyor')}</p><div className="activity-track"><div style={{ width: `${Math.max(10, activity.progress || 10)}%` }} /></div><small>{t('Dosyalar hazırlanırken launcher açık kalmalı.')}</small></div></div>}
    {toast && <div key={`${toastRevision}:${toast}`} className={`toast ${toastLeaving ? 'leaving' : ''}`} role="status" aria-live="polite"><span>{toast}</span><button aria-label={t('Kapat')} onClick={dismissToast}><X size={16} /></button></div>}
    {accountOpen && <AccountManager state={state} t={t} onState={setState} onNotice={setToast} onClose={() => setAccountOpen(false)} onOffline={() => { setAccountOpen(false); setOfflineCreateOpen(true) }} />}
    {offlineCreateOpen && <OfflineAccountDialog state={state} t={t} onState={setState} onNotice={setToast} onClose={() => setOfflineCreateOpen(false)} />}
    {launchRequest && <LaunchConfirmation instances={instances} t={t} onConfirm={() => void launchTarget(launchRequest, true)} onCancel={() => setLaunchRequest(null)} pending={launchPending} />}
    {profileDraft && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProfileDraft(null) }}><div className="modal profile-modal">
      <DialogHeading title={profileDraft.id ? t('Profili düzenle') : t('Yeni profil')} description={t('Her profil tek bir Minecraft sürümüyle çalışır. Dünyaları, modları ve ayarları ayrı tutulur.')} closeLabel={t('Kapat')} onClose={() => setProfileDraft(null)} />
      <div className="form-grid">
        <label className="full">{t('Profil adı')}<input value={profileDraft.name} maxLength={48} onChange={event => setProfileDraft({ ...profileDraft, name: event.target.value })} placeholder={t('Örn. Survival')} /></label>
        <div className="full profile-version-field"><label>{t('Minecraft sürümü')}</label><Dropdown className="profile-version-select" language={language} value={profileLaunchVersion(profileDraft as LauncherProfile)} searchable placeholder={t('Sürüm seç')} disabled={!!profileDraft.modpack} title={profileDraft.modpack ? t('Bu profil yalnızca bu sürümde çalıştırılabilir. Başka bir sürüm için profilini değiştir.') : undefined} options={versionOptions.some(item => item.value === profileLaunchVersion(profileDraft as LauncherProfile)) ? versionOptions : [{value:profileLaunchVersion(profileDraft as LauncherProfile),label:profileVersionLabel(profileDraft as LauncherProfile)},...versionOptions]} onChange={id => setProfileDraft({...profileDraft,versionId:id,modLoader:undefined,modLoaderVersion:undefined})} /></div>
        <label>{t('Minimum bellek (MB) (-Xms)')}<input type="number" min={512} max={32768} step={512} value={profileDraft.minMemoryMb ?? 1024} onChange={event => setProfileDraft({ ...profileDraft, minMemoryMb: Number(event.target.value) })} /></label>
        <label>{t('Maksimum bellek (MB) (-Xmx)')}<input type="number" min={1024} max={32768} step={512} value={profileDraft.memoryMb} onChange={event => setProfileDraft({ ...profileDraft, memoryMb: Number(event.target.value) })} /></label>
        <label>{t('Genişlik')}<input type="number" min={640} value={profileDraft.width} onChange={event => setProfileDraft({ ...profileDraft, width: Number(event.target.value) })} /></label>
        <label>{t('Yükseklik')}<input type="number" min={480} value={profileDraft.height} onChange={event => setProfileDraft({ ...profileDraft, height: Number(event.target.value) })} /></label>
        <label className="full">{t('Java yolu')}<div className="input-with-button"><input value={profileDraft.javaPath} onChange={event => setProfileDraft({ ...profileDraft, javaPath: event.target.value })} placeholder={t('Otomatik algıla')} /><button title={t('Java seç')} onClick={() => run(async () => { const path = await window.launcher.chooseJava(); if (path) setProfileDraft(current => current ? { ...current, javaPath: path } : current) })}><FolderOpen size={17} /></button></div></label>
        <label className="full">{t('JVM argümanları')}<input value={profileDraft.jvmArgs ?? ''} onChange={event => setProfileDraft({ ...profileDraft, jvmArgs: event.target.value })} placeholder="-XX:+UseG1GC" /></label>
        <label className="full">{t('Oyun klasörü')}<div className="input-with-button"><input value={profileDraft.gameDirectory ?? ''} onChange={event => setProfileDraft({ ...profileDraft, gameDirectory: event.target.value })} placeholder={t('Profilin varsayılan klasörü')} /><button title={t('Klasör seç')} onClick={() => run(async () => { const path = await window.launcher.chooseGameDirectory(); if (path) setProfileDraft(current => current ? { ...current, gameDirectory: path } : current) })}><FolderOpen size={17} /></button></div></label>
        {serverLaunchMode(profileDraft.versionId) && <label className="full profile-server-field">{t('Başlangıç sunucusu')}<input value={profileDraft.serverAddress ?? ''} maxLength={260} onChange={event => setProfileDraft({ ...profileDraft, serverAddress: event.target.value })} placeholder="play.example.com:25565" /><small>{t('Oyun açıldığında bu sunucuya katıl. Normal başlatmak için boş bırak.')}</small></label>}
        <button type="button" className="profile-fullscreen-toggle full" onClick={() => setProfileDraft({ ...profileDraft, fullscreen: !profileDraft.fullscreen })}><span><strong>{t('Tam ekran başlat')}</strong><small>{t('Açılışta ekran çözünürlüğünü tam ekran kullan.')}</small></span><span className={`switch ${profileDraft.fullscreen ? 'on' : ''}`} /></button>
      </div>
      <div className="modal-actions"><div className="spacer" /><button className="secondary" onClick={() => setProfileDraft(null)}>{t('Vazgeç')}</button><button className="modal-primary compact" onClick={saveProfile}> {t('Kaydet')}</button></div>
    </div></div>}
    {screenshotOpen && <div className="modal-backdrop screenshot-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setScreenshotOpen(null) }}><div className="screenshot-viewer"><div><strong>{screenshotOpen.name}</strong><button onClick={() => setScreenshotOpen(null)} aria-label={t('Kapat')}><X size={20} /></button></div><img src={screenshotOpen.url} alt={screenshotOpen.name} /></div></div>}
    {pendingScreenshotDelete && <div className="modal-backdrop"><div className="modal confirm-modal"><DialogHeading title={<>{t('Ekran görüntüsü silinsin mi?')}</>} description={<><strong>{pendingScreenshotDelete.name}</strong> {t('Geri Dönüşüm Kutusu’na taşınacak.')}</>} closeLabel={t('Kapat')} onClose={() => setPendingScreenshotDelete(null)} /><div className="modal-actions"><div className="spacer" /><button className="secondary" onClick={() => setPendingScreenshotDelete(null)}>{t('Vazgeç')}</button><button className="delete-button" onClick={() => deleteScreenshot(pendingScreenshotDelete)}><Trash2 size={16} /> {t('Sil')}</button></div></div></div>}
    {confirmCleanup && cleanupPreview && <div className="modal-backdrop"><div className="modal confirm-modal cleanup-preview-modal"><DialogHeading title={<>{t('Temizleme önizlemesi')}</>} description={<>{t('{size} tutan {count} öğe Geri Dönüşüm Kutusu’na taşınacak.', { size: formatBytes(cleanupPreview.bytes), count: cleanupPreview.items.length })}</>} closeLabel={t('Kapat')} onClose={() => setConfirmCleanup(false)} /><div className="cleanup-preview-list">{cleanupPreview.items.map(item => <div key={item.path}><span className="cleanup-kind">{item.kind === 'logs' ? t('Günlük') : item.kind === 'crashReports' ? t('Çökme raporu') : t('Kullanılmayan sürüm')}</span><strong>{item.path.split(/[\\/]/).pop()}</strong><small title={item.path}>{item.path}</small><b>{formatBytes(item.bytes)}</b></div>)}</div><div className="modal-actions"><div className="spacer" /><button className="secondary" onClick={() => setConfirmCleanup(false)}>{t('Vazgeç')}</button><button className="delete-button" disabled={cleaning || cleanupPreview.items.length === 0} onClick={() => { const paths = cleanupPreview.items.map(item => item.path); setConfirmCleanup(false); cleanFiles(paths) }}><Trash2 size={16} /> {t('Geri Dönüşüm Kutusu’na taşı')}</button></div></div></div>}
    {deleteId && <div className="modal-backdrop"><div className="modal confirm-modal"><DialogHeading title={<>{t('Profil silinsin mi?')}</>} description={<>{t('Profil listeden kaldırılacak. Dünyaların bilgisayarında kalacak.')}</>} closeLabel={t('Kapat')} onClose={() => setDeleteId(null)} /><div className="modal-actions"><div className="spacer" /><button className="secondary" onClick={() => setDeleteId(null)}>{t('Vazgeç')}</button><button className="delete-button" onClick={() => run(async () => { setState(await window.launcher.deleteProfile(deleteId)); setDeleteId(null) }, t('Profil kaldırıldı.'))}><Trash2 size={16} /> {t('Profili sil')}</button></div></div></div>}
    {pendingVersionDelete && <div className="modal-backdrop"><div className="modal confirm-modal"><DialogHeading title={<>{t('Sürüm kaldırılsın mı?')}</>} description={<><strong>{pendingVersionDelete}</strong> {t('Sürüm dosyaları Geri Dönüşüm Kutusu’na taşınacak. Dünyaların ve profillerin korunur.')}</>} closeLabel={t('Kapat')} onClose={() => setPendingVersionDelete(null)} /><div className="modal-actions"><div className="spacer" /><button className="secondary" onClick={() => setPendingVersionDelete(null)}>{t('Vazgeç')}</button><button className="delete-button" onClick={deleteSelectedVersion}><Trash2 size={16} /> {t('Sürümü kaldır')}</button></div></div></div>}
    {pendingJavaDelete && <div className="modal-backdrop"><div className="modal confirm-modal"><DialogHeading title={<>{t('Java kurulumunu kaldır')}</>} description={<><strong>Java {pendingJavaDelete.version}</strong> {t('Geri Dönüşüm Kutusu’na taşınacak.')}</>} closeLabel={t('Kapat')} onClose={() => setPendingJavaDelete(null)} /><div className="modal-actions"><div className="spacer" /><button className="secondary" onClick={() => setPendingJavaDelete(null)}>{t('Vazgeç')}</button><button className="delete-button" onClick={() => deleteJava(pendingJavaDelete)}><Trash2 size={16} /> {t('Sil')}</button></div></div></div>}
  </div>
}

export default App
