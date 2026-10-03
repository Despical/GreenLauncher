import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import type { GameLogChange, GameLogLevel, GameLogLine, GameLogSession, GameLogSnapshot, RunningInstance } from '../shared/types'

const maxLines = 10_000, maxBytes = 8 * 1024 * 1024, maxLineLength = 16_384
type Session = GameLogSession & { lines: GameLogLine[]; bytes: number; nextSeq: number; revision: number; dropped: number; secrets: string[] }

function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (original, cdata: string | undefined, entity: string) => {
    if (cdata !== undefined) return cdata
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[entity]) return named[entity]
    const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original
  })
}

/** Decode Minecraft's Log4j XML output without altering plain-text logs. */
export function formatMinecraftLogEvent(event: string): string {
  const opening = event.match(/^<(?:log4j:)?Event\b([^>]*)>/)?.[1] ?? ''
  const attribute = (name: string) => xmlText(opening.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1] ?? '')
  const timestamp = Number(attribute('timestamp') || attribute('timeMillis'))
  const time = new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()).toLocaleTimeString('en-GB', { hour12: false })
  const message = event.match(/<(?:log4j:)?Message\b[^>]*>([\s\S]*?)<\/(?:log4j:)?Message>/)?.[1] ?? ''
  const throwable = event.match(/<(?:log4j:)?Throwable\b[^>]*>([\s\S]*?)<\/(?:log4j:)?Throwable>/)?.[1]
  const text = xmlText(message)
  return `[${time}] [${attribute('thread') || 'main'}/${attribute('level') || 'INFO'}]: ${text}${throwable ? '\n' + xmlText(throwable) : ''}`
}

