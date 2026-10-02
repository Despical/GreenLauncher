import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountCape, GameAccount } from '../shared/types'
import type { AccountService } from './auth'

const maxCapeBytes = 2_000_000
const cacheFor = 30 * 60_000
const maxCacheFileBytes = 16 * 1024 * 1024
const maxCacheBytes = 64 * 1024 * 1024
const maxCacheEntries = 64
type CachedCapes = { until: number; value: AccountCape[] }

export class AccountCapes {
  private readonly cache = new Map<string, CachedCapes>()
  private readonly pending = new Map<string, Promise<AccountCape[]>>()

  constructor(private readonly accounts: AccountService, private readonly directory: string) {}

  get(account: GameAccount): Promise<AccountCape[]> {
    const key = `${account.kind ?? 'microsoft'}:${account.id}:${account.name}`
    const cached = this.cache.get(key)
    if (cached && cached.until > Date.now()) return Promise.resolve(cached.value)
    const existing = this.pending.get(key)
    if (existing) return existing
    const task = this.loadCached(account, key).finally(() => this.pending.delete(key))
    this.pending.set(key, task)
    return task
  }

  async activate(account: GameAccount, id: string): Promise<AccountCape[]> {
    if (account.kind === 'offline') throw new Error('Pelerin değiştirmek için Microsoft hesabı gerekir.')
    if (id !== 'none' && !/^minecraft:[0-9a-f-]{32,36}$/i.test(id)) throw new Error('Geçersiz Minecraft pelerini.')
    await this.accounts.setActiveCape(account, id === 'none' ? null : id.slice('minecraft:'.length))
    const key = `${account.kind ?? 'microsoft'}:${account.id}:${account.name}`
    const value = await this.load(account)
    await this.remember(key, value)
    return value
  }

