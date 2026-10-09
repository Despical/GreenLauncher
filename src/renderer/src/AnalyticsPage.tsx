import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Activity, ArrowLeft, ArrowRight, BarChart3, CalendarDays, Clock3, Flame, Info, Timer, Trophy } from 'lucide-react'
import type { LauncherProfile, LauncherState, RunningInstance } from '../../shared/types'
import { localDayKey, playAnalytics, type AnalyticsBucket, type AnalyticsPeriod } from '../../shared/play-analytics'
import { profilePlaytime } from '../../shared/profile-settings'
import { translate, type Language } from './i18n'
import { playDuration } from './Playtime'
import { ProfileIcon } from './ProfileIcon'
import './analytics.css'

type Picker = (value: string, options: Array<{ value: string; label: string; icon?: ReactNode }>, onChange: (id: string) => void) => ReactNode
const locales = { tr: 'tr-TR', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', ru: 'ru-RU', pl: 'pl-PL' }
const periods: AnalyticsPeriod[] = ['7d', '30d', '90d', 'all']
interface HoverTip { source: 'chart' | 'calendar'; label: string; durationMs: number; sessions?: number; x: number; y: number }

export function AnalyticsPage({ state, language, instances, profile, picker, onProfile, onSettings, isVisible }: {
  state: LauncherState; language: Language; instances: RunningInstance[]; profile?: LauncherProfile; picker: Picker
  onProfile: (id: string) => void; onSettings: (id?: string) => void; isVisible: boolean
}) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const formats = useMemo(() => {
    const locale = locales[language]
    return {
      date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
      fullDate: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }),
      shortWeekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }),
      monthYear: new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }),
      year: new Intl.DateTimeFormat(locale, { year: 'numeric' }),
      session: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      number: new Intl.NumberFormat(locale),
      axis: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
    }
  }, [language])
  const [period, setPeriod] = useState<AnalyticsPeriod>('30d')
  const [filter, setFilter] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [hovered, setHovered] = useState<number | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<HoverTip | null>(null)
  const tooltipId = useId()
  const chart = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(800)
  const [limit, setLimit] = useState(8)
  const scope = profile?.id ?? (state.profiles.some(item => item.id === filter) ? filter : '')
  const scopedProfile = state.profiles.find(item => item.id === scope)
  useEffect(() => {
    if (!isVisible) return
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [isVisible])
  useEffect(() => { if (isVisible) setNow(new Date()) }, [state.playSessions, isVisible])
  useEffect(() => { setHovered(null); setSelectedDay(null); setTooltip(null); setLimit(8) }, [period, scope, state.selectedAccountId])
  useEffect(() => { setFilter('') }, [state.selectedAccountId])
  useEffect(() => { if (!isVisible) setTooltip(null) }, [isVisible])
  useEffect(() => {
    const close = () => setTooltip(null)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', escape) }
  }, [])
  const data = useMemo(() => playAnalytics(state.profiles, state.playSessions ?? [], period, scope, now), [state.profiles, state.playSessions, period, scope, now])
  const calendarData = useMemo(() => playAnalytics(state.profiles, state.playSessions ?? [], '365d', scope, now), [state.profiles, state.playSessions, scope, now])
  useLayoutEffect(() => {
    const element = chart.current
    if (!element || !isVisible) return
    const measure = () => setChartWidth(element.getBoundingClientRect().width || 800)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [isVisible, data.total > 0])
  const duration = (value: number) => playDuration(value, language)
  const number = (value: number) => formats.number.format(value)
  const formatDate = (value: number, full = false) => (full ? formats.fullDate : formats.date).format(value)
  const weekday = (index: number, short = false) => (short ? formats.shortWeekday : formats.weekday).format(new Date(2026, 0, 5 + index))
  const periodName = (value: AnalyticsPeriod) => value === '7d' ? t('Son 7 gün') : value === '30d' ? t('Son 30 gün') : value === '90d' ? t('Son 90 gün') : t('Tüm zamanlar')
  const visibleIds = new Set(state.profiles.map(item => item.id))
  const running = new Set(instances.filter(item => item.profileId && visibleIds.has(item.profileId) && (!scope || item.profileId === scope)).map(item => item.id))
  const memoryOnly = (scopedProfile ? [scopedProfile] : state.profiles).some(item => !profilePlaytime(item, state.settings, 'savePlaytime'))
  const history = selectedDay ? calendarData.sessions.filter(session => {
    const day = calendarData.calendar.find(item => item.key === selectedDay)
    if (!day) return false
    const end = new Date(day.date); end.setDate(end.getDate() + 1)
    return Date.parse(session.startedAt) < end.getTime() && Date.parse(session.endedAt) > day.date
  }) : data.sessions
  const max = Math.max(...data.buckets.map(bucket => bucket.durationMs), 60_000)
  const axisUnit = max <= 3_600_000 ? 60_000 : 3_600_000
  const rawStep = max / axisUnit / 4, magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const niceMax = ([1, 2, 5, 10].find(step => step * magnitude >= rawStep) ?? 10) * magnitude * 4 * axisUnit
  const axis = (value: number) => {
    const amount = formats.axis.format(value / axisUnit)
    return axisUnit === 60_000 ? t('{minutes} dk', { minutes: amount }) : t('{hours} sa', { hours: amount })
  }
  const bucketLabel = (bucket: AnalyticsBucket) => data.unit === 'day' ? formatDate(bucket.from, true) : `${formatDate(bucket.from)} – ${formatDate(Math.max(bucket.from, bucket.to - 1), true)}`
  const tickLabel = (value: number) => data.unit === 'year' ? formats.year.format(value) : data.unit === 'month' ? formats.monthYear.format(value) : formatDate(value)
  const chartIndex = hovered !== null && data.buckets[hovered] ? hovered : Math.max(0, data.buckets.findIndex(bucket => data.bestDay && data.bestDay.date >= bucket.from && data.bestDay.date < bucket.to))
  const chartBucket = data.buckets[chartIndex]
  const peak = Math.max(...data.weekdays.map(day => day.durationMs), 1)
  const calendarPeak = Math.max(...calendarData.calendar.map(day => day.durationMs), 1)
  const calendarWeeks = calendarData.calendar.length / 7
  const hover = (source: HoverTip['source'], label: string, durationMs: number, target: Element, sessions?: number) => {
    const rect = target.getBoundingClientRect()
    const x = Math.min(Math.max(12, rect.left + rect.width / 2 - 129), window.innerWidth - 270)
    const y = source === 'chart' ? rect.top + 12 : rect.bottom + 10
    const top = y > window.innerHeight - 120 ? Math.max(12, rect.top - 110) : Math.max(12, y)
    setTooltip(previous => previous?.source === source && previous.label === label && previous.durationMs === durationMs && previous.sessions === sessions && previous.x === x && previous.y === top ? previous : { source, label, durationMs, x, y: top, sessions })
  }
  const sessionDuration = (session: typeof data.sessions[number]) => {
    const day = calendarData.calendar.find(item => item.key === selectedDay)
    if (!day) return session.playedMs
    const next = new Date(day.date); next.setDate(next.getDate() + 1)
    const start = Date.parse(session.startedAt), end = Date.parse(session.endedAt)
    return session.durationMs * Math.max(0, Math.min(end, next.getTime(), data.to) - Math.max(start, day.date)) / (end - start)
  }
  const metric = (icon: ReactNode, label: string, value: string, detail: string) => <article className="analytics-metric"><div className="analytics-metric-label">{icon}<span>{label}</span></div><strong>{value}</strong><small>{detail}</small></article>
  return <div className="content-page analytics-page" data-scope={scope || 'all'} data-period={period}>
    <div className="page-heading analytics-heading"><div><h2>{t('Analiz')}</h2><p>{profile ? t('{profile} profilindeki oyun alışkanlıkların.', { profile: profile.name }) : t('Oyun süreni, profillerini ve günlük alışkanlıklarını keşfet.')}</p></div>{running.size > 0 && <span className="analytics-live"><Activity size={14} />{t('{count} oyun çalışıyor', { count: running.size })}</span>}</div>
    <div className="analytics-toolbar">
      {!profile && <div className="analytics-profile-filter"><label>{t('Profil')}</label>{picker(scope, [{ value: '', label: t('Tüm profiller'), icon: <BarChart3 size={18} /> }, ...state.profiles.map(item => ({ value: item.id, label: item.name, icon: <span className="analytics-picker-icon"><ProfileIcon profile={item} /></span> }))], setFilter)}</div>}
      <div className="analytics-period-filter"><span>{t('Zaman aralığı')}</span><div className="analytics-periods" role="group" aria-label={t('Zaman aralığı')}>{periods.map(value => <button key={value} aria-pressed={value === period} className={value === period ? 'active' : ''} onClick={() => setPeriod(value)}>{periodName(value)}</button>)}</div></div>
      <span className="analytics-date-range">{formatDate(data.from, new Date(data.from).getFullYear() !== now.getFullYear())} – {formatDate(data.to, true)}</span>
    </div>
    <div className="analytics-metrics">
      {metric(<Clock3 size={16} />, t('Oyun süresi'), duration(data.total), t('Seçili zaman aralığında'))}
      {metric(<Timer size={16} />, t('Oyun oturumları'), number(data.sessions.length), t('Ölçülen oyun oturumu'))}
      {metric(<CalendarDays size={16} />, t('Oynanan günler'), number(data.activeDays), t('En az bir kez oynadığın gün'))}
      {metric(<Activity size={16} />, t('Ortalama oturum'), duration(data.average), t('Oturum başına oyun süresi'))}
    </div>
    {memoryOnly && <div className="analytics-notice"><Info size={17} /><p>{t('Bazı profillerde süreyi kaydetme kapalı. Bu profillerin mevcut oturum kayıtları launcher kapandığında silinir.')}</p><button onClick={() => onSettings(scope || undefined)}>{t('Süre ayarları')}<ArrowRight size={14} /></button></div>}
    {data.total === 0 ? <section className="analytics-empty"><BarChart3 size={36} /><h3>{t('Bu zaman aralığında oyun kaydı yok')}</h3><p>{t('Bir profil üzerinden Minecraft oynadığında gerçek oyun süren ve alışkanlıkların burada görünür. Geçmişte ölçülmeyen süreler eklenmez.')}</p>{period !== 'all' && <button className="heading-action" onClick={() => setPeriod('all')}>{t('Tüm zamanları göster')}<ArrowRight size={15} /></button>}</section> : <>
      <section className="analytics-panel analytics-trend"><div className="analytics-panel-heading"><div><h3>{t('Oyun süresi dağılımı')}</h3><p>{data.unit === 'day' ? t('Günlük oyun süren') : data.unit === 'week' ? t('Haftalık oyun süren') : data.unit === 'month' ? t('Aylık oyun süren') : t('Yıllık oyun süren')}</p></div><span>{periodName(period)}</span></div>
        <div ref={chart} className="analytics-chart" style={{ '--analytics-axis-font': `${13 * 800 / chartWidth}px` } as CSSProperties} onMouseLeave={() => setTooltip(null)}><svg viewBox="0 0 800 230" role="group" aria-label={t('Oyun süresi dağılımı')}>
          {[0, 1, 2, 3, 4].map(tick => <g key={tick} aria-hidden="true"><line x1="62" x2="794" y1={184 - tick * 40} y2={184 - tick * 40} className="analytics-gridline" /><text x="51" y={188 - tick * 40} textAnchor="end">{axis(niceMax * tick / 4)}</text></g>)}
          {data.buckets.map((bucket, index) => { const step = 730 / data.buckets.length, height = bucket.durationMs / niceMax * 160; return <g key={bucket.from}>
            <rect x={63 + index * step} y="20" width={step} height="166" fill="transparent" tabIndex={0} role="button" aria-label={`${bucketLabel(bucket)}: ${duration(bucket.durationMs)}`} aria-describedby={tooltip?.source === 'chart' && chartIndex === index ? tooltipId : undefined}
              onMouseEnter={event => { setHovered(index); hover('chart', bucketLabel(bucket), bucket.durationMs, event.currentTarget) }}
              onFocus={event => { setHovered(index); hover('chart', bucketLabel(bucket), bucket.durationMs, event.currentTarget) }}
              onBlur={() => setTooltip(null)}
              onClick={() => { if (data.unit === 'day') { setSelectedDay(localDayKey(new Date(bucket.from))); setLimit(8) } else setHovered(index) }}
              onKeyDown={event => {
                if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (data.unit === 'day') { setSelectedDay(localDayKey(new Date(bucket.from))); setLimit(8) } }
                if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const rects = event.currentTarget.ownerSVGElement?.querySelectorAll<SVGRectElement>('[role=button]'); rects?.[Math.max(0, Math.min(data.buckets.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))]?.focus() }
              }} />
            <rect pointerEvents="none" x={63 + index * step + step * .16} y={184 - height} width={step * .68} height={Math.max(bucket.durationMs ? 2 : 0, height)} rx={Math.min(3, step * .15)} className={`analytics-bar ${chartIndex === index ? 'active' : ''}`} />
          </g> })}
          {[...new Set([0, Math.floor((data.buckets.length - 1) / 2), data.buckets.length - 1])].map(index => <text key={index} x={63 + (index + .5) * 730 / data.buckets.length} y="213" textAnchor={index === 0 ? 'start' : index === data.buckets.length - 1 ? 'end' : 'middle'}>{tickLabel(data.buckets[index].from)}</text>)}
        </svg></div>
        <div className="analytics-chart-detail" aria-live="polite"><span>{chartBucket && bucketLabel(chartBucket)}</span><small>{data.unit === 'day' ? t('Grafikte bir güne tıklayarak oturumlarını inceleyebilirsin.') : t('Takvimden bir gün seçerek oturumlarını inceleyebilirsin.')}</small></div>
      </section>
      <div className="analytics-two-columns">
        <section className="analytics-panel"><div className="analytics-panel-heading"><div><h3>{t('Haftanın hangi günleri?')}</h3><p>{t('Haftanın günlerine göre toplam süre')}</p></div><CalendarDays size={18} /></div><div className="analytics-weekdays">{data.weekdays.map(day => <div className="analytics-weekday" key={day.index}><span>{weekday(day.index)}</span><div><span style={{ width: `${day.durationMs / peak * 100}%` }} /></div><strong>{duration(day.durationMs)}</strong></div>)}</div></section>
        <section className="analytics-panel"><div className="analytics-panel-heading"><div><h3>{scopedProfile ? t('Oyun alışkanlıkların') : t('Profil karşılaştırması')}</h3><p>{scopedProfile ? t('Seçili aralıktaki öne çıkanlar') : t('Hangi profilde ne kadar oynadın?')}</p></div>{scopedProfile ? <Trophy size={18} /> : <BarChart3 size={18} />}</div>
          {scopedProfile ? <div className="analytics-insights">
            <div><Trophy size={17} /><span>{t('En yoğun gün')}<strong>{data.bestDay && formatDate(data.bestDay.date)}</strong></span><b>{duration(data.bestDay?.durationMs ?? 0)}</b></div>
            <div><CalendarDays size={17} /><span>{t('En çok oynadığın gün')}<strong>{weekday(data.favoriteWeekday.index)}</strong></span><b>{duration(data.favoriteWeekday.durationMs)}</b></div>
            <div><Timer size={17} /><span>{t('En uzun oturum')}<strong>{data.longestSession && formatDate(Date.parse(data.longestSession.startedAt))}</strong></span><b>{duration(data.longestSession?.playedMs ?? 0)}</b></div>
            <div><Flame size={17} /><span>{t('En uzun seri')}<strong>{t('Arka arkaya oynanan günler')}</strong></span><b>{t('{count} gün', { count: data.longestStreak })}</b></div>
          </div> : <div className="analytics-ranking">{data.ranking.map((item, index) => <button key={item.profile.id} onClick={() => setFilter(item.profile.id)} title={t('{profile} analizini göster', { profile: item.profile.name })}><span className="analytics-rank-number">{String(index + 1).padStart(2, '0')}</span><span className="analytics-rank-icon"><ProfileIcon profile={item.profile} /></span><span className="analytics-rank-copy"><strong>{item.profile.name}</strong><span className="analytics-rank-track"><span style={{ width: `${item.durationMs / data.total * 100}%` }} /></span></span><span className="analytics-rank-value"><strong>{duration(item.durationMs)}</strong><small>{number(Math.round(item.durationMs / data.total * 100))}%</small></span></button>)}</div>}
          {scopedProfile && !profile && <button className="analytics-text-button" onClick={() => onProfile(scopedProfile.id)}>{t('Profil analizini aç')}<ArrowRight size={14} /></button>}
        </section>
      </div>
    </>}
      <section className="analytics-panel analytics-calendar"><div className="analytics-panel-heading"><div><h3>{t('Etkinlik takvimi')}</h3></div><span className={`analytics-streak ${calendarData.currentStreak > 1 ? 'is-active' : ''}`}><Flame size={16} />{t('Güncel seri: {count} gün', { count: calendarData.currentStreak })}</span></div>
        <div className="analytics-calendar-months" style={{ gridTemplateColumns: `repeat(${calendarWeeks}, minmax(0, 1fr))` }} aria-hidden="true">{calendarData.calendar.filter((_, index) => index % 7 === 0).map((day, index, weeks) => index === 0 || new Date(day.date).getMonth() !== new Date(weeks[index - 1].date).getMonth() ? <span key={day.key} style={{ gridColumn: index + 1 }}>{formats.month.format(day.date)}</span> : null)}</div>
        <div className="analytics-calendar-layout" onMouseLeave={() => setTooltip(null)}><div className="analytics-calendar-weekdays">{[0, 2, 4, 6].map(index => <span key={index} style={{ gridRow: index + 1 }}>{weekday(index, true)}</span>)}</div>
          <div className="analytics-calendar-grid" style={{ gridTemplateColumns: `repeat(${calendarWeeks}, minmax(0, 1fr))`, aspectRatio: `${calendarWeeks} / 7` }}>{calendarData.calendar.map(day => <button type="button" key={day.key} disabled={!day.inRange} className={`${selectedDay === day.key ? 'selected' : ''} ${!day.inRange ? 'outside' : ''}`} data-date={day.key} data-level={day.durationMs === 0 ? 0 : Math.ceil(day.durationMs / calendarPeak * 4)} aria-pressed={selectedDay === day.key} aria-label={`${formatDate(day.date, true)}: ${duration(day.durationMs)}`} aria-describedby={tooltip?.source === 'calendar' && tooltip.label === formatDate(day.date, true) ? tooltipId : undefined}
            onMouseEnter={event => hover('calendar', formatDate(day.date, true), day.durationMs, event.currentTarget, day.sessions)}
            onFocus={event => hover('calendar', formatDate(day.date, true), day.durationMs, event.currentTarget, day.sessions)}
            onBlur={() => setTooltip(null)}
            onClick={() => { setSelectedDay(selectedDay === day.key ? null : day.key); setLimit(8) }}
          />)}</div>
        </div>
        <div className="analytics-calendar-footer"><span>{t('{count} günde {duration} oynadın', { count: calendarData.activeDays, duration: duration(calendarData.total) })}</span><div><span>{t('Az')}</span>{[0, 1, 2, 3, 4].map(level => <i data-level={level} key={level} />)}<span>{t('Çok')}</span></div></div>
      </section>
      <section className="analytics-panel analytics-history"><div className="analytics-panel-heading"><div><h3>{t('Oturum geçmişi')}</h3><p>{selectedDay ? formatDate(calendarData.calendar.find(day => day.key === selectedDay)?.date ?? Date.parse(`${selectedDay}T12:00:00`), true) : t('Son oyun oturumların ve ölçülen süreleri')}</p></div>{selectedDay && <button className="analytics-text-button" onClick={() => { setSelectedDay(null); setLimit(8) }}><ArrowLeft size={14} />{t('Tüm oturumlar')}</button>}<span>{t('{count} oturum', { count: history.length })}</span></div>
        <div className={`analytics-session-table ${history.length > limit ? 'has-more' : ''}`} role="table" aria-label={t('Oturum geçmişi')}><div className="analytics-session-head" role="row"><span role="columnheader">{t('Profil')}</span><span role="columnheader">{t('Başlangıç')}</span><span role="columnheader">{t('Sürüm')}</span><span role="columnheader">{selectedDay ? t('Bu gündeki süre') : t('Süre')}</span></div>{history.slice(0, limit).map(session => { const owner = state.profiles.find(item => item.id === session.profileId)!; return <div className="analytics-session-row" role="row" key={session.id}><div role="cell"><span className="analytics-session-icon"><ProfileIcon profile={owner} /></span><span title={owner.name}>{owner.name}{running.has(session.id) && <small className="analytics-session-live">{t('Devam ediyor')}</small>}</span></div><span role="cell">{formats.session.format(new Date(session.startedAt))}</span><span role="cell" className="analytics-session-version" title={session.versionId}>{session.versionId}</span><strong role="cell">{duration(sessionDuration(session))}</strong></div> })}</div>
        {!history.length && <p className="analytics-history-empty">{selectedDay ? t('Bu gün için oyun oturumu yok.') : t('Bu zaman aralığında oyun kaydı yok')}</p>}
        {history.length > limit && <button className="analytics-show-more" onClick={() => setLimit(value => value + 8)}>{t('Daha fazla göster')}</button>}
        <p className="analytics-footnote"><Info size={14} /><span>{t('Süreler oyunun açık kaldığı zamanı gösterir; menü ve bekleme süreleri dahildir. Gece yarısını aşan oturumlar günlere bölünür. Çalışan oyunlar yaklaşık 30 saniyede bir güncellenir.')}</span></p>
      </section>
    {isVisible && tooltip && createPortal(<div id={tooltipId} role="tooltip" className="analytics-tooltip" data-source={tooltip.source} style={{ left: tooltip.x, top: tooltip.y }}><span>{tooltip.label}</span><strong>{duration(tooltip.durationMs)}</strong>{tooltip.sessions !== undefined && <small>{t('{count} oturum', { count: tooltip.sessions })}</small>}</div>, document.body)}
  </div>
}
