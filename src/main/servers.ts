import { createConnection, isIP } from 'node:net'
import { Resolver } from 'node:dns/promises'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeServerAddress } from '../shared/server-launch'
import type { MotdPart, SavedServer, ServerStatus } from '../shared/types'
import { readMinecraftServers, writeMinecraftServers, serverAddressKey, type MinecraftServerEntry, type MinecraftServerList } from './minecraft-servers'

const colors: Record<string, string> = {
  black:'#000000', dark_blue:'#0000aa', dark_green:'#00aa00', dark_aqua:'#00aaaa', dark_red:'#aa0000', dark_purple:'#aa00aa', gold:'#ffaa00', gray:'#aaaaaa',
  dark_gray:'#555555', blue:'#5555ff', green:'#55ff55', aqua:'#55ffff', red:'#ff5555', light_purple:'#ff55ff', yellow:'#ffff55', white:'#ffffff'
}
const legacyColors = Object.values(colors)
export function parseMotd(value: unknown): MotdPart[] {
  const parts: MotdPart[] = []
  let remaining = 2048, visited = 0
  const visit = (node: unknown, style: Omit<MotdPart, 'text'> = {}, depth = 0) => {
    if (depth > 16 || remaining <= 0 || ++visited > 256) return
    if (Array.isArray(node)) { node.slice(0, 256).forEach(child => visit(child, style, depth + 1)); return }
    if (node && typeof node === 'object') {
      const item = node as Record<string, unknown>, next = { ...style }
      if (typeof item.color === 'string') { const color = colors[item.color] ?? (/^#[0-9a-f]{6}$/i.test(item.color) ? item.color : undefined); if (color) next.color = color }
      for (const key of ['bold','italic','underlined','strikethrough'] as const) if (typeof item[key] === 'boolean') next[key] = item[key]
      if (typeof item.text === 'string') visit(item.text, next, depth + 1)
      else if (typeof item.translate === 'string') visit(item.translate, next, depth + 1)
      if (Array.isArray(item.with)) visit(item.with, next, depth + 1)
      if (Array.isArray(item.extra)) visit(item.extra, next, depth + 1)
      return
    }
    if (typeof node !== 'string') return
    let current = { ...style }
    for (const token of node.slice(0, remaining + 512).split(/(§[0-9a-fk-or])/i)) {
      if (/^§[0-9a-fk-or]$/i.test(token)) {
        const code = token[1].toLowerCase(), colorIndex = '0123456789abcdef'.indexOf(code)
        if (colorIndex >= 0) current = { color: legacyColors[colorIndex] }
        else if (code === 'r') current = { ...style }
        else if (code === 'l') current.bold = true
        else if (code === 'o') current.italic = true
        else if (code === 'n') current.underlined = true
        else if (code === 'm') current.strikethrough = true
      } else if (token && remaining > 0) { const text = token.replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, remaining); parts.push({ text, ...current }); remaining -= text.length }
    }
  }
  visit(value)
  return parts
}

export function varInt(value: number): Buffer {
  const bytes: number[] = []
  let unsigned = value >>> 0
  do { let byte = unsigned & 127; unsigned >>>= 7; if (unsigned) byte |= 128; bytes.push(byte) } while (unsigned)
  return Buffer.from(bytes)
}
function readVarInt(bytes: Buffer, offset = 0): { value: number; bytes: number } | null {
  let value = 0
  for (let n = 0; n < 5; n++) {
    if (offset + n >= bytes.length) return null
    const byte = bytes[offset + n]; value |= (byte & 127) << (n * 7)
    if (!(byte & 128)) return { value: value >>> 0, bytes: n + 1 }
  }
  throw new Error('Invalid VarInt')
}
function packet(id: number, payload = Buffer.alloc(0)): Buffer { const body = Buffer.concat([varInt(id), payload]); return Buffer.concat([varInt(body.length), body]) }
function string(value: string): Buffer { const bytes = Buffer.from(value); return Buffer.concat([varInt(bytes.length), bytes]) }
function favicon(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 350_000 || !/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(value)) return
  const bytes = Buffer.from(value.slice(22), 'base64')
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (width < 1 || width > 512 || width !== height) return
  return value
}
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : undefined

