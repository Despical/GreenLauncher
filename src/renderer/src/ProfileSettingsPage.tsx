import { useEffect, useState, type ReactNode } from 'react'
import { Check, FolderOpen, Monitor, Settings2, WifiOff } from 'lucide-react'
import { AccountAvatar, MicrosoftMark } from './AccountControls'
import type { GameAccount, LauncherProfile, LauncherSettings, LauncherState, SavedWorld } from '../../shared/types'
import { serverLaunchMode } from '../../shared/server-launch'
import { diagnoseError } from '../../shared/errors'
import { translate, type Language } from './i18n'
import { profilePlaytime } from '../../shared/profile-settings'
import javaIcon from '../assets/java-original.svg'

type Tab = 'general' | 'java' | 'window'
const normalize = (profile: LauncherProfile): LauncherProfile => ({ ...profile, minMemoryMb: profile.minMemoryMb ?? Math.min(1024, profile.memoryMb), jvmArgs: profile.jvmArgs ?? '', fullscreen: profile.fullscreen ?? false, gameDirectory: profile.gameDirectory ?? '', serverAddress: profile.serverAddress ?? '' })

export function ProfileSettingsPage({ profile, selectedProfileId, selectedAccountId, language, isVisible, settings, accounts, choicePicker, onState, onNotice, onOpenGeneral, onBusyChange }: {
  profile: LauncherProfile; selectedProfileId: string | null; selectedAccountId: string | null; language: Language; isVisible: boolean
  settings: LauncherSettings; accounts: GameAccount[]
  choicePicker: (value: string, options: Array<{ value: string; label: string; detail?: string; icon?: ReactNode; detailIcon?: ReactNode }>, onChange: (value: string) => void, label: string, disabled?: boolean) => ReactNode
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
  const draft = { ...(drafts[profile.id] ?? normalize(profile)), versionId: profile.versionId, modLoader: profile.modLoader, modLoaderVersion: profile.modLoaderVersion }
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
  const sectionHeading = (title: string, value: boolean, onChange: () => void) => <>
    <div className="profile-section-divider" role="separator" />
    <h3><button type="button" role="checkbox" aria-checked={value} className="profile-setting-check profile-section-enable" onClick={onChange}><span className="profile-checkbox" aria-hidden="true">{value && <Check size={13} strokeWidth={3} />}</span><span>{t(title)}</span></button></h3>
  </>
  const toggle = (title: string, description: string, value: boolean, onChange: () => void) => <button type="button" role="switch" aria-checked={value} className="setting-toggle" onClick={onChange}><span><strong>{t(title)}</strong><small>{t(description)}</small></span><span aria-hidden="true" className={`switch ${value ? 'on' : ''}`} /></button>
  const autoJoin = draft.autoJoinEnabled ?? !!draft.serverAddress
  const memoryEnabled = draft.memoryOverride !== false
  const worldSupported = serverLaunchMode(draft.versionId) === 'quick-play'
  const effectiveAccountId = draft.accountOverride ? draft.launchAccountId ?? selectedAccountId ?? accounts[0]?.id ?? '' : selectedAccountId ?? accounts[0]?.id ?? ''
  const tabs = [{ id: 'general', label: 'Genel', icon: Settings2 }, { id: 'java', label: 'Java', icon: null }, { id: 'window', label: 'Pencere', icon: Monitor }] as const
  return <div className="content-page settings-page profile-settings-page">
    <div className="page-heading profile-settings-heading"><div><h2>{t('Ayarlar')}</h2><p>{t('Buradaki ayarlar genel ayarları geçersiz kılar.')}</p></div><button type="button" className="heading-action profile-general-settings-link" onClick={() => onOpenGeneral(tab === 'java' ? 'java' : 'launcher')}><Settings2 size={17} />{t('Genel ayarları aç')}</button></div>
    <div className="settings-tabs" role="tablist" aria-label={t('Profil ayarları')}>{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" id={`profile-settings-tab-${id}`} role="tab" aria-controls={`profile-settings-panel-${id}`} aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{Icon ? <Icon size={19} /> : <img className="java-icon" src={javaIcon} alt="" />}{label === 'Java' ? label : t(label)}</button>)}</div>
    <div className="settings-panel settings-tab-panel profile-settings-panel" role="tabpanel" id={`profile-settings-panel-${tab}`} aria-labelledby={`profile-settings-tab-${tab}`}>
      <fieldset className="profile-settings-fields" disabled={saving}>
        {tab === 'general' && <div className="form-grid">
          <label className="full">{t('Profil adı')}<input value={draft.name} maxLength={48} onChange={event => update({ name: event.target.value })} placeholder={t('Örn. Survival')} /></label>
          <label className="full profile-game-directory">{t('Oyun klasörü')}<div className="input-with-button"><input value={draft.gameDirectory ?? ''} onChange={event => update({ gameDirectory: event.target.value })} placeholder={t('Profilin varsayılan klasörü')} /><button type="button" title={t('Klasör seç')} onClick={() => void browse('directory')}><FolderOpen size={17} /></button></div></label>
          <section className="full profile-settings-section profile-auto-join">
            {sectionHeading('Otomatik katılım', autoJoin, () => update({ autoJoinEnabled: !autoJoin }))}
            <fieldset disabled={!autoJoin} data-enabled={autoJoin} className="profile-settings-fields profile-settings-box profile-auto-join-fields">
              <div className="profile-join-row"><button type="button" role="radio" aria-checked={draft.autoJoinMode !== 'world'} className="profile-setting-radio" disabled={!serverLaunchMode(draft.versionId)} onClick={() => update({ autoJoinMode: 'server' })}><span aria-hidden="true" /><span>{t('Başlangıç sunucusu')}</span></button><input aria-label={t('Sunucu adresi')} disabled={draft.autoJoinMode === 'world' || !serverLaunchMode(draft.versionId)} value={draft.serverAddress ?? ''} maxLength={260} onChange={event => update({ serverAddress: event.target.value })} placeholder="play.example.com:25565" /></div>
              <div className="profile-join-row"><button type="button" role="radio" aria-checked={draft.autoJoinMode === 'world'} className="profile-setting-radio" disabled={!worldSupported} onClick={() => update({ autoJoinMode: 'world' })}><span aria-hidden="true" /><span>{t('Tek oyunculu dünya')}</span></button>{choicePicker(draft.worldId ?? '', [...(draft.worldId && !worlds.some(world => world.id === draft.worldId) ? [{ value: draft.worldId, label: draft.worldId }] : []), ...worlds.map(world => ({ value: world.id, label: world.name }))], worldId => update({ worldId }), t(worldLoading ? 'Dünyalar yükleniyor...' : 'Dünya seç'), draft.autoJoinMode !== 'world' || !worldSupported || worldLoading || !worlds.length)}</div>
              {!worldSupported && <small className="profile-setting-description">{t('Dünyaya doğrudan katılım Minecraft 1.20 ve sonrasında desteklenir.')}</small>}
              {worldError && <small className="profile-setting-description" role="alert">{worldError}</small>}
            </fieldset>
          </section>
          <section className="full profile-settings-section profile-playtime-settings">{sectionHeading('Oyun süresi', draft.playtimeOverride === true, () => update({ playtimeOverride: !draft.playtimeOverride, showPlaytime: draft.showPlaytime ?? settings.showPlaytime !== false, savePlaytime: draft.savePlaytime ?? settings.savePlaytime !== false }))}
            <fieldset className="profile-settings-fields profile-settings-box profile-setting-options" data-enabled={draft.playtimeOverride === true} disabled={!draft.playtimeOverride}>{toggle('Bu profilde oynanan süreyi göster', 'Bu profilin son oturumunu ve toplam oyun süresini göster.', profilePlaytime(draft, settings, 'showPlaytime'), () => update({ showPlaytime: !profilePlaytime(draft, settings, 'showPlaytime') }))}{toggle('Bu profilde oynanan süreyi kaydet', 'Bu profilin oynanan süresini sonraki oturumlar için sakla.', profilePlaytime(draft, settings, 'savePlaytime'), () => update({ savePlaytime: !profilePlaytime(draft, settings, 'savePlaytime') }))}</fieldset>
          </section>
          <section className="full profile-settings-section profile-console-settings">{sectionHeading('Konsol penceresi', draft.consoleEnabled === true, () => update({ consoleEnabled: !draft.consoleEnabled }))}
            <fieldset className="profile-settings-fields profile-settings-box profile-setting-options" data-enabled={draft.consoleEnabled === true} disabled={!draft.consoleEnabled}>{toggle('Oyun başlatıldığında konsol sayfasını göster', 'Bu profil başlatıldığında Minecraft günlüğüne geç.', draft.showConsoleOnLaunch !== false, () => update({ showConsoleOnLaunch: draft.showConsoleOnLaunch === false }))}{toggle('Oyun çöktüğünde konsol sayfasını göster', 'Oyun hata ile kapanırsa Minecraft günlüğünü aç.', draft.showConsoleOnCrash !== false, () => update({ showConsoleOnCrash: draft.showConsoleOnCrash === false }))}</fieldset>
          </section>
          <section className="full profile-settings-section profile-account-override">{sectionHeading('Varsayılan hesabı geçersiz kıl', draft.accountOverride === true, () => update({ accountOverride: !draft.accountOverride, launchAccountId: draft.launchAccountId ?? selectedAccountId ?? accounts[0]?.id }))}
            <fieldset className="profile-settings-fields profile-settings-box" data-enabled={draft.accountOverride === true} disabled={!draft.accountOverride}><div className="profile-setting-field"><label>{t('Hesap')}</label>{choicePicker(effectiveAccountId, accounts.map(account => ({ value: account.id, label: account.name, detail: t(account.kind === 'offline' ? 'Çevrimdışı hesap' : 'Microsoft hesabı'), icon: <AccountAvatar account={account} />, detailIcon: account.kind === 'offline' ? <WifiOff size={14} /> : <MicrosoftMark size={14} /> })), launchAccountId => update({ launchAccountId }), t('Hesap seç'), !draft.accountOverride)}</div></fieldset>
          </section>
        </div>}
        {tab === 'java' && <div className="form-grid">
          <label className="full">{t('Java çalıştırılabilir dosyası')}<div className="input-with-button"><input value={draft.javaPath} onChange={event => update({ javaPath: event.target.value })} placeholder={t('Otomatik algıla')} /><button type="button" title={t('Java seç')} onClick={() => void browse('java')}><FolderOpen size={17} /></button></div></label>
          <section className="full profile-settings-section profile-memory-settings">{sectionHeading('Bellek', memoryEnabled, () => update({ memoryOverride: !memoryEnabled }))}
            <fieldset className="profile-settings-fields profile-settings-box form-grid" data-enabled={memoryEnabled} disabled={!memoryEnabled}>
              <label>{t('Minimum bellek (MB) (-Xms)')}<input type="number" min={512} max={32768} step={512} value={draft.minMemoryMb} onChange={event => update({ minMemoryMb: Number(event.target.value) })} /></label>
              <label>{t('Maksimum bellek (MB) (-Xmx)')}<input type="number" min={1024} max={32768} step={512} value={draft.memoryMb} onChange={event => update({ memoryMb: Number(event.target.value) })} /></label>
              <label className="full">{t('PermGen boyutu (MB) (-XX:PermSize)')}<input type="number" min={64} max={4096} step={64} value={draft.permGenMb ?? 128} onChange={event => update({ permGenMb: Number(event.target.value) })} /></label>
            </fieldset>
          </section>
          <label className="full profile-jvm-args"><div className="profile-section-divider" role="separator" />{t('JVM argümanları')}<textarea rows={3} value={draft.jvmArgs ?? ''} onChange={event => update({ jvmArgs: event.target.value })} placeholder="-XX:+UseG1GC" /></label>
        </div>}
        {tab === 'window' && <div className="form-grid">
          <label>{t('Genişlik')}<input type="number" min={640} max={7680} value={draft.width} onChange={event => update({ width: Number(event.target.value) })} /></label>
          <label>{t('Yükseklik')}<input type="number" min={480} max={4320} value={draft.height} onChange={event => update({ height: Number(event.target.value) })} /></label>
          <div className="full profile-window-divider profile-section-divider" role="separator" />
          <div className="full profile-window-options">{toggle('Tam ekran başlat', 'Açılışta ekran çözünürlüğünü tam ekran kullan.', draft.fullscreen === true, () => update({ fullscreen: !draft.fullscreen }))}{toggle('Oyun penceresi açıldığında başlatıcıyı gizle', 'Oyun çalışırken başlatıcıyı arka planda tut.', draft.hideLauncher ?? settings.closeOnLaunch, () => update({ hideLauncher: !(draft.hideLauncher ?? settings.closeOnLaunch) }))}{toggle('Oyun penceresi kapandığında başlatıcıdan çık', 'Tüm oyun pencereleri kapandığında başlatıcıyı kapat.', draft.quitOnGameExit === true, () => update({ quitOnGameExit: !draft.quitOnGameExit }))}</div>
        </div>}
      </fieldset>
    </div>
    {isVisible && dirty && <div className="save-bar profile-settings-save-bar"><span>{t('Kaydedilmemiş değişikliklerin var.')}</span><button type="button" disabled={saving} onClick={reset}>{t('Sıfırla')}</button><button type="button" className="save-confirm" disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? t('Kaydediliyor...') : t('Değişiklikleri kaydet')}</button></div>}
  </div>
}
