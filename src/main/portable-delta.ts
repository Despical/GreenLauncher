import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { LauncherUpdate } from '../shared/types'
import { planUpdate, updateBlocks, validateBlockMap } from './update-blocks'

export async function limitedBody(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw new Error('Missing update response')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read(); if (done) break
      size += value.length; if (size > limit) throw new Error('Update response too large')
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export async function downloadDelta(options: {
  source: string; destination: string; url: string; size: number
  map: { file: string; size: number; sha256: string }; base: string; signal: AbortSignal
  request: (url: string, signal: AbortSignal, headers?: Record<string, string>) => Promise<Response>
  progress: (value: Partial<LauncherUpdate>) => void; written: (bytes: number) => void
}): Promise<{ transferred: number; total: number }> {
  const { signal, request, progress } = options
  const response = await request(options.base + options.map.file, signal)
  if (!response.ok) throw new Error('Portable block map unavailable')
  const bytes = await limitedBody(response, options.map.size, signal)
  if (bytes.length !== options.map.size || createHash('sha256').update(bytes).digest('hex') !== options.map.sha256) throw new Error('Portable block map checksum mismatch')
  const map = validateBlockMap(JSON.parse(bytes.toString('utf8')), options.size)
  const local = await updateBlocks(options.source, signal)
  const { plan, downloadBytes } = planUpdate(local, map)
  // Avoid hundreds of range requests when a different package format/base offers little reuse.
  if (downloadBytes >= options.size * 0.85) throw new Error('Full download is more efficient')
  const source = await open(options.source, 'r')
  let output: Awaited<ReturnType<typeof open>> | undefined
  let transferred = 0, position = 0, lastBytes = 0, last = Date.now()
  const report = (force = false) => {
    const now = Date.now(); if (!force && now - last < 150) return
    progress({ transferred, total: downloadBytes, percent: downloadBytes ? transferred / downloadBytes * 100 : position / options.size * 100, bytesPerSecond: (transferred - lastBytes) * 1000 / Math.max(1, now - last) })
    last = now; lastBytes = transferred
  }
  progress({ transferred: 0, total: downloadBytes, percent: 0 })
  try {
    output = await open(options.destination, 'w')
    const buffer = Buffer.alloc(256 * 1024)
    for (const entry of plan) {
      signal.throwIfAborted()
      if (entry.kind === 'copy') {
        for (let read = 0; read < entry.size;) {
          signal.throwIfAborted()
          const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, entry.size - read), entry.offset + read)
          if (!bytesRead) throw new Error('Portable base file changed')
          await output.write(buffer.subarray(0, bytesRead)); options.written(bytesRead); read += bytesRead; position += bytesRead; report()
        }
      } else {
        const end = entry.offset + entry.size - 1
        const result = await request(options.url, signal, { Range: `bytes=${entry.offset}-${end}`, 'Accept-Encoding': 'identity' })
        if (result.status !== 206 || result.headers.get('content-range') !== `bytes ${entry.offset}-${end}/${options.size}` || !result.body) {
          await result.body?.cancel(); throw new Error('Update server does not support the requested range')
        }
        const reader = result.body.getReader(); let received = 0
        try {
          for (;;) {
            signal.throwIfAborted()
            const { done, value } = await reader.read(); if (done) break
            received += value.length; if (received > entry.size) throw new Error('Portable update range size mismatch')
            await output.write(value); options.written(value.length); transferred += value.length; position += value.length; report()
          }
          if (received !== entry.size) throw new Error('Portable update range was interrupted')
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      }
    }
    if (position !== options.size) throw new Error('Portable update output size mismatch')
    report(true)
    return { transferred, total: downloadBytes }
  } finally { await output?.close(); await source.close() }
}
