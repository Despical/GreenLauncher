import { nativeImage } from 'electron'
import { lstat, readFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import { inspectMod } from './mod-metadata'
import { normalizeProfileIcon } from '../shared/profile-icons'

const maxImageBytes = 2 * 1024 * 1024
const safeImagePath = (name: string) => !name.startsWith('/') && !/[\\:]/.test(name)
  && name.split('/').every(part => part && part !== '.' && part !== '..') && /\.(png|jpe?g|webp|ico)$/i.test(name)

async function fileInfo(path: string) {
  try { const info = await lstat(path); return info.isFile() && !info.isSymbolicLink() ? info : undefined } catch { return undefined }
}

function thumbnail(bytes: Buffer): string | undefined {
  try {
    if (!bytes.length || bytes.length > maxImageBytes) return
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && (bytes.length < 24 || bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) > 4096)) return
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return
    const { width, height } = image.getSize()
    if (!width || !height || width > 4096 || height > 4096) return
    const scale = Math.min(1, 128 / width, 128 / height)
    const icon = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' }) : image
    return normalizeProfileIcon({ enabled: true, type: 'custom', image: icon.toDataURL() }).image
  } catch { return undefined }
}

function priority(name: string): number {
  const file = basename(name).toLowerCase()
  const size = file.match(/(?:icon|logo)[_-]?(\d+)(?:x\d+)?\.png$/)?.[1]
  const dimension = size ? Math.abs(Math.log2(Number(size) / 128)) : 0
  if (/^(?:client[-_])?icon(?:[_-]\d+(?:x\d+)?)?\.png$/.test(file)) return (name.includes('/') ? 10 : 0) + dimension
  if (/^(?:client[-_])?logo(?:[_-]\d+(?:x\d+)?)?\.png$/.test(file)) return (name.includes('/') ? 30 : 20) + dimension
  if (/^(?:icon|logo)\.ico$/.test(file)) return 40
  return Infinity
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolveBytes, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { reject(error ?? new Error('Client icon stream unavailable')); return }
      const chunks: Buffer[] = []; let size = 0
      stream.on('error', reject)
      stream.on('data', chunk => {
        size += chunk.length
        if (size > maxImageBytes) stream.destroy(new Error('Client icon size limit'))
        else chunks.push(Buffer.from(chunk))
      })
      stream.on('end', () => resolveBytes(Buffer.concat(chunks)))
    })
  })
}

function jarIcon(path: string): Promise<string | undefined> {
  return new Promise(resolveIcon => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { resolveIcon(undefined); return }
      const candidates: Entry[] = []; let count = 0, settled = false
      const finish = (image?: string) => { if (settled) return; settled = true; zip.close(); resolveIcon(image) }
      zip.on('error', () => finish())
      zip.on('entry', entry => {
        if (++count > 50000) { finish(); return }
        if (entry.uncompressedSize <= maxImageBytes && safeImagePath(entry.fileName) && Number.isFinite(priority(entry.fileName))) {
          candidates.push(entry)
          candidates.sort((a, b) => priority(a.fileName) - priority(b.fileName) || a.fileName.localeCompare(b.fileName))
          candidates.splice(8)
        }
        zip.readEntry()
      })
      zip.on('end', () => {
        void (async () => {
          for (const entry of candidates) {
            if (settled) return
            const bytes = await readEntry(zip, entry).catch(() => undefined)
            const image = bytes && thumbnail(bytes)
            if (image) { finish(image); return }
          }
          finish()
        })().catch(() => finish())
      })
      zip.readEntry()
    })
  })
}

/** Optional local artwork for imported clients; never executes or changes their files. */
export class CustomClientIcons {
  private cache = new Map<string, { signature: string; image: Promise<string | undefined> }>()
  constructor(private readonly minecraftPath: string) {}

  async icon(id: string): Promise<string | undefined> {
    if (!/^(?!\.\.?$)[a-zA-Z0-9._-]{1,90}$/.test(id)) return
    try {
      const directory = join(this.minecraftPath, 'versions', id)
      const folder = await lstat(directory)
      if (!folder.isDirectory() || folder.isSymbolicLink()) return
      const descriptorPath = join(directory, id + '.json'), descriptorInfo = await fileInfo(descriptorPath)
      if (!descriptorInfo || descriptorInfo.size > 2_000_000) return
      const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as { greenLauncherCustom?: boolean; icon?: unknown; logo?: unknown }
      if (descriptor.greenLauncherCustom !== true) return
      const declared = [descriptor.icon, descriptor.logo].filter((value): value is string => typeof value === 'string' && safeImagePath(value))
      const names = [...new Set([...declared, 'icon.png', 'client-icon.png', id + '.png', 'logo.png', 'icon.ico'])]
      const images: Array<{ path: string; size: number; mtimeMs: number }> = []
      for (const name of names) {
        const path = resolve(directory, name)
        if (!path.startsWith(resolve(directory) + sep)) continue
        let parent = directory, safe = true
        for (const part of name.split('/').slice(0, -1)) {
          parent = join(parent, part)
          const info = await lstat(parent).catch(() => undefined)
          if (!info?.isDirectory() || info.isSymbolicLink()) { safe = false; break }
        }
        const info = safe && await fileInfo(path)
        if (info && info.size <= maxImageBytes) images.push({ path, size: info.size, mtimeMs: info.mtimeMs })
      }
      const jarPath = join(directory, id + '.jar'), jar = await fileInfo(jarPath)
      const signature = JSON.stringify([descriptorInfo.size, descriptorInfo.mtimeMs, images, jar?.size, jar?.mtimeMs])
      const cached = this.cache.get(id)
      if (cached?.signature === signature) return cached.image
      const image = (async () => {
        for (const source of images) {
          const icon = thumbnail(await readFile(source.path))
          if (icon) return icon
        }
        if (!jar) return
        const metadata = await inspectMod(jarPath)
        if (metadata.icon) {
          const icon = thumbnail(Buffer.from(metadata.icon.split(',')[1], 'base64'))
          if (icon) return icon
        }
        return jarIcon(jarPath)
      })().catch(() => undefined)
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!)
      this.cache.set(id, { signature, image })
      return image
    } catch { return undefined }
  }
}