export async function queryServer(server: SavedServer, timeoutMs = 6000): Promise<ServerStatus> {
  const base: ServerStatus = { id: server.id, address: server.address, online: false, checkedAt: new Date().toISOString(), motd: [] }
  const normalized = normalizeServerAddress(server.address)!
  const match = normalized.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/)!
  const hostname = match[1].replace(/^\[|\]$/g, ''), originalPort = Number(match[2] ?? 25565)
  let host = hostname, port = originalPort
  if (!match[2] && !isIP(hostname) && hostname !== 'localhost') {
    const resolver = new Resolver({ timeout: 1000, tries: 1 })
    const timer = setTimeout(() => resolver.cancel(), 1200)
    try {
      const records = (await resolver.resolveSrv(`_minecraft._tcp.${hostname}`)).sort((a,b) => a.priority - b.priority || b.weight - a.weight)
      if (records[0]?.name && records[0].name !== '.' && records[0].port >= 1 && records[0].port <= 65535) { host = records[0].name; port = records[0].port }
    } catch { /* Hosts without SRV records use their normal address. */ }
    finally { clearTimeout(timer) }
  }
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    let bytes = Buffer.alloc(0), status: ServerStatus | undefined, done = false, pingAt = 0, pongTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => { if (done) return; done = true; clearTimeout(timer); clearTimeout(pongTimer); socket.destroy(); resolve(status ?? base) }
    const timer = setTimeout(finish, timeoutMs)
    socket.once('error', finish); socket.once('close', finish)
    socket.once('connect', () => {
      const serverPort = Buffer.alloc(2); serverPort.writeUInt16BE(port)
      socket.write(Buffer.concat([packet(0, Buffer.concat([varInt(-1), string(hostname), serverPort, varInt(1)])), packet(0)]))
    })
    socket.on('data', chunk => {
      if (done) return
      if (bytes.length + chunk.length > 512_000) { finish(); return }
      bytes = Buffer.concat([bytes, chunk])
      try {
        while (bytes.length) {
          const size = readVarInt(bytes); if (!size) return
          if (size.value > 500_000) { finish(); return }
          if (bytes.length < size.bytes + size.value) return
          const body = bytes.subarray(size.bytes, size.bytes + size.value); bytes = bytes.subarray(size.bytes + size.value)
          const id = readVarInt(body); if (!id) { finish(); return }
          if (id.value === 0 && !status) {
            const length = readVarInt(body, id.bytes)
            if (!length || length.value > body.length - id.bytes - length.bytes) { finish(); return }
            const data = JSON.parse(body.subarray(id.bytes + length.bytes, id.bytes + length.bytes + length.value).toString('utf8'))
            if (!data || typeof data !== 'object') { finish(); return }
            status = { ...base, online: true, motd: parseMotd(data.description), version: typeof data.version?.name === 'string' ? data.version.name.slice(0, 160) : undefined,
              protocol: Number.isInteger(data.version?.protocol) ? data.version.protocol : undefined,
              players: count(data.players?.online), maxPlayers: count(data.players?.max), icon: favicon(data.favicon),
              sample: Array.isArray(data.players?.sample) ? data.players.sample.slice(0, 64).map((player: unknown) => player && typeof player === 'object' && typeof (player as {name?:unknown}).name === 'string' ? (player as {name:string}).name.slice(0, 80) : '').filter(Boolean) : [] }
            const payload = Buffer.alloc(8); payload.writeBigInt64BE(BigInt(Date.now())); pingAt = performance.now()
            socket.write(packet(1, payload)); pongTimer = setTimeout(finish, 800)
          } else if (id.value === 1 && status && body.length === id.bytes + 8) { status.latency = Math.max(0, Math.round(performance.now() - pingAt)); finish(); return }
        }
      } catch { finish() }
    })
  })
}

