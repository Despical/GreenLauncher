import type { LauncherState } from '../../shared/types'
import { playtimeSummary } from '../../shared/playtime'
import { translate, type Language } from './i18n'

export function playDuration(milliseconds: number, language: Language): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const t = (source: string, values: Record<string, number>) => translate(language, source, values)
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, rest = seconds % 60
  return hours ? t('{hours} sa {minutes} dk', { hours, minutes }) : t('{minutes} dk {seconds} sn', { minutes, seconds: rest })
}

export function PlaytimeStatus({ state, language }: { state: LauncherState; language: Language }) {
  if (!state.selectedProfileId) return null
  const summary = playtimeSummary(state.playSessions ?? [], state.selectedProfileId), last = summary.history[0]
  if (!last) return null
  const label = translate(language, 'Başlatmaya hazır, en son {date} tarihinde {duration} süreyle oynandı (toplam {total})', {
    date: new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(last.endedAt)),
    duration: playDuration(last.durationMs, language), total: playDuration(summary.total, language)
  })
  return <span className="statusbar-download statusbar-playtime" title={label}>{label}</span>
}
