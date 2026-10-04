import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const lifetime = 24 * 60 * 60_000, retryDelay = 5 * 60_000, limit = 2 * 1024 * 1024
const hosts = new Set(['cdn.modrinth.com', 'media.forgecdn.net', 'mediafilez.forgecdn.net', 'cdn.technicpack.net'])
function image(bytes: Buffer): string | undefined {
  if (!bytes.length || bytes.length > limit) return undefined
  const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 ? 'jpeg' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : undefined
  return type ? `data:image/${type};base64,${bytes.toString('base64')}` : undefined
}

export class ContentIconCache {
  private memory = new Map<string, { until: number; icon?: string }>()
  private pending = new Map<string, Promise<string | undefined>>()
  private active = 0
  private queue: Array<() => void> = []
  private prunedAt = -Infinity
  constructor(private directory: string, private now = Date.now) {}
  async peek(value?: string): Promise<string | undefined> {
    if (!value) return undefined
    if (/^data:image\/(png|jpeg|webp);base64,/.test(value)) return value
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password) return undefined
      const cached = this.memory.get(value)
      if (cached?.icon) return cached.icon
      const path = join(this.directory, createHash('sha256').update(value).digest('hex') + '.image'), info = await stat(path)
      if (info.isFile() && info.size <= limit) {
        const icon = image(await readFile(path))
        if (icon) return this.remember(value, icon, info.mtimeMs + lifetime)
      }
    } catch {}
    return undefined
  }
  get(value?: string): Promise<string | undefined> {
    if (!value) return Promise.resolve(undefined)
    if (/^data:image\/(png|jpeg|webp);base64,/.test(value)) return Promise.resolve(value)
    try { const url = new URL(value); if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password) return Promise.resolve(undefined) } catch { return Promise.resolve(undefined) }
    const cached = this.memory.get(value)
    if (cached && cached.until > this.now()) return Promise.resolve(cached.icon)
    const current = this.pending.get(value)
    if (current) return current
    const task = this.load(value).finally(() => this.pending.delete(value))
    this.pending.set(value, task); return task
  }
  private async load(url: string): Promise<string | undefined> {
    const path = join(this.directory, createHash('sha256').update(url).digest('hex') + '.image')
    let old = this.memory.get(url)?.icon
    try {
      const info = await stat(path)
      if (info.isFile() && info.size <= limit) {
        old = image(await readFile(path)) ?? old
        if (old && info.mtimeMs + lifetime > this.now()) return this.remember(url, old, info.mtimeMs + lifetime)
      }
    } catch {}
    const release = await this.acquire()
    try {
      // CDN URLs identify individual assets. A changed URL gets its own cache entry.
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
      if (!response.ok || Number(response.headers.get('content-length')) > limit || !response.body) throw Error('Icon unavailable')
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > limit) throw Error('Icon size limit'); chunks.push(Buffer.from(chunk)) }
      const bytes = Buffer.concat(chunks), icon = image(bytes)
      if (!icon) throw Error('Invalid icon')
      try { await mkdir(this.directory, { recursive: true }); const temporary = `${path}.${randomUUID()}.tmp`; await writeFile(temporary, bytes); await rename(temporary, path) } catch { /* A read-only cache must not hide a usable icon. */ }
      return this.remember(url, icon, this.now() + lifetime)
    } catch { return this.remember(url, old, this.now() + retryDelay) }
    finally { release(); void this.prune() }
  }
  private async acquire(): Promise<() => void> {
    if (this.active >= 3) await new Promise<void>(resolve => this.queue.push(resolve))
    else this.active++
    return () => { const next = this.queue.shift(); if (next) next(); else this.active-- }
  }
  private async prune() {
    if (this.prunedAt + 60 * 60_000 > this.now()) return
    this.prunedAt = this.now()
    try {
      const names = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.image$/.test(name))
      const files = await Promise.all(names.map(async name => { const path = join(this.directory, name); return { path, ...await stat(path) } }))
      files.sort((a, b) => b.mtimeMs - a.mtimeMs)
      let bytes = 0
      for (let i = 0; i < files.length; i++) { bytes += files[i].size; if (i >= 512 || bytes > 64 * 1024 * 1024) await unlink(files[i].path).catch(() => {}) }
    } catch {}
  }
  private remember(url: string, icon: string | undefined, until: number) {
    this.memory.delete(url); this.memory.set(url, { icon, until })
    while (this.memory.size > 512) this.memory.delete(this.memory.keys().next().value!)
    return icon
  }
}
