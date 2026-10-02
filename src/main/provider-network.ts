import { lookup } from 'node:dns/promises'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getDownloadManager } from './download-manager'
import { diskSpace } from './disk-space'

export async function publicUrl(value: string): Promise<URL> {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('İndirme adresi güvenli HTTPS kullanmıyor.')
  const hosts = await lookup(url.hostname, { all: true })
  if (!hosts.length || hosts.some(({ address }) => /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::|f[cd]|fe[89ab])/i.test(address))) throw new Error('Yerel ağ adreslerine bağlantı kurulamaz.')
  return url
}

export async function providerFetch(value: string, headersFor: (url: URL) => Record<string, string> = () => ({}), timeout = 20000, signal?: AbortSignal, transferHeaders: Record<string, string> = {}): Promise<Response> {
  let url = await publicUrl(value)
  for (let hops = 0; hops < 6; hops++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'GreenLauncher/0.14.0 (Despical)', ...headersFor(url), ...transferHeaders }, redirect: 'manual', signal: signal ?? AbortSignal.timeout(timeout) })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    await response.body?.cancel()
    const next = response.headers.get('location')
    if (!next) throw new Error('Geçersiz indirme yönlendirmesi.')
    url = await publicUrl(new URL(next, url).toString())
  }
  throw new Error('Çok fazla indirme yönlendirmesi.')
}

export async function providerJson<T>(url: string, headers?: (url: URL) => Record<string, string>): Promise<T> {
  const response = await providerFetch(url, headers)
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Kaynak bağlantısı doğrulanamadı. Bağlantı ayarlarını kontrol edin.' : `Kaynak isteği başarısız (${response.status}).`)
  const text = await response.text()
  if (text.length > 16 * 1024 * 1024) throw new Error('Kaynak yanıtı çok büyük.')
  return JSON.parse(text) as T
}

export async function downloadProviderFile(url: string, destination: string, hashes: { sha1?: string; md5?: string }, headers?: (url: URL) => Record<string, string>, limit = 512 * 1024 * 1024): Promise<void> {
  const algorithm = hashes.sha1 ? 'sha1' : hashes.md5 ? 'md5' : undefined
  const expected = algorithm ? hashes[algorithm]?.toLowerCase() : undefined
  if (algorithm && !new RegExp(`^[0-9a-f]{${algorithm === 'sha1' ? 40 : 32}}$`).test(expected ?? '')) throw new Error('Dosyanın doğrulama özeti geçersiz.')
  const manager = getDownloadManager()
  if (manager) return manager.download({ urls: [url], destination, checksum: algorithm ? { algorithm, value: expected! } : undefined, maxBytes: limit, request: (value, transferHeaders, signal) => providerFetch(value, headers, 120000, signal, transferHeaders), replace: !algorithm })
  mkdirSync(dirname(destination), { recursive: true })
  diskSpace().check(destination, 8 * 1024 ** 2)
  const temporary = `${destination}.${randomUUID()}.download`
  try {
    const response = await providerFetch(url, headers, 120000)
    if (!response.ok || !response.body) throw new Error(`Dosya indirilemedi (${response.status}).`)
    if (Number(response.headers.get('content-length')) > limit) throw new Error('İndirilecek dosya çok büyük.')
    diskSpace().check(destination, Number(response.headers.get('content-length')) || 16 * 1024 ** 2)
    let size = 0
    const hash = algorithm ? createHash(algorithm) : null
    const measure = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; hash?.update(chunk); callback(size > limit ? new Error('İndirilecek dosya çok büyük.') : null, chunk) } })
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), measure, createWriteStream(temporary))
    if (hash && hash.digest('hex') !== expected) throw new Error('Dosyanın bütünlük kontrolü başarısız.')
    renameSync(temporary, destination)
  } finally { rmSync(temporary, { force: true }) }
}
