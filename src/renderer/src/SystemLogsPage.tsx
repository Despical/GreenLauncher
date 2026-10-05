import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Check, Copy, FileText, LoaderCircle, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import type { LauncherProfile, SystemLogDocument, SystemLogFile } from '../../shared/types'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import './minecraft-log.css'
import './system-logs.css'

export function SystemLogsPage({ profile, language, isVisible, running, onNotice, picker }: {
  profile: LauncherProfile; language: Language; isVisible: boolean; running: boolean; onNotice: (text: string) => void
  picker: (value: string, options: Array<{ value: string; label: string; detail?: string }>, onChange: (value: string) => void, disabled?: boolean) => ReactNode
}) {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const [files, setFiles] = useState<SystemLogFile[]>([]), [selected, setSelected] = useState(''), [document, setDocument] = useState<SystemLogDocument | null>(null)
  const [revision, refresh] = useState(0), [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('')
  const [wrap, setWrap] = useState(true), [colors, setColors] = useState(true), [query, setQuery] = useState(''), [found, setFound] = useState(0)
  const [confirm, setConfirm] = useState<{ action: 'delete' | 'upload'; filenames: string[] } | null>(null), [uploaded, setUploaded] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null), action = useRef(false), alive = useRef(true)
  const selectedFile = useRef(''), refreshNotice = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!isVisible) return
    let cancelled = false
    setLoading(true); setError(''); setUploaded('')
    void (async () => {
      try {
        const items = await window.launcher.getSystemLogFiles(profile.id)
        if (cancelled) return
        const filename = items.some(file => file.filename === selectedFile.current) ? selectedFile.current : items[0]?.filename ?? ''
        setFiles(items); selectedFile.current = filename; setSelected(filename)
        const value = filename ? await window.launcher.getSystemLog(profile.id, filename) : null
        if (cancelled) return
        setDocument(value); setFound(0)
        if (refreshNotice.current) { refreshNotice.current = false; onNotice(t('Kayıtlar yenilendi.')) }
      } catch (reason) {
        if (!cancelled) { refreshNotice.current = false; setDocument(null); setError(String((reason as Error).message ?? reason)) }
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [profile.id, revision, isVisible])
  const lines = document?.filename === selected ? document.lines : []
  const chunks = useMemo(() => { const result: typeof lines[] = []; for (let index = 0; index < lines.length; index += 200) result.push(lines.slice(index, index + 200)); return result }, [lines])
  const matches = useMemo(() => query ? lines.filter(line => line.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(line => line.seq) : [], [lines, query])
  const find = () => { const seq = matches[(matches.indexOf(found) + 1) % matches.length]; if (!seq) return; setFound(seq); consoleRef.current?.querySelector(`[data-seq="${seq}"]`)?.scrollIntoView({ block: 'center' }) }
  const bottom = () => { const node = consoleRef.current; if (node) node.scrollTop = node.scrollHeight }
  const act = async (kind: 'copy' | 'delete' | 'upload', filenames = [selected]) => {
    if (action.current || !filenames[0]) return
    action.current = true; setPending(true); setError('')
    try {
      if (kind === 'copy') { await window.launcher.copySystemLog(profile.id, filenames[0]); if (alive.current) onNotice(t('Günlük kopyalandı.')) }
      else if (kind === 'upload') { const url = await window.launcher.uploadSystemLog(profile.id, filenames[0]); if (alive.current) { setUploaded(url); onNotice(t('Günlük mclo.gs’a yüklendi.')) } }
      else { await window.launcher.deleteSystemLogs(profile.id, filenames); if (alive.current) { setDocument(null); selectedFile.current = ''; setSelected(''); refresh(value => value + 1); onNotice(t('Günlük dosyaları silindi.')) } }
      if (alive.current) setConfirm(null)
    } catch (reason) { if (alive.current) setError(String((reason as Error).message ?? reason)) }
    finally { action.current = false; if (alive.current) setPending(false) }
  }
  const checkbox = (label: string, checked: boolean, toggle: () => void) => <button type="button" role="checkbox" aria-checked={checked} className="minecraft-log-check" onClick={toggle}><span className="profile-checkbox" aria-hidden="true">{checked && <Check size={13} strokeWidth={3} />}</span>{t(label)}</button>
  return <div className="content-page minecraft-log-page system-logs-page">
    <div className="page-heading"><div><h2>{t('Diğer sistem kayıtları')}</h2><p>{t('Arşivlenmiş oyun günlüklerini ve çökme raporlarını incele.')}</p></div><div className="servers-heading-actions"><button className="heading-action" disabled={pending || loading} onClick={() => { refreshNotice.current = true; setLoading(true); refresh(value => value + 1) }}><RefreshCw size={17} />{t('Yenile')}</button><button className="heading-action minecraft-log-upload-action" disabled={!lines.length || pending || loading} onClick={() => setConfirm({ action: 'upload', filenames: [selected] })}>{pending ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{t('Yükle')}</button></div></div>
    <div className="minecraft-log-panel">
      <div className="minecraft-log-toolbar">
        <div className="minecraft-log-context">{picker(selected, files.map(file => ({ value: file.filename, label: file.filename, detail: `${(file.bytes / 1024).toFixed(1)} KB · ${new Date(file.modifiedAt).toLocaleString(language)}` })), value => { selectedFile.current = value; setSelected(value); setConfirm(null); refresh(revision => revision + 1) }, pending || loading)}</div>
        <div className="minecraft-log-search"><div className="minecraft-log-search-field"><Search size={17} aria-hidden="true" /><input value={query} onChange={event => { setQuery(event.target.value); setFound(0) }} onKeyDown={event => { if (event.key === 'Enter') find() }} placeholder={t('Günlükte ara')} aria-label={t('Günlükte ara')} /></div><button disabled={!matches.length} onClick={find}>{t('Bul')}</button></div>
      </div>
      {error && <div className="minecraft-log-error" role="alert">{t(error)}</div>}
      {uploaded && <a className="system-log-upload" href={uploaded} onClick={event => { event.preventDefault(); void window.launcher.openExternal(uploaded) }}>{uploaded}</a>}
      {loading && <div className="system-log-loading" role="status"><LoaderCircle className="spin" size={16} />{t('Yükleniyor...')}</div>}
      <div ref={consoleRef} className={`minecraft-console${!lines.length ? ' empty' : ''}${wrap ? ' wrap' : ''}${colors ? ' colored' : ''}`} role="log" aria-label={t('Diğer sistem kayıtları')} tabIndex={0}>
        {!lines.length && !loading ? <div className="minecraft-console-empty"><FileText size={28} /><h3>{t('Henüz günlük yok')}</h3><p>{t('Bu profilin günlük dosyaları burada görünecek.')}</p></div> : chunks.map(chunk => <div className="minecraft-log-chunk" key={chunk[0].seq}>{chunk.map(line => <div className={`minecraft-console-line level-${line.level}${found === line.seq ? ' found' : ''}`} key={line.seq} data-seq={line.seq}><span className="minecraft-line-number">{line.seq}</span><span className="minecraft-line-text">{line.text}</span></div>)}</div>)}
      </div>
      {document?.truncated && <p className="minecraft-log-limit">{t('Büyük günlük dosyasının son satırları gösteriliyor.')}</p>}
      <div className="minecraft-log-footer"><div className="minecraft-log-options">{checkbox('Satırları kaydır', wrap, () => setWrap(!wrap))}{checkbox('Satırları renklendir', colors, () => setColors(!colors))}</div><div className="minecraft-log-actions"><button className="minecraft-log-copy" disabled={!lines.length || pending || loading} onClick={() => void act('copy')}><Copy size={16} />{t('Kopyala')}</button><button className="system-log-delete-selected" disabled={!selected || running || pending || loading} onClick={() => setConfirm({ action: 'delete', filenames: [selected] })}><Trash2 size={16} />{t('Seçileni sil')}</button><button className="system-log-delete-all" disabled={!files.length || running || pending || loading} onClick={() => setConfirm({ action: 'delete', filenames: files.map(file => file.filename) })}>{t('Hepsini sil')}</button><button className="minecraft-log-bottom" disabled={!lines.length} onClick={bottom}><ArrowDownToLine size={16} />{t('En altta')}</button></div></div>

    </div>
    {confirm && <AccountDialog locked={pending} title={t(confirm.action === 'upload' ? 'Günlüğü yüklemek istediğine emin misin?' : 'Günlük dosyaları silinsin mi?')} description={confirm.action === 'upload' ? t('Seçili günlük api.mclo.gs’ye yüklenir. Paylaşmadan önce kişisel bilgileri kontrol et.') : t('{count} günlük dosyası kalıcı olarak silinecek.', { count: confirm.filenames.length })} closeLabel={t('Kapat')} onClose={() => { if (!pending) setConfirm(null) }} className="system-log-confirm">{confirm.action === 'delete' && <ul className="system-log-delete-list" aria-label={t('Günlük dosyaları')}>{confirm.filenames.map(filename => <li key={filename}>{filename}</li>)}</ul>}<div className="modal-actions"><div className="spacer" /><button className="secondary" disabled={pending} onClick={() => setConfirm(null)}>{t('Vazgeç')}</button><button className={confirm.action === 'upload' ? 'modal-primary' : 'delete-button'} disabled={pending || confirm.action === 'delete' && running} onClick={() => void act(confirm.action, confirm.filenames)}>{pending ? <LoaderCircle className="spin" size={16} /> : null}{t(confirm.action === 'upload' ? 'Yükle' : 'Sil')}</button></div>{error && <p role="alert">{t(error)}</p>}</AccountDialog>}
  </div>
}
