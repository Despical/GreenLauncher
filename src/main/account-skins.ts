import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GameAccount } from '../shared/types'

const freshFor = 60 * 60_000
const retryAfter = 60_000
const maxEntries = 128
const maxTextureBytes = 2_000_000
const maxDiskBytes = 16 * 1024 * 1024
type CachedSkin = { value: string | null; expires: number }

// Public appearance data never changes an offline player's identity or session.
export class AccountSkins {
  private loading = new Map<string, Promise<string | null>>()
  private refreshing = new Map<string, Promise<string | null>>()
  private results = new Map<string, CachedSkin>()
  private pruning: Promise<void> | null = null

  constructor(private readonly directory: string, private readonly updated: (account: GameAccount, skin: string | null) => void = () => {}) {}

  get(account: GameAccount): Promise<string | null> {
    const key = createHash('sha256').update(`${account.kind ?? 'microsoft'}:${account.id}:${account.name.toLowerCase()}:${account.skinUrl ?? ''}`).digest('hex')
    const cached = this.results.get(key)
    if (cached) {
      this.remember(key, cached)
      if (cached.expires > Date.now()) return Promise.resolve(cached.value)
      if (cached.value) {
        void this.refresh(account, key, cached.value)
        return Promise.resolve(cached.value)
      }
    }
    const pending = this.loading.get(key) ?? this.refreshing.get(key)
    if (pending) return pending
    const request = this.load(account, key).finally(() => this.loading.delete(key))
    this.loading.set(key, request)
    return request
  }

  private remember(key: string, cached: CachedSkin): void {
    this.results.delete(key)
    this.results.set(key, cached)
    let bytes = [...this.results.values()].reduce((total, item) => total + (item.value?.length ?? 0), 0)
    while (this.results.size > maxEntries || bytes > maxDiskBytes) {
      const oldest = this.results.keys().next().value!
      bytes -= this.results.get(oldest)?.value?.length ?? 0
      this.results.delete(oldest)
    }
  }

  private async load(account: GameAccount, key: string): Promise<string | null> {
    try {
      const path = join(this.directory, `${key}.png`)
      const info = await stat(path)
      if (info.size > maxTextureBytes) throw new Error('Oversized cached skin')
      const bytes = await readFile(path)
      if (this.validPng(bytes)) {
        const value = this.dataUrl(bytes)
        const expires = Math.min(info.mtimeMs, Date.now()) + freshFor
        this.remember(key, { value, expires })
        // Paint immediately from disk while a stale texture refreshes in the background.
        if (expires <= Date.now()) void this.refresh(account, key, value)
        return value
      }
    } catch { /* A missing or damaged cache is replaced after a valid download. */ }
    return this.refresh(account, key, null)
  }

  private refresh(account: GameAccount, key: string, previous: string | null): Promise<string | null> {
    const pending = this.refreshing.get(key)
    if (pending) return pending
    const request = (async () => {
      try {
        const bytes = await this.download(account)
        const value = bytes ? this.dataUrl(bytes) : null
        if (bytes) {
          try {
            await mkdir(this.directory, { recursive: true })
            const path = join(this.directory, `${key}.png`)
            await writeFile(`${path}.tmp`, bytes)
            await rename(`${path}.tmp`, path)
            const maintenance = (this.pruning ?? Promise.resolve()).then(() => this.prune())
            this.pruning = maintenance
            await maintenance
            if (this.pruning === maintenance) this.pruning = null
          } catch { /* A read-only cache must not hide a successfully downloaded skin. */ }
        } else {
          await unlink(join(this.directory, `${key}.png`)).catch(() => {})
        }
        this.remember(key, { value, expires: Date.now() + (value ? freshFor : retryAfter) })
        if (value !== previous) this.updated(account, value)
        return value
      } catch {
        // A failed refresh keeps the last known appearance and backs off retries.
        this.remember(key, { value: previous, expires: Date.now() + retryAfter })
        return previous
      }
    })().finally(() => this.refreshing.delete(key))
    this.refreshing.set(key, request)
    return request
  }

  private async download(account: GameAccount): Promise<Buffer | null> {
    const signal = AbortSignal.timeout(8000)
    let url = account.skinUrl
    if (account.kind === 'offline') {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(account.name)) return null
      const lookup = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(account.name)}`, { signal, redirect: 'error' })
      if (lookup.status === 404 || lookup.status === 204) return null
      if (!lookup.ok) throw new Error('Profile lookup failed')
      const profile = await lookup.json() as { id?: string }
      if (!profile.id || !/^[0-9a-f]{32}$/i.test(profile.id)) throw new Error('Invalid profile identity')
      const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${profile.id}`, { signal, redirect: 'error' })
      if (!response.ok) throw new Error('Skin profile unavailable')
      const details = await response.json() as { properties?: Array<{ name: string; value: string }> }
      const texture = details.properties?.find(item => item.name === 'textures')?.value
      if (!texture) return null
      const decoded = JSON.parse(Buffer.from(texture, 'base64').toString('utf8')) as { textures?: { SKIN?: { url?: string } } }
      url = decoded.textures?.SKIN?.url
    }
    if (!url) return null
    const textureUrl = new URL(url)
    if (!['http:', 'https:'].includes(textureUrl.protocol) || textureUrl.hostname !== 'textures.minecraft.net' || textureUrl.port || textureUrl.username || textureUrl.password || !/^\/texture\/[0-9a-f]+$/i.test(textureUrl.pathname)) throw new Error('Untrusted skin URL')
    textureUrl.protocol = 'https:'
    const response = await fetch(textureUrl, { signal, redirect: 'error' })
    if (!response.ok) throw new Error('Skin download failed')
    if (Number(response.headers?.get('content-length')) > maxTextureBytes) throw new Error('Oversized skin texture')
    const bytes = await this.textureBytes(response)
    if (!this.validPng(bytes)) throw new Error('Invalid skin texture')
    return bytes
  }

  private async textureBytes(response: Response): Promise<Buffer> {
    const reader = response.body?.getReader()
    if (!reader) return Buffer.from(await response.arrayBuffer())
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxTextureBytes) {
          await reader.cancel()
          throw new Error('Oversized skin texture')
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks)
    } finally { reader.releaseLock() }
  }

  private async prune(): Promise<void> {
    try {
      const names = (await readdir(this.directory)).filter(name => /^[0-9a-f]{64}\.png$/.test(name))
      const entries = (await Promise.all(names.map(async name => {
        const path = join(this.directory, name)
        try { const info = await stat(path); return { path, size: info.size, at: info.mtimeMs } } catch { return null }
      }))).filter((entry): entry is { path: string; size: number; at: number } => entry !== null).sort((a, b) => b.at - a.at)
      let bytes = 0
      await Promise.all(entries.map(async (entry, index) => {
        bytes += entry.size
        if (index >= maxEntries || bytes > maxDiskBytes) await unlink(entry.path).catch(() => {})
      }))
    } catch { /* Cache maintenance is best effort. */ }
  }

  private validPng(bytes: Buffer): boolean {
    return bytes.length >= 24 && bytes.length <= maxTextureBytes && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.readUInt32BE(16) === 64 && [32, 64].includes(bytes.readUInt32BE(20))
  }
  private dataUrl(bytes: Buffer): string { return `data:image/png;base64,${bytes.toString('base64')}` }
}
