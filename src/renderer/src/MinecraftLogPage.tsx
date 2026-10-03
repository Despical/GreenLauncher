import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLine, Check, Copy, LoaderCircle, Search, Terminal, Trash2, Upload } from 'lucide-react'
import type { GameLogLine, GameLogSnapshot, LauncherProfile, RunningInstance } from '../../shared/types'
import { diagnoseError } from '../../shared/errors'
import { translate, type Language } from './i18n'
import './minecraft-log.css'

export function MinecraftLogPage({ profile, language, isVisible, instances, onNotice, sessionPicker }: {
  profile: LauncherProfile; language: Language; isVisible: boolean; instances: RunningInstance[]
  onNotice: (message: string) => void
  sessionPicker: (value: string, options: Array<{ value: string; label: string; detail?: string }>, onChange: (value: string) => void) => ReactNode
}) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [snapshot, setSnapshot] = useState<GameLogSnapshot | null>(null)
  const current = useRef(snapshot); current.current = snapshot
  const [choice, setChoice] = useState('')
  const lastChoice = useRef('')
  const [follow, setFollow] = useState(true), [wrap, setWrap] = useState(true), [colors, setColors] = useState(true)
  const [query, setQuery] = useState(''), [found, setFound] = useState<number | null>(null)
  const [error, setError] = useState(''), [pending, setPending] = useState<'copy' | 'upload' | 'clear' | null>(null)
  const [retry, setRetry] = useState(0)
  const lastRetry = useRef(0)
  const busy = useRef(false), consoleRef = useRef<HTMLDivElement>(null), atBottom = useRef(true)
  const instanceIds = instances.filter(instance => instance.profileId === profile.id).map(instance => instance.id).join('|')

  const apply = (next: GameLogSnapshot) => {
    const previous = current.current
    const same = next.session?.instance.id === previous?.session?.instance.id
    if (same && previous && next.revision < previous.revision) return
    const retained = same ? previous?.lines.filter(line => line.seq >= next.firstSeq) ?? [] : []
    const lastSeq = retained.at(-1)?.seq ?? 0
    const combined = { ...next, lines: [...retained, ...next.lines.filter(line => line.seq > lastSeq)] }
    current.current = combined; setSnapshot(combined)
  }
  useEffect(() => {
    if (!isVisible) return
    let active = true, reading = false, again = false, latest = false
    const read = async (selectLatest = false) => {
      latest ||= selectLatest
      if (reading) { again = true; return }
      reading = true
      do {
        again = false
        const previous = current.current
        const id = choice || (latest ? undefined : previous?.session?.instance.id)
        latest = false
        try {
          const next = await window.launcher.getGameLog(profile.id, id, id === previous?.session?.instance.id ? (previous?.nextSeq ?? 1) - 1 : 0)
          if (active) { apply(next); setError('') }
        } catch (failure) { if (active) setError(diagnoseError(failure).message) }
      } while (active && again)
      reading = false
    }
    const off = window.launcher.on('gameLog', change => {
      if (change.profileId === profile.id && follow) void read(!choice && change.instanceId !== current.current?.session?.instance.id)
    })
    if (follow || !current.current || lastChoice.current !== choice || lastRetry.current !== retry) void read(!choice)
    lastChoice.current = choice
    lastRetry.current = retry
    return () => { active = false; off() }
  }, [profile.id, choice, isVisible, follow, instanceIds, retry])
  const lines = snapshot?.lines ?? []
  const needle = query.trim().toLocaleLowerCase()
  const matches = useMemo(() => needle ? lines.filter(line => line.text.toLocaleLowerCase().includes(needle)) : [], [lines, needle])
  const chunks = useMemo(() => {
    const result: GameLogLine[][] = []
    for (let i = 0; i < lines.length; i += 200) result.push(lines.slice(i, i + 200))
    return result
  }, [lines])
  const bottom = () => { atBottom.current = true; if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight }
  useLayoutEffect(() => { if (isVisible && atBottom.current) bottom() }, [snapshot?.revision, snapshot?.session?.instance.id, isVisible, wrap])
  const find = () => {
    if (!matches.length) { onNotice(t('Eşleşme bulunamadı.')); return }
    const index = matches.findIndex(line => line.seq === found)
    const next = matches[(index + 1) % matches.length]
    setFound(next.seq); atBottom.current = false
    consoleRef.current?.querySelector<HTMLElement>(`[data-seq="${next.seq}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }
  const act = async (kind: 'copy' | 'upload' | 'clear') => {
    const id = current.current?.session?.instance.id
    if (!id || busy.current) return
    busy.current = true; setPending(kind)
    try {
      if (kind === 'clear') {
        const next = await window.launcher.clearGameLog(profile.id, id)
        current.current = next; setSnapshot(next); setFound(null); atBottom.current = true
      } else if (kind === 'copy') { await window.launcher.copyGameLog(profile.id, id); onNotice(t('Günlük panoya kopyalandı.')) }
      else { await window.launcher.uploadGameLog(profile.id, id); onNotice(t('Günlük yüklendi. Bağlantı panoya kopyalandı.')) }
    } catch (failure) { onNotice(t(diagnoseError(failure).message)) }
    finally { busy.current = false; setPending(null) }
  }
  const checkbox = (label: string, value: boolean, change: () => void) => <button type="button" role="checkbox" aria-checked={value} className="minecraft-log-check" onClick={change}><span className="profile-checkbox" aria-hidden="true">{value && <Check size={13} strokeWidth={3} />}</span>{t(label)}</button>
  const highlighted = (line: GameLogLine) => {
    if (!needle) return line.text || '\u00a0'
    const pieces: ReactNode[] = [], lower = line.text.toLocaleLowerCase()
    let start = 0, index: number
    while ((index = lower.indexOf(needle, start)) >= 0) { pieces.push(line.text.slice(start, index), <mark key={index}>{line.text.slice(index, index + needle.length)}</mark>); start = index + needle.length }
    pieces.push(line.text.slice(start)); return pieces
  }
  return <div className="content-page minecraft-log-page">
    <div className="page-heading"><div><h2>{t('Minecraft günlüğü')}</h2><p>{t('Bu profilin oyun çıktısını anlık olarak takip et.')}</p></div><button className="heading-action minecraft-log-upload-action" disabled={!lines.length || !!pending} onClick={() => void act('upload')}>{pending === 'upload' ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{t('Yükle')}</button></div>
    <div className="minecraft-log-panel">
      <div className="minecraft-log-toolbar">
        <div className="minecraft-log-context">
          {snapshot && snapshot.sessions.length > 1
            ? sessionPicker(choice || snapshot.session?.instance.id || '', snapshot.sessions.map(session => ({ value: session.instance.id, label: `${new Date(session.instance.startedAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · PID ${session.instance.pid}`, detail: t(session.running ? 'Oyun çalışıyor' : 'Oyun kapandı') })), value => { setChoice(value); setFound(null); atBottom.current = true })
            : <span className={`minecraft-log-state${snapshot?.session?.running ? ' running' : ''}`}><span aria-hidden="true" />{t(snapshot?.session ? snapshot.session.running ? 'Oyun çalışıyor' : 'Oyun kapandı' : 'Oyun çıktısı bekleniyor...')}</span>}
        </div>
        <div className="minecraft-log-search"><div className="minecraft-log-search-field"><Search size={17} aria-hidden="true" /><input aria-label={t('Günlükte ara')} placeholder={t('Günlükte ara')} value={query} onChange={event => { setQuery(event.target.value); setFound(null) }} onKeyDown={event => { if (event.key === 'Enter' && needle) find() }} /></div><button disabled={!needle || !lines.length} onClick={find}>{t('Bul')}</button></div>
      </div>
      {error && <div className="minecraft-log-error" role="alert">{t(error)}<button onClick={() => setRetry(retry + 1)}>{t('Yeniden dene')}</button></div>}
      <div ref={consoleRef} className={`minecraft-console${wrap ? ' wrap' : ''}${colors ? ' colored' : ''}`} role="log" aria-label={t('Minecraft günlüğü')} aria-live="off" tabIndex={0} onScroll={event => { const node = event.currentTarget; atBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 36 }}>
        {!lines.length ? <div className="minecraft-console-empty"><Terminal size={28} aria-hidden="true" /><h3>{t('Henüz günlük yok')}</h3><p>{t(snapshot?.session ? 'Yeni oyun çıktıları burada görünecek.' : 'Bu profil başlatıldığında oyun çıktıları burada görünecek.')}</p></div> : chunks.map(chunk => <div className="minecraft-log-chunk" key={chunk[0].seq}>{chunk.map(line => <div className={`minecraft-console-line level-${line.level}${found === line.seq ? ' found' : ''}`} key={line.seq} data-seq={line.seq}><span className="minecraft-line-text">{highlighted(line)}</span></div>)}</div>)}
      </div>
      <div className="minecraft-log-footer"><div className="minecraft-log-options">{checkbox('Güncellemeye devam et', follow, () => setFollow(!follow))}{checkbox('Satırları kaydır', wrap, () => setWrap(!wrap))}{checkbox('Satırları renklendir', colors, () => setColors(!colors))}</div><div className="minecraft-log-actions"><button className="minecraft-log-copy" disabled={!lines.length || !!pending} onClick={() => void act('copy')}>{pending === 'copy' ? <LoaderCircle className="spin" size={16} /> : <Copy size={16} />}{t('Kopyala')}</button><button className="minecraft-log-clear" disabled={!lines.length || !!pending} onClick={() => void act('clear')}><Trash2 size={16} />{t('Temizle')}</button><button className="minecraft-log-bottom" onClick={bottom}><ArrowDownToLine size={16} />{t('En altta')}</button></div></div>
      {!!snapshot?.dropped && <p className="minecraft-log-limit">{t('{count} eski satır bellek sınırı nedeniyle kaldırıldı.', { count: snapshot.dropped })}</p>}
    </div>
  </div>
}
