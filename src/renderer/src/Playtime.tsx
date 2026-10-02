import { useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { LauncherState } from '../../shared/types'
import { playtimeSummary } from '../../shared/playtime'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import './playtime.css'

export function playDuration(milliseconds: number, language: Language): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const t = (source: string, values: Record<string, number>) => translate(language, source, values)
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, rest = seconds % 60
  return hours ? t('{hours} sa {minutes} dk', { hours, minutes }) : t('{minutes} dk {seconds} sn', { minutes, seconds: rest })
}

export function PlaytimeStatus({ state, language, onOpen }: { state: LauncherState; language: Language; onOpen(): void }) {
  if (!state.selectedProfileId) return null
  const summary = playtimeSummary(state.playSessions ?? [], state.selectedProfileId), last = summary.history[0]
  if (!last) return null
  const label = translate(language, 'Başlatmaya hazır, en son {date} tarihinde {duration} süreyle oynandı, toplam {total} oynandı', {
    date: new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(last.endedAt)),
    duration: playDuration(last.durationMs, language), total: playDuration(summary.total, language)
  })
  return <button className="statusbar-playtime" title={label} onClick={onOpen}><span>{label}</span></button>
}

export function PlaytimeDialog({ state, language, initialProfileId, onClose }: { state: LauncherState; language: Language; initialProfileId: string | null; onClose(): void }) {
  const [chosen, setChosen] = useState(initialProfileId)
  const [limit, setLimit] = useState(20)
  const profile = state.profiles.find(item => item.id === chosen) ?? state.profiles[0]
  const t = (source: string) => translate(language, source)
  const summary = playtimeSummary(state.playSessions ?? [], profile?.id ?? '')
  return <AccountDialog className="playtime-dialog" title={t('Oyun süresi istatistikleri')} description={t('Günlük ve haftalık sürelerini, profil bazında oyun geçmişini gör.')} closeLabel={t('Kapat')} onClose={onClose} icon={<Clock3 size={23} />}>
    <div className="playtime-profiles" aria-label={t('Profil')}>
      {state.profiles.map(item => <button key={item.id} aria-pressed={item.id === profile?.id} onClick={() => { setChosen(item.id); setLimit(20) }}>{item.name}</button>)}
    </div>
    <dl className="playtime-summary">{[['Bugün', summary.daily], ['Bu hafta', summary.weekly], ['Toplam', summary.total]].map(([title, value]) => <div key={title}><dt>{t(title as string)}</dt><dd>{playDuration(value as number, language)}</dd></div>)}</dl>
    <div className="playtime-history"><h3>{t('Oyun geçmişi')}</h3>
      {summary.history.length ? <ul>{summary.history.slice(0, limit).map(session => <li key={session.id}><div><strong>Minecraft {session.versionId}</strong><time dateTime={session.endedAt}>{new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.endedAt))}</time></div><span>{playDuration(session.durationMs, language)}</span></li>)}</ul> : <p>{t('Bu profilde henüz ölçülmüş bir oyun süresi yok.')}</p>}
      {summary.history.length > limit && <button className="load-more" onClick={() => setLimit(value => value + 20)}>{t('Daha fazla göster')}</button>}
    </div>
    <p className="playtime-local-note">{t(state.settings.savePlaytime !== false ? 'Oyun süreleri yalnızca bu bilgisayarda kaydedilir.' : 'Kalıcı kayıt kapalı. Süreler yalnızca launcher açıkken tutulur.')}</p>
  </AccountDialog>
}
