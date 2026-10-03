import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, FolderOpen, Image, Layers3, LoaderCircle, Monitor, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react'
import type { LauncherProfile, ProfileCover } from '../../shared/types'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import { profileVersionLabel } from '../../shared/profile-version'
import './profiles.css'

export type ProfileAction = 'manage' | 'edit' | 'cover' | 'clone' | 'export' | 'repair' | 'shortcut' | 'mods-folder' | 'delete'

export function ProfileMenu({ profile, x, y, language, pending, onClose, onAction }: {
  profile: LauncherProfile; x: number; y: number; language: Language; pending: boolean
  onClose: () => void; onAction: (action: ProfileAction) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [modsPath, setModsPath] = useState<string | null>(null)
  const t = (text: string) => translate(language, text)
  useEffect(() => {
    let active = true
    window.launcher.getProfileModsPath(profile.id).then(path => { if (active) setModsPath(path) }).catch(() => {})
    return () => { active = false }
  }, [profile.id])
  useLayoutEffect(() => {
    if (root.current) root.current.style.top = `${Math.max(50, Math.min(y, window.innerHeight - root.current.offsetHeight - 10))}px`
  }, [modsPath, y])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const buttons = [...root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []]
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      if (buttons[next]) { event.preventDefault(); buttons[next].focus() }
    }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key)
    const main = document.querySelector('.main-content')
    main?.addEventListener('scroll', onClose)
    window.addEventListener('resize', onClose)
    root.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); main?.removeEventListener('scroll', onClose); window.removeEventListener('resize', onClose) }
  }, [])
  const actions = [
    { id: 'manage', title: 'Profili yönet', icon: Layers3 },
    { id: 'edit', title: 'Profili düzenle', icon: Pencil }, { id: 'cover', title: 'Kapağı düzenle', icon: Image },
    { id: 'clone', title: 'Profili klonla', icon: Copy }, { id: 'export', title: 'Dışa aktar', icon: Upload },
    { id: 'repair', title: 'Dosyaları onar', icon: ShieldCheck }, { id: 'shortcut', title: 'Masaüstüne kısayol oluştur', icon: Monitor },
    { id: 'delete', title: 'Profili sil', icon: Trash2 }
  ] as const
  return <div ref={root} className="version-context-menu profile-context-menu" role="menu" aria-label={t('Profil seçenekleri')} style={{ left: Math.max(10, Math.min(window.innerWidth - 270, x)), top: Math.max(50, Math.min(window.innerHeight - 430, y)) }}>
    <div className="version-context-label">{profile.name}</div><div className="version-context-divider" />
    {actions.map(({ id, title, icon: Icon }) => <Fragment key={id}>{id === 'delete' && (modsPath && <button role="menuitem" className="profile-mods-folder" title={modsPath} onClick={() => { onClose(); onAction('mods-folder') }}><FolderOpen size={16} /><span><strong>{t('Mod klasörünü aç')}</strong><small>{modsPath}</small></span></button>)}{id === 'delete' && <div className="version-context-divider" role="separator" />}<button role="menuitem" className={id === 'delete' ? 'danger' : ''} disabled={pending && ['clone', 'export', 'repair', 'delete'].includes(id)} onClick={() => { onClose(); onAction(id) }}><Icon size={16} />{t(title)}</button></Fragment>)}
  </div>
}

export function ProfileCoverEditor({ profile, language, onClose, onSaved, onNotice }: {
  profile: LauncherProfile; language: Language; onClose: () => void
  onSaved: (cover: ProfileCover) => Promise<void>; onNotice: (message: string) => void
}) {
  const t = (text: string) => translate(language, text)
  const [cover, setCover] = useState<ProfileCover>(profile.cover ?? { color: '#4c8862', description: '' })
  const [customColor, setCustomColor] = useState(profile.cover?.color ?? '#768597')
  const [pending, setPending] = useState(false)
  const colors = ['#4c8862', '#599b94', '#567fa3', '#9172a8', '#c59b55', '#b26c6c', '#768597']
  const choose = async () => {
    setPending(true)
    try { const image = await window.launcher.chooseProfileCover(); if (image) setCover(value => ({ ...value, image })) }
    catch (error) { onNotice(error instanceof Error ? error.message : String(error)) }
    finally { setPending(false) }
  }
  return <AccountDialog className="profile-cover-dialog" title={t('Profil kapağı')} description={t('Profil kartının görselini, rengini ve kısa açıklamasını düzenle.')} closeLabel={t('Kapat')} onClose={onClose} icon={null}>
    <div className="profile-cover-preview" style={{ '--profile-color': cover.color } as React.CSSProperties}>{cover.image && <img src={cover.image} alt="" />}<div><strong>{profile.name}</strong>{cover.description && <span className="profile-cover-preview-description">{cover.description}</span>}<span className="profile-cover-preview-version">{profileVersionLabel(profile)}</span></div></div>
    <div className="profile-cover-image-actions"><button className="secondary" disabled={pending} onClick={() => void choose()}><Image size={16} />{t('Görsel seç')}</button>{cover.image && <button className="profile-cover-remove" disabled={pending} onClick={() => setCover(value => ({ ...value, image: undefined }))}>{t('Görseli kaldır')}</button>}</div>
    <div className="profile-cover-option"><label className="profile-cover-label">{t('Renk')}</label><div className="profile-cover-colors">{colors.map(color => <button key={color} title={color} aria-label={color} aria-pressed={color === cover.color} style={{ background: color }} onClick={() => setCover(value => ({ ...value, color }))} />)}<label className="profile-cover-custom" title={t('Özel renk')} style={{ background: customColor }}><input type="color" aria-label={t('Özel renk')} value={customColor} onChange={event => { setCustomColor(event.target.value); setCover(value => ({ ...value, color: event.target.value })) }} /></label></div></div>
    <div className="profile-cover-option"><label className="profile-cover-label" htmlFor="profile-cover-description">{t('Kısa açıklama')}</label><input id="profile-cover-description" className="profile-cover-description" value={cover.description} maxLength={120} placeholder={t('Bu profili özel yapan ne?')} onChange={event => setCover(value => ({ ...value, description: event.target.value }))} /></div>
    <div className="modal-actions"><button className="secondary" onClick={onClose} disabled={pending}>{t('Vazgeç')}</button><button className="modal-primary compact" disabled={pending} onClick={async () => { setPending(true); try { await onSaved(cover); onClose() } catch (error) { onNotice(error instanceof Error ? error.message : String(error)) } finally { setPending(false) } }}>{pending && <LoaderCircle size={16} className="spin" />}{t('Kaydet')}</button></div>
  </AccountDialog>
}

export function ProfileDropHint({ language }: { language: Language }) { return <div className="profile-drop-hint"><ArrowDownToLine size={34} /><strong>{translate(language, 'Profil paketini buraya bırak')}</strong><span>Green Launcher · .glprofile / Modrinth · .mrpack</span></div> }
