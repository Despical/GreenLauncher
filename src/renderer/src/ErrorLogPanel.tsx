import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, FileText, FolderOpen, Search, Trash2, X } from 'lucide-react'
import type { LauncherErrorEntry } from '../../shared/types'
import { translate, type Language } from './i18n'
import { DropdownOptions } from './DropdownOptions'
import './logs.css'

type Props = {
  entries: LauncherErrorEntry[]
  language: Language
  onOpenFile: () => void
  onClear: () => Promise<void>
}

export function ErrorLogPanel({ entries, language, onOpenFile, onClear }: Props) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [clearing, setClearing] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const sourceRef = useRef<HTMLDivElement>(null)
  const sources = useMemo(() => [...new Set(entries.map(entry => entry.source))].sort((a, b) => a.localeCompare(b, language)), [entries, language])
  const activeSource = sources.includes(source) ? source : ''
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase(language)
    return entries.filter(entry => (!activeSource || entry.source === activeSource) &&
      (!search || `${entry.message} ${entry.code} ${entry.source}`.toLocaleLowerCase(language).includes(search)))
  }, [entries, query, activeSource, language])
  const formatter = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' }), [language])
  const groupDate = (at: string) => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' }) : at
  const shortTime = (at: string) => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) : '—'
  const category = (entry: LauncherErrorEntry) => t(/import|export|clone|repair|profile/.test(entry.source) ? 'Profil işlemi' : /install|download/.test(entry.source) ? 'Kurulum' : /oturum|hesap|giriş|sign|account|auth|xbox|microsoft/i.test(entry.source) ? 'Oturum' : /play|game|oyun/i.test(entry.source) ? 'Oyun' : 'Uygulama')
  const formatTime = (at: string) => Number.isFinite(Date.parse(at)) ? formatter.format(new Date(at)) : at

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!sourceRef.current?.contains(event.target as Node)) setSourceOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setSourceOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])

  const navigateRecords = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.log-record')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    buttons[next].focus()
  }


  return <section className="settings-panel settings-tab-panel journal-panel" role="tabpanel" aria-label={t('Hata günlükleri')}>
    <header className="settings-panel-head"><div className="setting-icon"><FileText size={28} /></div><div><h3>{t('Hata günlükleri')}</h3><p>{t('Başlatma ve oturum sorunlarını tek yerden incele.')}</p></div><button className="journal-button" onClick={onOpenFile}><FolderOpen size={16} />{t('Günlük dosyasını aç')}</button></header>
    <div className="journal-toolbar">
      <div className="journal-search"><Search size={16} aria-hidden="true" /><input aria-label={t('Günlüklerde ara')} placeholder={t('Mesaj, kaynak veya hata kodu ara')} value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label={t('Aramayı temizle')} onClick={() => setQuery('')}><X size={15} /></button>}</div>
      <div className="journal-source" ref={sourceRef}><button type="button" className="journal-source-trigger" aria-label={t('Kayıt kaynağı')} aria-haspopup="listbox" aria-expanded={sourceOpen} onClick={() => setSourceOpen(open => !open)}><span>{activeSource || t('Tüm kaynaklar')}</span><ChevronDown size={15} /></button>{sourceOpen && <div className="journal-source-menu" role="listbox" aria-label={t('Kayıt kaynağı')}><DropdownOptions>{['', ...sources].map(item => <button type="button" key={item} role="option" aria-selected={activeSource === item} onClick={() => { setSource(item); setSourceOpen(false) }}><span>{item || t('Tüm kaynaklar')}</span></button>)}</DropdownOptions></div>}</div>
    </div>
    <div className="journal-records" role="group" aria-label={t('Hata günlükleri')} onKeyDown={navigateRecords}>
      {filtered.map((entry, index) => <Fragment key={entry.id}>
        {(index === 0 || groupDate(entry.at) !== groupDate(filtered[index - 1].at)) && <div className="journal-day"><span>{groupDate(entry.at)}</span></div>}
        <article className={expandedIds.has(entry.id) ? 'journal-entry expanded' : 'journal-entry'}>
          <button className="log-record journal-entry-trigger" aria-expanded={expandedIds.has(entry.id)} onClick={() => setExpandedIds(current => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next })}><span className="journal-time">{shortTime(entry.at)}</span><span className="journal-entry-copy"><strong>{category(entry)}</strong><span>{entry.message}</span></span><ChevronDown size={17} /></button>
          {expandedIds.has(entry.id) && <div className="journal-entry-detail"><time dateTime={entry.at}>{formatTime(entry.at)}</time><p>{entry.message}</p><dl><div><dt>{t('Kaynak')}</dt><dd>{entry.source}</dd></div><div><dt>{t('Hata kodu')}</dt><dd><code>{entry.code}</code></dd></div></dl></div>}
        </article>
      </Fragment>)}
    </div>
    {!filtered.length && <div className="journal-empty"><FileText size={30} /><h4>{t(entries.length ? 'Eşleşen kayıt bulunamadı' : 'Henüz kayıtlı bir hata yok.')}</h4><p>{t(entries.length ? 'Farklı bir arama dene veya filtreleri temizle.' : 'Bir sorun oluşursa ayrıntıları burada görünür.')}</p>{entries.length > 0 && <button className="journal-button" onClick={() => { setQuery(''); setSource('') }}>{t('Filtreleri temizle')}</button>}</div>}
    <footer className="journal-footer"><button className="journal-button journal-clear" disabled={clearing || !entries.length} onClick={async () => { setClearing(true); try { await onClear() } finally { setClearing(false) } }}><Trash2 size={16} />{t('Günlükleri temizle')}</button></footer>
  </section>
}