export function redactGameLog(text: string, secrets: string[] = []): string {
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/((?:--)?(?:access[_-]?token|refresh[_-]?token|client[_-]?token|authorization|password|secret)["']?\s*[=: ]\s*["']?)(?:Bearer\s+)?[^\s,"']+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
}

export function gameLogLevel(text: string, fallback: GameLogLevel = 'info'): GameLogLevel {
  // A structured severity takes priority over words in the message itself.
  const declared = text.match(/\[[^\]\r\n]*\/(INFO|WARN|WARNING|ERROR|FATAL|SEVERE|DEBUG|TRACE)\]:/i)?.[1]
    ?? text.match(/\blevel=["'](INFO|WARN|WARNING|ERROR|FATAL|SEVERE|DEBUG|TRACE)["']/i)?.[1]
  if (declared) {
    const level = declared.toUpperCase()
    return ['ERROR', 'FATAL', 'SEVERE'].includes(level) ? 'error' : ['WARN', 'WARNING'].includes(level) ? 'warn' : ['DEBUG', 'TRACE'].includes(level) ? 'debug' : 'info'
  }
  if (/(?:^|\/|\[|\s)(?:ERROR|FATAL|SEVERE)(?:\]|\s|:)/i.test(text) || /level=["'](?:ERROR|FATAL)["']/i.test(text) || /^(?:Exception in thread|Caused by:)/.test(text)) return 'error'
  if (/(?:^|\/|\[|\s)WARN(?:ING)?(?:\]|\s|:)/i.test(text) || /level=["']WARN["']/i.test(text)) return 'warn'
  if (/(?:^|\/|\[|\s)(?:DEBUG|TRACE)(?:\]|\s|:)/i.test(text) || /level=["'](?:DEBUG|TRACE)["']/i.test(text)) return 'debug'
  if (/(?:^|\/|\[|\s)INFO(?:\]|\s|:)/i.test(text) || /level=["']INFO["']/i.test(text)) return 'info'
  return fallback
}

/** Session output stays in memory; clearing never changes Minecraft's own log files. */
export class GameConsole {
  private sessions = new Map<string, Session>()
  private pending = new Set<string>()
  private timer?: ReturnType<typeof setTimeout>
  constructor(private changed: (change: GameLogChange) => void = () => {}) {}

  begin(instance: RunningInstance, secrets: string[] = []): void {
    this.sessions.set(instance.id, { instance: structuredClone(instance), running: true, lines: [], bytes: 0, nextSeq: 1, revision: 0, dropped: 0, secrets: secrets.filter(Boolean) })
    this.prune(); this.notify(instance.id)
  }
  private prune(): void {
    const finished = [...this.sessions.values()].filter(session => !session.running)
    for (const session of finished.slice(0, Math.max(0, finished.length - 6))) this.sessions.delete(session.instance.id)
  }
  private notify(id: string): void {
    this.pending.add(id)
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const ids = [...this.pending]; this.pending.clear()
      for (const instanceId of ids) { const session = this.sessions.get(instanceId); if (session) this.changed({ instanceId, profileId: session.instance.profileId }) }
    }, 100)
    this.timer.unref?.()
  }
  append(id: string, raw: string, fallback: GameLogLevel = 'info'): GameLogLevel {
    const session = this.sessions.get(id)
    if (!session) return fallback
    const text = redactGameLog(raw, session.secrets).slice(0, maxLineLength), level = fallback === 'launcher' ? 'launcher' : gameLogLevel(text, fallback)
    session.lines.push({ seq: session.nextSeq++, text, level }); session.bytes += Buffer.byteLength(text); session.revision++
    while (session.lines.length > maxLines || session.bytes > maxBytes) {
      session.bytes -= Buffer.byteLength(session.lines.shift()!.text); session.dropped++
    }
    this.notify(id); return level
  }
  attach(id: string, stream: Readable | null | undefined, fallback: GameLogLevel): void {
    if (!stream) return
    const decoder = new StringDecoder('utf8')
    let pending = '', level = fallback, ended = false, blankLines = 0
    const emit = (line: string) => {
      // Buffer separators until the next record: Minecraft records should be
      // adjacent, while blank lines inside plain messages/stack traces survive.
      if (!line.trim()) { blankLines = Math.min(blankLines + 1, maxLines); return }
      if (/^\[\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]/.test(line)) blankLines = 0
      while (blankLines > 0) { level = this.append(id, '', level); blankLines-- }
      level = this.append(id, line, level)
    }
    const consume = (text: string, final = false) => {
      pending += text
      while (pending) {
        const start = pending.search(/<(?:log4j:)?Event\b/), newline = pending.indexOf('\n')
        if (start >= 0 && (newline < 0 || start <= newline)) {
          if (start > 0) { emit(pending.slice(0, start).replace(/\r$/, '')); pending = pending.slice(start) }
          // Ignore closing-tag text inside CDATA messages, even across chunks.
          const closing = [...pending.matchAll(/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\/(?:log4j:)?Event>/g)].find(match => match[0].startsWith('</'))
          if (!closing) break
          const end = closing.index + closing[0].length
          for (const line of formatMinecraftLogEvent(pending.slice(0, end)).split(/\r?\n/)) emit(line)
          pending = pending.slice(end).replace(/^\r?\n/, '')
        } else if (newline >= 0) {
          const line = pending.slice(0, newline).replace(/\r$/, '')
          if (!/^\s*(?:<\?xml\b.*\?>|<\/?Events\b[^>]*>)\s*$/.test(line)) emit(line)
          pending = pending.slice(newline + 1)
        } else break
      }
      const limit = /<(?:log4j:)?Event\b/.test(pending) ? 1024 * 1024 : 65_536
      if (pending.length > limit || (final && pending)) { emit(pending.replace(/\r$/, '')); pending = '' }
    }
    const finish = () => { if (ended) return; ended = true; consume(decoder.end(), true) }
    stream.on('data', (chunk: Buffer | string) => consume(typeof chunk === 'string' ? chunk : decoder.write(chunk)))
    stream.once('end', finish); stream.once('close', finish)
    // Listening to data drains even a verbose loader without blocking its pipes.
    stream.resume()
  }
  finish(id: string): void {
    const session = this.sessions.get(id)
    if (!session || !session.running) return
    session.running = false; session.secrets = []; session.revision++; this.notify(id); this.prune()
  }
  snapshot(profileId: string, instanceId?: string, afterSeq = 0): GameLogSnapshot {
    const sessions = [...this.sessions.values()].filter(session => session.instance.profileId === profileId).reverse()
    const selected = sessions.find(session => session.instance.id === instanceId) ?? sessions.find(session => session.running) ?? sessions[0]
    const meta = (session: Session): GameLogSession => ({ instance: structuredClone(session.instance), running: session.running })
    if (!selected) return { session: null, sessions: [], lines: [], firstSeq: 1, nextSeq: 1, revision: 0, dropped: 0 }
    const cursor = selected.instance.id === instanceId ? afterSeq : 0
    return { session: meta(selected), sessions: sessions.map(meta), lines: selected.lines.filter(line => line.seq > cursor).map(line => ({ ...line })), firstSeq: selected.lines[0]?.seq ?? selected.nextSeq, nextSeq: selected.nextSeq, revision: selected.revision, dropped: selected.dropped }
  }
  private require(profileId: string, instanceId: string): Session {
    const session = this.sessions.get(instanceId)
    if (!session || session.instance.profileId !== profileId) throw new Error('Oyun günlüğü bulunamadı.')
    return session
  }
  clear(profileId: string, instanceId: string): GameLogSnapshot {
    const session = this.require(profileId, instanceId)
    session.lines = []; session.bytes = 0; session.dropped = 0; session.revision++; this.notify(instanceId)
    return this.snapshot(profileId, instanceId)
  }
  content(profileId: string, instanceId: string): string { return this.require(profileId, instanceId).lines.map(line => line.text).join('\n') }
}

export async function uploadMinecraftLog(content: string, request: typeof fetch = fetch): Promise<string> {
  if (!content.trim()) throw new Error('Yüklenecek günlük yok.')
  try {
    const response = await request('https://api.mclo.gs/1/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, source: 'Green Launcher' }), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('upload failed')
    const result = await response.json() as { success?: boolean; id?: unknown; url?: unknown }
    if (result.success !== true || typeof result.id !== 'string' || !/^[a-zA-Z0-9]{1,64}$/.test(result.id) || result.url !== `https://mclo.gs/${result.id}`) throw new Error('invalid upload response')
    return result.url
  } catch { throw new Error('Günlük yüklenemedi. İnternet bağlantını kontrol edip yeniden dene.') }
}
