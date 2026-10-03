import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, FolderOpen, HardDrive, Monitor, Settings2 } from 'lucide-react'
import type { LauncherProfile, LauncherState } from '../../shared/types'
import { serverLaunchMode } from '../../shared/server-launch'
import { diagnoseError } from '../../shared/errors'
import { translate, type Language } from './i18n'
import javaIcon from '../assets/java-original.svg'

type Tab = 'general' | 'java' | 'window' | 'storage'
const normalize = (profile: LauncherProfile): LauncherProfile => ({ ...profile, minMemoryMb: profile.minMemoryMb ?? Math.min(1024, profile.memoryMb), jvmArgs: profile.jvmArgs ?? '', fullscreen: profile.fullscreen ?? false, gameDirectory: profile.gameDirectory ?? '', serverAddress: profile.serverAddress ?? '' })

export function ProfileSettingsPage({ profile, selectedProfileId, language, isVisible, versionPicker, onState, onNotice, onOpenGeneral, onBusyChange }: {
  profile: LauncherProfile; selectedProfileId: string | null; language: Language; isVisible: boolean
  versionPicker: (draft: LauncherProfile, onChange: (versionId: string) => void) => ReactNode
  onState: (state: LauncherState) => void; onNotice: (message: string) => void
  onOpenGeneral: (tab: 'launcher' | 'java' | 'storage') => void; onBusyChange: (busy: boolean) => void
}) {
  const t = (source: string) => translate(language, source)
  const [tab, setTab] = useState<Tab>('general')
  const [drafts, setDrafts] = useState<Record<string, LauncherProfile>>({})
  const [saving, setSaving] = useState(false)
  const draft = drafts[profile.id] ?? normalize(profile)
  const dirty = JSON.stringify(draft) !== JSON.stringify(normalize(profile))
  useEffect(() => { onBusyChange(saving); return () => onBusyChange(false) }, [saving, onBusyChange])
  const update = (changes: Partial<LauncherProfile>) => setDrafts(current => ({ ...current, [profile.id]: { ...draft, ...changes } }))
  const reset = () => setDrafts(current => { const next = { ...current }; delete next[profile.id]; return next })
  const browse = async (kind: 'java' | 'directory') => {
    try {
      const path = await (kind === 'java' ? window.launcher.chooseJava() : window.launcher.chooseGameDirectory())
      if (path) update(kind === 'java' ? { javaPath: path } : { gameDirectory: path })
    } catch (error) { onNotice(t(diagnoseError(error).message)) }
  }
  const save = async () => {
    if (saving) return
    if ((draft.minMemoryMb ?? 1024) > draft.memoryMb) { onNotice(t('Minimum bellek maksimum bellekten büyük olamaz.')); return }
    setSaving(true)
    try {
      let state = await window.launcher.saveProfile(draft)
      if (selectedProfileId && selectedProfileId !== draft.id && state.profiles.some(item => item.id === selectedProfileId)) state = await window.launcher.selectProfile(selectedProfileId)
      onState(state); reset(); onNotice(t('Profil kaydedildi.'))
    } catch (error) { onNotice(t(diagnoseError(error).message)) }
    finally { setSaving(false) }
  }
  const tabs = [{ id: 'general', label: 'Genel', icon: Settings2 }, { id: 'java', label: 'Java', icon: null }, { id: 'window', label: 'Pencere', icon: Monitor }, { id: 'storage', label: 'Depolama', icon: HardDrive }] as const
  return <div className="content-page settings-page profile-settings-page">
    <div className="page-heading"><div><h2>{t('Ayarlar')}</h2><p>{profile.name}</p></div></div>
    <div className="settings-tabs" role="tablist" aria-label={t('Profil ayarları')}>{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" id={`profile-settings-tab-${id}`} role="tab" aria-controls={`profile-settings-panel-${id}`} aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{Icon ? <Icon size={19} /> : <img className="java-icon" src={javaIcon} alt="" />}{label === 'Java' ? label : t(label)}</button>)}</div>
    <div className="settings-panel settings-tab-panel profile-settings-panel" role="tabpanel" id={`profile-settings-panel-${tab}`} aria-labelledby={`profile-settings-tab-${tab}`}>
      <button type="button" className="profile-general-settings-link" onClick={() => onOpenGeneral(tab === 'java' ? 'java' : tab === 'storage' ? 'storage' : 'launcher')}><Settings2 size={22} /><span><strong>{t('Genel Ayarları aç')}</strong><small>{t('Buradaki ayarlar genel ayarları geçersiz kılar')}</small></span><ArrowUpRight size={19} /></button>
      <fieldset className="profile-settings-fields" disabled={saving}>
        {tab === 'general' && <div className="form-grid">
          <label className="full">{t('Profil adı')}<input value={draft.name} maxLength={48} onChange={event => update({ name: event.target.value })} placeholder={t('Örn. Survival')} /></label>
          <div className="full profile-version-field"><label>{t('Minecraft sürümü')}</label>{versionPicker(draft, versionId => update({ versionId, modLoader: undefined, modLoaderVersion: undefined }))}</div>
          {serverLaunchMode(draft.versionId) && <label className="full profile-server-field">{t('Başlangıç sunucusu')}<input value={draft.serverAddress ?? ''} maxLength={260} onChange={event => update({ serverAddress: event.target.value })} placeholder="play.example.com:25565" /><small>{t('Oyun açıldığında bu sunucuya katıl. Normal başlatmak için boş bırak.')}</small></label>}
        </div>}
        {tab === 'java' && <div className="form-grid">
          <label className="full">{t('Java yolu')}<div className="input-with-button"><input value={draft.javaPath} onChange={event => update({ javaPath: event.target.value })} placeholder={t('Otomatik algıla')} /><button type="button" title={t('Java seç')} onClick={() => void browse('java')}><FolderOpen size={17} /></button></div></label>
          <label>{t('Minimum bellek (MB) (-Xms)')}<input type="number" min={512} max={32768} step={512} value={draft.minMemoryMb} onChange={event => update({ minMemoryMb: Number(event.target.value) })} /></label>
          <label>{t('Maksimum bellek (MB) (-Xmx)')}<input type="number" min={1024} max={32768} step={512} value={draft.memoryMb} onChange={event => update({ memoryMb: Number(event.target.value) })} /></label>
          <label className="full">{t('JVM argümanları')}<input value={draft.jvmArgs ?? ''} onChange={event => update({ jvmArgs: event.target.value })} placeholder="-XX:+UseG1GC" /></label>
        </div>}
        {tab === 'window' && <div className="form-grid">
          <label>{t('Genişlik')}<input type="number" min={640} max={7680} value={draft.width} onChange={event => update({ width: Number(event.target.value) })} /></label>
          <label>{t('Yükseklik')}<input type="number" min={480} max={4320} value={draft.height} onChange={event => update({ height: Number(event.target.value) })} /></label>
          <button type="button" role="checkbox" aria-checked={draft.fullscreen === true} className="profile-fullscreen-toggle full" onClick={() => update({ fullscreen: !draft.fullscreen })}><span><strong>{t('Tam ekran başlat')}</strong><small>{t('Açılışta ekran çözünürlüğünü tam ekran kullan.')}</small></span><span aria-hidden="true" className={`switch ${draft.fullscreen ? 'on' : ''}`} /></button>
        </div>}
        {tab === 'storage' && <div className="form-grid"><label className="full">{t('Oyun klasörü')}<div className="input-with-button"><input value={draft.gameDirectory ?? ''} onChange={event => update({ gameDirectory: event.target.value })} placeholder={t('Profilin varsayılan klasörü')} /><button type="button" title={t('Klasör seç')} onClick={() => void browse('directory')}><FolderOpen size={17} /></button></div></label></div>}
      </fieldset>
    </div>
    {isVisible && dirty && <div className="save-bar profile-settings-save-bar"><span>{t('Kaydedilmemiş değişikliklerin var.')}</span><button type="button" disabled={saving} onClick={reset}>{t('Sıfırla')}</button><button type="button" className="save-confirm" disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? t('Kaydediliyor...') : t('Değişiklikleri kaydet')}</button></div>}
  </div>
}