  private file(key: string): string {
    return join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`)
  }

  private async loadCached(account: GameAccount, key: string): Promise<AccountCape[]> {
    const stored = await this.readCache(key)
    if (stored?.until && stored.until > Date.now()) {
      this.cache.set(key, stored)
      return stored.value
    }
    try {
      const value = await this.load(account)
      await this.remember(key, value)
      return value
    } catch (error) {
      // A stale public appearance is preferable to an empty panel while offline.
      if (stored) {
        this.cache.set(key, { until: Date.now() + 60_000, value: stored.value })
        return stored.value
      }
      throw error
    }
  }

  private async readCache(key: string): Promise<CachedCapes | null> {
    try {
      const path = this.file(key)
      if ((await stat(path)).size > maxCacheFileBytes) return null
      const stored = JSON.parse(await readFile(path, 'utf8')) as CachedCapes
      if (!Number.isFinite(stored.until) || !Array.isArray(stored.value) || stored.value.length > 64 ||
        !stored.value.every(cape => typeof cape.id === 'string' && typeof cape.name === 'string' &&
          typeof cape.image === 'string' && cape.image.startsWith('data:image/png;base64,') && cape.image.length <= 2_700_000 &&
          (cape.source === 'minecraft' || cape.source === 'optifine') && typeof cape.active === 'boolean')) return null
      return stored
    } catch { return null }
  }

  private async remember(key: string, value: AccountCape[]): Promise<void> {
    const stored = { until: Date.now() + cacheFor, value }
    this.cache.set(key, stored)
    try {
      const contents = JSON.stringify(stored)
      if (Buffer.byteLength(contents) > maxCacheFileBytes) return
      await mkdir(this.directory, { recursive: true })
      const path = this.file(key)
      await writeFile(`${path}.tmp`, contents)
      await rename(`${path}.tmp`, path)
      await this.prune()
    } catch { /* A read-only cache must not hide the downloaded capes. */ }
  }

  private async prune(): Promise<void> {
    try {
      const names = (await readdir(this.directory)).filter(name => /^[0-9a-f]{64}\.json$/.test(name))
      const entries = (await Promise.all(names.map(async name => {
        const path = join(this.directory, name)
        try { const info = await stat(path); return { path, size: info.size, at: info.mtimeMs } } catch { return null }
      }))).filter((entry): entry is { path: string; size: number; at: number } => entry !== null).sort((a, b) => b.at - a.at)
      let bytes = 0
      await Promise.all(entries.map(async (entry, index) => {
        bytes += entry.size
        if (index >= maxCacheEntries || bytes > maxCacheBytes) await unlink(entry.path).catch(() => {})
      }))
    } catch { /* Cache maintenance is best effort. */ }
  }

  private async load(account: GameAccount): Promise<AccountCape[]> {
    const [minecraft, optifine] = await Promise.allSettled([
      account.kind === 'offline' ? this.publicActiveCape(account.name) : this.accounts.getProfileCapes(account),
      this.optifineCape(account.name)
    ])
    if (minecraft.status === 'rejected' && (account.kind !== 'offline' || optifine.status === 'rejected' || !optifine.value)) throw new Error('Minecraft pelerinleri şu anda alınamadı.')
    const inventory = minecraft.status === 'fulfilled' ? minecraft.value : []
    const capes = await Promise.all(inventory.map(async (cape, index): Promise<AccountCape> => ({
      id: `minecraft:${cape.id}`,
      name: cape.name?.toLowerCase().replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase()) || `Minecraft #${index + 1}`,
      source: 'minecraft',
      image: await this.download(cape.url, 'textures.minecraft.net'),
      active: cape.active
    })))
    if (optifine.status === 'fulfilled' && optifine.value) capes.push(optifine.value)
    return capes
  }

  private async publicActiveCape(name: string): Promise<Array<{ id: string; name: string; url: string; active: boolean }>> {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return []
    const lookup = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (lookup.status === 404 || lookup.status === 204) return []
    if (!lookup.ok) throw new Error('Minecraft profile unavailable')
    const player = await lookup.json() as { id?: string }
    if (!player.id || !/^[0-9a-f]{32}$/i.test(player.id)) return []
    const response = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${player.id}`, { signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok) throw new Error('Minecraft textures unavailable')
    const details = await response.json() as { properties?: Array<{ name: string; value: string }> }
    const texture = details.properties?.find(item => item.name === 'textures')?.value
    if (!texture || texture.length > 32_000) return []
    const decoded = JSON.parse(Buffer.from(texture, 'base64').toString('utf8')) as { textures?: { CAPE?: { url?: string } } }
    const url = decoded.textures?.CAPE?.url
    return url ? [{ id: new URL(url).pathname.split('/').pop() ?? 'active', name: 'Minecraft', url, active: true }] : []
  }

  private async optifineCape(name: string): Promise<AccountCape | null> {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return null
    // OptiFine's own cape server currently serves this endpoint over HTTP only.
    try {
      const image = await this.download(`http://s.optifine.net/capes/${name}.png`, 's.optifine.net')
      return { id: 'optifine', name: 'OptiFine', source: 'optifine', image, active: false }
    } catch { return null }
  }

  private async download(value: string, host: string): Promise<string> {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== host || url.port || url.username || url.password) throw new Error('Untrusted cape URL')
    if (host === 'textures.minecraft.net') {
      if (!/^\/texture\/[0-9a-f]+$/i.test(url.pathname)) throw new Error('Untrusted Minecraft texture')
      url.protocol = 'https:'
    } else if (!/^\/capes\/[A-Za-z0-9_]{3,16}\.png$/.test(url.pathname)) throw new Error('Untrusted OptiFine texture')
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' })
    if (!response.ok || Number(response.headers.get('content-length')) > maxCapeBytes) throw new Error('Cape unavailable')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Cape body unavailable')
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxCapeBytes) throw new Error('Cape too large')
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = Buffer.concat(chunks)
    if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid cape PNG')
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
    if (width < 22 || height < 17 || width > 2048 || height > 1024 || (width !== height * 2 && width * 17 !== height * 22 && width * 11 !== height * 23)) throw new Error('Invalid cape dimensions')
    return `data:image/png;base64,${bytes.toString('base64')}`
  }
}
