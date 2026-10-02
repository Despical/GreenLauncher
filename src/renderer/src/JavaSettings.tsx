import { FolderOpen, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import type { JavaRuntimeInfo, LauncherSettings } from '../../shared/types'
import { memoryGb } from '../../shared/memory'
import { translate, type Language } from './i18n'
import javaIcon from '../assets/java-original.svg'

export function JavaSettings({ settings, language, tab, onTab, runtimes, loading, busy, deletingPath, onChange, onBrowse, onRescan, onOpen, onDelete }: {
  settings: LauncherSettings; language: Language; tab: 'general' | 'installations'; onTab: (tab: 'general' | 'installations') => void
  runtimes: JavaRuntimeInfo[]; loading: boolean; busy: boolean; deletingPath: string | null
  onChange: (changes: Partial<LauncherSettings>) => void; onBrowse: () => void; onRescan: () => void
  onOpen: (path: string) => void; onDelete: (runtime: JavaRuntimeInfo) => void
}) {
  const t = (source: string) => translate(language, source)
  return <section className="settings-panel settings-tab-panel java-preferences" role="tabpanel">
    <header className="settings-panel-head java-settings-head"><div className="setting-icon"><img className="java-icon large" src={javaIcon} alt="" draggable={false} /></div><div><h3>Java</h3><p>{t('Oyunun çalışacağı Java sürümünü ve varsayılan belleği yönet.')}</p></div><div className="settings-subtabs" role="tablist" aria-label={t('Java ayarları')}>{(['general', 'installations'] as const).map(item => <button key={item} id={`java-${item}-tab`} role="tab" aria-controls={`java-${item}-panel`} aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => onTab(item)}>{t(item === 'general' ? 'Genel' : 'Kurulumlar')}</button>)}</div></header>
    {tab === 'general' ? <div className="java-preferences-body" id="java-general-panel" role="tabpanel" aria-labelledby="java-general-tab">
      <section className="java-preference-option"><label htmlFor="java-custom-path">{t('Özel Java yolu')}</label><div className="java-executable-field"><input id="java-custom-path" value={settings.javaPath} onChange={event => onChange({ javaPath: event.target.value })} placeholder={t('Otomatik algıla')} /><button type="button" onClick={onBrowse}><FolderOpen size={17} />{t('Java seç')}</button></div><p>{t('Boş bırakırsan oyun için uygun Java otomatik seçilir. Profile özel Java ayarı bu terciğin önüne geçer.')}</p></section>
      <div className="java-preference-divider" role="separator" />
      <section className="java-preference-option"><div className="java-memory-heading"><label htmlFor="java-default-memory">{t('Varsayılan bellek')}</label><span>{memoryGb(settings.memoryMb)} GB <small>· {settings.memoryMb} MB</small></span></div><p>{t('Yeni profillerin başlangıç değerleri')}</p><input id="java-default-memory" className="java-memory-range" type="range" min="1024" max="16384" step="512" value={settings.memoryMb} onChange={event => onChange({ memoryMb: Number(event.target.value) })} /><div className="java-memory-scale" aria-hidden="true">{[1, 4, 8, 12, 16].map(gb => <span key={gb} style={{ left: `${(gb - 1) / 15 * 100}%` }}>{gb} GB</span>)}</div></section>
    </div> : <div className="java-preferences-body" id="java-installations-panel" role="tabpanel" aria-labelledby="java-installations-tab">
      <div className="java-installations-heading"><div><h4>{t('Java kurulumları')}</h4><p>{t('Bilgisayarında bulunan ve launcher tarafından kurulan sürümler.')}</p></div><button type="button" className="java-rescan" disabled={loading || busy} onClick={onRescan}>{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{t('Yeniden tara')}</button></div>
      {loading ? <p className="java-installations-empty"><LoaderCircle className="spin" size={18} />{t('Java kurulumları aranıyor...')}</p> : runtimes.length ? <ul className="java-installations-list">{runtimes.map(item => <li key={item.path}><img src={javaIcon} alt="" draggable={false} /><div className="java-installation-copy"><div><strong>Java {item.version}</strong><span>{t(item.source === 'Launcher tarafından kuruldu' ? 'Launcher tarafından kuruldu' : 'Bilgisayarda bulundu')}</span></div><code title={item.path}>{item.path}</code></div><div className="java-installation-actions"><button type="button" title={t('Dosya konumunda aç')} aria-label={`Java ${item.version}: ${t('Dosya konumunda aç')}`} onClick={() => onOpen(item.path)}><FolderOpen size={18} /></button>{item.source === 'Launcher tarafından kuruldu' && <button type="button" className="java-installation-delete" disabled={busy || !!deletingPath} title={t('Java kurulumunu kaldır')} aria-label={`Java ${item.version}: ${t('Java kurulumunu kaldır')}`} onClick={() => onDelete(item)}>{deletingPath === item.path ? <LoaderCircle className="spin" size={18} /> : <Trash2 size={18} />}</button>}</div></li>)}</ul> : <p className="java-installations-empty">{t('Java bulunamadı. Oyun açılırken uygun sürüm otomatik kurulabilir.')}</p>}
    </div>}
  </section>
}