export class ServerService {
  private entries: SavedServer[] = []
  private inFlight = new Map<string, Promise<ServerStatus>>()
  private active = 0
  private waiting: Array<() => void> = []
  private document?: MinecraftServerList
  private gameEntries = new Map<string, MinecraftServerEntry>()
  constructor(private readonly path: string, private readonly gameDirectory?: string) {
    if (!existsSync(path)) return
    try {
      const entries: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (Array.isArray(entries)) this.entries = entries.slice(0, 10000).filter((entry): entry is SavedServer => {
        try { return !!entry && typeof entry.id === 'string' && /^[\w-]{1,90}$/.test(entry.id) && typeof entry.name === 'string' && entry.name.length > 0 && entry.name.length <= 80 && !!normalizeServerAddress(entry.address) && typeof entry.createdAt === 'string' } catch { return false }
      }).map(entry => ({ ...entry, icon: favicon(entry.icon) }))
    } catch { /* A damaged list must not prevent the launcher from opening. */ }
  }
  private sync(): void {
    if (!this.gameDirectory) return
    const document = readMinecraftServers(this.gameDirectory)
    if (this.document && this.document.hash === document.hash) return
    const previous = [...this.entries], mapped = new Map<string, MinecraftServerEntry>()
    const next: SavedServer[] = []
    for (const entry of document.entries) {
      if (entry.hidden?.type === 'byte' && entry.hidden.value !== 0 || entry.ip?.type !== 'string') continue
      const key = serverAddressKey(entry.ip.value)
      if (!key) continue
      const name = entry.name?.type === 'string' && entry.name.value ? entry.name.value : entry.ip.value
      let index = previous.findIndex(item => serverAddressKey(item.address) === key && item.name === name)
      if (index < 0) index = previous.findIndex(item => serverAddressKey(item.address) === key)
      if (index < 0) index = previous.findIndex(item => item.name === name)
      const cached = index < 0 ? undefined : previous.splice(index, 1)[0]
      const icon = entry.icon?.type === 'string' ? favicon(`data:image/png;base64,${entry.icon.value}`) : undefined
      const server: SavedServer = { id: cached?.id ?? randomUUID(), name, address: entry.ip.value, createdAt: cached?.createdAt ?? new Date().toISOString(), resourcePacks: entry.acceptTextures?.type === 'byte' ? entry.acceptTextures.value === 1 ? 'enabled' : 'disabled' : 'prompt', icon: icon ?? (cached && serverAddressKey(cached.address) === key ? cached.icon : undefined) }
      next.push(server); mapped.set(server.id, entry)
    }
    this.document = document; this.gameEntries = mapped
    if (JSON.stringify(next) !== JSON.stringify(this.entries)) this.persist(next, false)
  }
  get(): SavedServer[] { this.sync(); return structuredClone(this.entries) }
  importLegacy(servers: SavedServer[]): void {
    this.sync()
    const next = this.entries.map(item => ({ ...item, icon: item.icon ?? favicon(servers.find(old => serverAddressKey(old.address) === serverAddressKey(item.address))?.icon) }))
    const existing = new Set(next.map(item => serverAddressKey(item.address)))
    for (const server of servers) {
      const address = normalizeServerAddress(server.address), key = address && serverAddressKey(address)
      if (!key || existing.has(key)) continue
      next.push({ id: randomUUID(), name: server.name, address: address!, createdAt: server.createdAt, resourcePacks: ['enabled','disabled'].includes(server.resourcePacks ?? '') ? server.resourcePacks : 'prompt', icon: favicon(server.icon) })
      existing.add(key)
    }
    if (JSON.stringify(next) !== JSON.stringify(this.entries)) this.persist(next)
  }
  private persist(next: SavedServer[], writeGame = true): SavedServer[] {
    if (writeGame && this.gameDirectory && this.document) {
      const preserved = this.document.entries.filter(entry => ![...this.gameEntries.values()].includes(entry))
      const visible = next.map(server => {
        const original = this.gameEntries.get(server.id), entry = original ? { ...original } : {}
        if (original?.ip?.type === 'string' && serverAddressKey(original.ip.value) !== serverAddressKey(server.address)) delete entry.icon
        entry.name = { type: 'string', value: server.name }; entry.ip = { type: 'string', value: server.address }
        if (server.icon) entry.icon = { type: 'string', value: server.icon.slice(22) }
        else delete entry.icon
        if (server.resourcePacks === 'prompt') delete entry.acceptTextures
        else entry.acceptTextures = { type: 'byte', value: server.resourcePacks === 'enabled' ? 1 : 0 }
        return entry
      })
      const document: MinecraftServerList = { ...this.document, root: { ...this.document.root, value: { ...this.document.root.value } }, entries: [...preserved, ...visible] }
      document.root.value.servers = { type: 'list', value: { type: 'compound', value: document.entries } }
      writeMinecraftServers(this.gameDirectory, document)
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${randomUUID()}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8'); renameSync(temp, this.path)
    this.entries = next
    return structuredClone(this.entries)
  }
  save(input: { id?: string; name: string; address: string; resourcePacks?: SavedServer['resourcePacks'] }): SavedServer[] {
    this.sync()
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('Sunucu adı 1–80 karakter olmalı.')
    const address = normalizeServerAddress(input.address)
    if (!address) throw new Error('Geçerli bir sunucu adresi girin.')
    const current = input.id ? this.entries.find(server => server.id === input.id) : undefined
    if (input.id && !current) throw new Error('Sunucu bulunamadı.')
    if (!current && this.entries.length >= 200) throw new Error('En fazla 200 sunucu ekleyebilirsin.')
    if (input.resourcePacks !== undefined && !['enabled', 'prompt', 'disabled'].includes(input.resourcePacks)) throw new Error('Kaynak paketi tercihi geçersiz.')
    const item = { id: current?.id ?? randomUUID(), name: input.name.trim(), address, createdAt: current?.createdAt ?? new Date().toISOString(), resourcePacks: input.resourcePacks ?? current?.resourcePacks ?? 'prompt' as const, icon: current?.address === address ? current.icon : undefined }
    return this.persist(current ? this.entries.map(server => server.id === item.id ? item : server) : [...this.entries, item])
  }
  delete(id: string): SavedServer[] {
    this.sync()
    if (!this.entries.some(server => server.id === id)) throw new Error('Sunucu bulunamadı.')
    return this.persist(this.entries.filter(server => server.id !== id))
  }
  reorder(ids: string[]): SavedServer[] {
    this.sync()
    if (!Array.isArray(ids) || ids.length !== this.entries.length || new Set(ids).size !== ids.length || ids.some(id => !this.entries.some(server => server.id === id))) throw new Error('Sunucu sıralaması geçersiz.')
    return this.persist(ids.map(id => this.entries.find(server => server.id === id)!))
  }
  refresh(id: string): Promise<ServerStatus> {
    this.sync()
    const server = this.entries.find(item => item.id === id)
    if (!server) return Promise.reject(new Error('Sunucu bulunamadı.'))
    const key = `${server.id}:${server.address}`, cached = this.inFlight.get(key)
    if (cached) return cached
    const task = (async () => {
      if (this.active >= 4) await new Promise<void>(resolve => this.waiting.push(resolve))
      else this.active++
      try {
        const status = await queryServer(server)
        this.sync()
        const current = this.entries.find(item => item.id === server.id && item.address === server.address)
        if (!current) return status
        // Keep the last icon while offline; an online response can replace or remove it.
        if (!status.online) return { ...status, icon: current.icon }
        if (status.icon !== current.icon) {
          try { this.persist(this.entries.map(item => item.id === current.id ? { ...item, icon: status.icon } : item)) }
          catch { /* An icon cache write must not discard a successful status query. */ }
        }
        return status
      }
      finally { const next = this.waiting.shift(); if (next) next(); else this.active-- }
    })().finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, task)
    return task
  }
}
