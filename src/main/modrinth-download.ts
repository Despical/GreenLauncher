import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { getDownloadManager } from './download-manager'

export type FileHashes = { sha512?: string; sha1?: string }
const allowedHosts = new Set(['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'])

function safeUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) throw new Error('Mod paketi dosyası güvenilir bir adreste değil.')
  return url
}

async function matches(path: string, algorithm: 'sha512' | 'sha1', expected: string): Promise<boolean> {
  if (!existsSync(path)) return false
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex') === expected
}

async function fetchSafe(value: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  let url = safeUrl(value)
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Despical/GreenLauncher/0.14.0', ...headers }, signal: signal ?? AbortSignal.timeout(120000) })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('İndirme yönlendirmesi geçersiz.')
    url = safeUrl(new URL(location, url).toString())
  }
  throw new Error('İndirme çok fazla yönlendirildi.')
}

export async function downloadVerified(urls: string[], hashes: FileHashes, destination: string, cacheRoot: string, maxBytes = 250 * 1024 * 1024): Promise<void> {
  const algorithm = hashes.sha512 ? 'sha512' : 'sha1'
  const expected = hashes[algorithm]?.toLowerCase()
  if (!expected || !new RegExp(`^[0-9a-f]{${algorithm === 'sha512' ? 128 : 40}}$`).test(expected)) throw new Error('Dosyanın geçerli doğrulama özeti yok.')
  if (await matches(destination, algorithm, expected)) return
  const cachePath = join(cacheRoot, `${algorithm}-${expected}`)
  mkdirSync(cacheRoot, { recursive: true })
  if (!(await matches(cachePath, algorithm, expected))) {
    const manager = getDownloadManager()
    if (manager) await manager.download({ urls, checksum: { algorithm, value: expected }, destination: cachePath, maxBytes, request: fetchSafe })
    else {
    let lastError: unknown = new Error('İndirme adresi bulunamadı.')
    for (const value of urls) {
      const temporary = `${cachePath}.${randomUUID()}.download`
      try {
        const response = await fetchSafe(value)
        if (!response.ok || !response.body) throw new Error(`Dosya indirilemedi (${response.status}).`)
        if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('Dosya izin verilen boyutu aşıyor.')
        let received = 0
        const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) { received += chunk.length; callback(received > maxBytes ? new Error('Dosya izin verilen boyutu aşıyor.') : null, chunk) } })
        await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limit, createWriteStream(temporary))
        if (statSync(temporary).size > maxBytes) throw new Error('Dosya izin verilen boyutu aşıyor.')
        if (!(await matches(temporary, algorithm, expected))) throw new Error('İndirilen dosyanın bütünlük kontrolü başarısız.')
        if (existsSync(cachePath)) rmSync(cachePath, { force: true })
        renameSync(temporary, cachePath)
        lastError = null
        break
      } catch (error) { lastError = error; rmSync(temporary, { force: true }) }
    }
    if (lastError) throw lastError
    }
  }
  mkdirSync(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.download`
  try { copyFileSync(cachePath, temporary); if (existsSync(destination)) rmSync(destination, { force: true }); renameSync(temporary, destination) }
  catch (error) { rmSync(temporary, { force: true }); throw error }
}
