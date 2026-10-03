import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, Check, FolderOpen, HardDrive, Monitor, Settings2 } from 'lucide-react'
import type { GameAccount, LauncherProfile, LauncherSettings, LauncherState, SavedWorld } from '../../shared/types'
import { serverLaunchMode } from '../../shared/server-launch'
import { diagnoseError } from '../../shared/errors'
import { translate, type Language } from './i18n'
import { profilePlaytime } from '../../shared/profile-settings'
import javaIcon from '../assets/java-original.svg'

type Tab = 'general' | 'java' | 'window' | 'storage'
const normalize = (profile: LauncherProfile): LauncherProfile => ({ ...profile, minMemoryMb: profile.minMemoryMb ?? Math.min(1024, profile.memoryMb), jvmArgs: profile.jvmArgs ?? '', fullscreen: profile.fullscreen ?? false, gameDirectory: profile.gameDirectory ?? '', serverAddress: profile.serverAddress ?? '' })

export function ProfileSettingsPage({ profile, selectedProfileId, language, isVisible, settings, accounts, choicePicker, versionPicker, onState, onNotice, onOpenGeneral, onBusyChange }: {
  profile: LauncherProfile; selectedProfileId: string | null; language: Language; isVisible: boolean
  settings: LauncherSettings; accounts: GameAccount[]
  choicePicker: (value: string, options: Array<{ value: string; label: string; detail?: string }>, onChange: (value: string) => void, label: string, disabled?: boolean) => ReactNode
  versionPicker: (draft: LauncherProfile, onChange: (versionId: string) => void) => ReactNode
  onState: (state: LauncherState) => void; onNotice: (message: string) => void
  onOpenGeneral: (tab: 'launcher' | 'java' | 'storage') => void; onBusyChange: (busy: boolean) => void
}) {
  const t = (source: string) => translate(language, source)
  const [tab, setTab] = useState<Tab>('general')
  const [drafts, setDrafts] = useState<Record<string, LauncherProfile>>({})
  const [saving, setSaving] = useState(false)
  const [worlds, setWorlds] = useState<SavedWorld[]>([])
  const [worldLoading, setWorldLoading] = useState(false)
  const [worldError, setWorldError] = useState('')
  useEffect(() => {
    if (!isVisible) return
    let active = true
    setWorlds([]); setWorldError(''); setWorldLoading(true)
    window.launcher.getWorlds(profile.id).then(items => { if (active) setWorlds(items) }).catch(error => { if (active) setWorldError(t(diagnoseError(error).message)) }).finally(() => { if (active) setWorldLoading(false) })
    return () => { active = false }
  }, [profile.id, profile.gameDirectory, isVisible, language])
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
    if (draft.memoryOverride !== false && (draft.minMemoryMb ?? 1024) > draft.memoryMb) { onNotice(t('Minimum bellek maksimum bellekten büyük olamaz.')); return }
    if (draft.accountOverride && !accounts.some(account => account.id === draft.launchAccountId)) { onNotice(t('Seçilen hesap bulunamadı.')); return }
    if (draft.autoJoinEnabled && draft.autoJoinMode === 'world' && !draft.worldId) { onNotice(t('Önce bir dünya seçin.')); return }
    setSaving(true)
    try {
      let state = await window.launcher.saveProfile(draft)
      if (selectedProfileId && selectedProfileId !== draft.id && state.profiles.some(item => item.id === selectedProfileId)) state = await window.launcher.selectProfile(selectedProfileId)
      onState(state); reset(); onNotice(t('Profil kaydedildi.'))
    } catch (error) { onNotice(t(diagnoseError(error).message)) }
    finally { setSaving(false) }
  }
  const checked = (label: string, value: boolean, onChange: () => void, className = '') => <button type="button" role="checkbox" aria-checked={value} className={`profile-setting-check ${className}`} onClick={onChange}><span className="profile-checkbox" aria-hidden="true">{value && <Check size={13} />}</span><span>{t(label)}</span></button>
  const autoJoin = draft.autoJoinEnabled ?? !!draft.serverAddress
  const memoryEnabled = draft.memoryOverride !== false
  const worldSupported = serverLaunchMode(draft.versionId) === 'quick-play'
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
          <section className="full profile-settings-section profile-auto-join">
            <h3>{t('Otomatik katılım')}</h3>
            {checked('Etkinleştir', autoJoin, () => update({ autoJoinEnabled: !autoJoin }), 'profile-section-enable')}
            <fieldset disabled={!autoJoin} className="profile-settings-fields profile-auto-join-fields">
              <div className="profile-join-row"><button type="button" role="radio" aria-checked={draft.autoJoinMode !== 'world'} className="profile-setting-radio" disabled={!serverLaunchMode(draft.versionId)} onClick={() => update({ autoJoinMode: 'server' })}><span aria-hidden="true" /><span>{t('Başlangıç sunucusu')}</span></button><input aria-label={t('Sunucu adresi')} disabled={draft.autoJoinMode === 'world' || !serverLaunchMode(draft.versionId)} value={draft.serverAddress ?? ''} maxLength={260} onChange={event => update({ serverAddress: event.target.value })} placeholder="play.example.com:25565" /></div>
              <small className="profile-setting-description">{t('Oyun açıldığında bu sunucuya katıl. Normal başlatmak için boş bırak.')}</small>
              <div className="profile-join-row"><button type="button" role="radio" aria-checked={draft.autoJoinMode === 'world'} className="profile-setting-radio" disabled={!worldSupported} onClick={() => update({ autoJoinMode: 'world' })}><span aria-hidden="true" /><span>{t('Tek oyunculu dünya')}</span></button>{choicePicker(draft.worldId ?? '', [...(draft.worldId && !worlds.some(world => world.id === draft.worldId) ? [{ value: draft.worldId, label: draft.worldId }] : []), ...worlds.map(world => ({ value: world.id, label: world.name }))], worldId => update({ worldId }), t(worldLoading ? 'Dünyalar yükleniyor...' : 'Dünya seç'), draft.autoJoinMode !== 'world' || !worldSupported || worldLoading || !worlds.length)}</div>
              {!worldSupported && <small className="profile-setting-description">{t('Dünyaya doğrudan katılım Minecraft 1.20 ve sonrasında desteklenir.')}</small>}
              {worldError && <small className="profile-setting-description" role="alert">{worldError}</small>}
            </fieldset>
          </section>
          <section className="full profile-settings-section profile-playtime-settings"><h3>{t('Oyun Süresi')}</h3>{checked('Etkinleştir', draft.playtimeOverride === true, () => update({ playtimeOverride: !draft.playtimeOverride, showPlaytime: draft.showPlaytime ?? settings.showPlaytime !== false, savePlaytime: draft.savePlaytime ?? settings.savePlaytime !== false }), 'profile-section-enable')}
            <fieldset className="profile-settings-fields profile-setting-options" disabled={!draft.playtimeOverride}>{checked('Bu profilde oynanan süreyi göster', profilePlaytime(draft, settings, 'showPlaytime'), () => update({ showPlaytime: draft.showPlaytime === false }))}{checked('Bu profilde oynanan süreyi kaydet', profilePlaytime(draft, settings, 'savePlaytime'), () => update({ savePlaytime: draft.savePlaytime === false }))}</fieldset>
          </section>
          <section className="full profile-settings-section profile-account-override"><h3>{t('Varsayılan Hesabı Geçersiz Kıl')}</h3>{checked('Etkinleştir', draft.accountOverride === true, () => update({ accountOverride: !draft.accountOverride, launchAccountId: draft.launchAccountId ?? accounts[0]?.id }), 'profile-section-enable')}
            {draft.accountOverride && <div className="profile-setting-field"><label>{t('Hesap')}</label>{choicePicker(draft.launchAccountId ?? '', accounts.map(account => ({ value: account.id, label: account.name, detail: t(account.kind === 'offline' ? 'Çevrimdışı hesap' : 'Microsoft hesabı') })), launchAccountId => update({ launchAccountId }), t('Hesap seç'))}</div>}
          </section>
        </div>}
        {tab === 'java' && <div className="form-grid">
          <label className="full">{t('Java çalıştırılabilir dosyası')}<div className="input-with-button"><input value={draft.javaPath} onChange={event => update({ javaPath: event.target.value })} placeholder={t('Otomatik algıla')} /><button type="button" title={t('Java seç')} onClick={() => void browse('java')}><FolderOpen size={17} /></button></div></label>
          <section className="full profile-settings-section profile-memory-settings"><h3>{t('Bellek')}</h3>{checked('Etkinleştir', memoryEnabled, () => update({ memoryOverride: !memoryEnabled }), 'profile-section-enable')}
            <fieldset className="profile-settings-fields form-grid" disabled={!memoryEnabled}>
              <label>{t('Minimum bellek (MB) (-Xms)')}<input type="number" min={512} max={32768} step={512} value={draft.minMemoryMb} onChange={event => update({ minMemoryMb: Number(event.target.value) })} /></label>
              <label>{t('Maksimum bellek (MB) (-Xmx)')}<input type="number" min={1024} max={32768} step={512} value={draft.memoryMb} onChange={event => update({ memoryMb: Number(event.target.value) })} /></label>
              <label className="full">{t('PermGen boyutu (MB) (-XX:PermSize)')}<input type="number" min={64} max={4096} step={64} value={draft.permGenMb ?? 128} onChange={event => update({ permGenMb: Number(event.target.value) })} /><small className="profile-setting-description">{t('Yalnızca Java 7 ve önceki sürümlerde kullanılır.')}</small></label>
            </fieldset>
          </section>
          <label className="full profile-jvm-args">{t('JVM argümanları')}<input value={draft.jvmArgs ?? ''} onChange={event => update({ jvmArgs: event.target.value })} placeholder="-XX:+UseG1GC" /></label>
        </div>}
        {tab === 'window' && <div className="form-grid">
          <label>{t('Genişlik')}<input type="number" min={640} max={7680} value={draft.width} onChange={event => update({ width: Number(event.target.value) })} /></label>
          <label>{t('Yükseklik')}<input type="number" min={480} max={4320} value={draft.height} onChange={event => update({ height: Number(event.target.value) })} /></label>
          <div className="full profile-setting-options profile-window-options">{checked('Tam ekran başlat', draft.fullscreen === true, () => update({ fullscreen: !draft.fullscreen }))}{checked('Oyun penceresi açıldığında başlatıcıyı gizle', draft.hideLauncher ?? settings.closeOnLaunch, () => update({ hideLauncher: !(draft.hideLauncher ?? settings.closeOnLaunch) }))}{checked('Oyun penceresi kapandığında başlatıcıdan çık', draft.quitOnGameExit === true, () => update({ quitOnGameExit: !draft.quitOnGameExit }))}</div>
        </div>}
        {tab === 'storage' && <div className="form-grid"><label className="full">{t('Oyun klasörü')}<div className="input-with-button"><input value={draft.gameDirectory ?? ''} onChange={event => update({ gameDirectory: event.target.value })} placeholder={t('Profilin varsayılan klasörü')} /><button type="button" title={t('Klasör seç')} onClick={() => void browse('directory')}><FolderOpen size={17} /></button></div></label></div>}
      </fieldset>
    </div>
    {isVisible && dirty && <div className="save-bar profile-settings-save-bar"><span>{t('Kaydedilmemiş değişikliklerin var.')}</span><button type="button" disabled={saving} onClick={reset}>{t('Sıfırla')}</button><button type="button" className="save-confirm" disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? t('Kaydediliyor...') : t('Değişiklikleri kaydet')}</button></div>}
  </div>
}
