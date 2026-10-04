import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import yauzl from 'yauzl'

export interface ModMetadata { title?: string; description?: string; versionNumber?: string; icon?: string }
const metadataNames = new Set(['fabric.mod.json', 'quilt.mod.json', 'META-INF/neoforge.mods.toml', 'META-INF/mods.toml', 'mcmod.info', 'litemod.json', 'META-INF/MANIFEST.MF'])
const string = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 8000) : undefined
const iconPath = (value: unknown): string | undefined => {
  if (typeof value === 'object' && value) value = Object.entries(value).filter(([size, path]) => /^\d+$/.test(size) && typeof path === 'string').sort(([a], [b]) => Math.abs(Number(a) - 64) - Math.abs(Number(b) - 64))[0]?.[1]
  const path = string(value)
  return path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(part => part === '..' || part === '.') && /\.(png|jpe?g|webp)$/i.test(path) ? path : undefined
}

// Read only requested entries, with bounds on entry count and decompressed bytes.
function entries(path: string, names: Set<string>): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error); return }
      const found = new Map<string, Buffer>(); let count = 0, settled = false
      const finish = (error?: unknown) => { if (settled) return; settled = true; zip.close(); error ? reject(error) : resolve(found) }
      zip.on('error', finish)
      zip.on('end', () => finish())
      zip.on('entry', entry => {
        if (++count > 30000) { finish(new Error('Mod archive entry limit')); return }
        if (!names.has(entry.fileName)) { zip.readEntry(); return }
        if (entry.uncompressedSize > 2 * 1024 * 1024) { finish(new Error('Mod metadata size limit')); return }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { finish(error ?? new Error('Mod metadata stream')); return }
          let size = 0; const chunks: Buffer[] = []
          stream.on('error', finish)
          stream.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) { stream.destroy(); finish(new Error('Mod metadata size limit')) } else chunks.push(Buffer.from(chunk)) })
          stream.on('end', () => { if (!settled) { found.set(entry.fileName, Buffer.concat(chunks)); found.size === names.size ? finish() : zip.readEntry() } })
        })
      })
      zip.readEntry()
    })
  })
}

export async function modFileHash(path: string): Promise<string> {
  const hash = createHash('sha1')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function inspectMod(path: string): Promise<ModMetadata> {
  try {
    const files = await entries(path, metadataNames)
    const json = (name: string) => files.has(name) ? JSON.parse(files.get(name)!.toString('utf8')) : undefined
    let info = json('fabric.mod.json'), icon: unknown
    if (info) icon = info.icon
    else {
      const quilt = json('quilt.mod.json')?.quilt_loader
      if (quilt) { info = { ...quilt.metadata, version: quilt.version }; icon = info.icon }
      else {
        const toml = files.get('META-INF/neoforge.mods.toml') ?? files.get('META-INF/mods.toml')
        if (toml) {
          const text = toml.toString('utf8'), section = text.split(/\[\[mods\]\]/)[1]?.split(/\n\s*\[/)[0] ?? ''
          const field = (key: string, source = section) => {
            const match = source.match(new RegExp('^\\s*' + key + '\\s*=\\s*(?:"""([\\s\\S]*?)"""|\x27\x27\x27([\\s\\S]*?)\x27\x27\x27|"([^"\\n]*)"|\x27([^\x27\\n]*)\x27)', 'm'))
            return match && (match[1] ?? match[2] ?? match[3] ?? match[4])
          }
          info = { name: field('displayName') ?? field('modId'), version: field('version'), description: field('description') }; icon = field('logoFile') ?? field('logoFile', text.split(/\[\[mods\]\]/)[0])
        } else {
          const legacy = json('mcmod.info')
          info = (Array.isArray(legacy) ? legacy[0] : legacy?.modList?.[0]) ?? json('litemod.json')
          icon = info?.logoFile ?? info?.icon
        }
      }
    }
    const manifest = files.get('META-INF/MANIFEST.MF')?.toString('utf8').replace(/\r?\n /g, '')
    const implementationVersion = manifest?.match(/^Implementation-Version:\s*(.+)$/m)?.[1].trim()
    const version = string(info?.version)
    const result: ModMetadata = { title: string(info?.name ?? info?.displayName), description: string(info?.description), versionNumber: version?.includes('${') ? implementationVersion : version ?? implementationVersion }
    const name = iconPath(icon)
    if (name) {
      const bytes = (await entries(path, new Set([name])).catch(() => new Map<string, Buffer>())).get(name)
      const type = bytes?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : bytes?.[0] === 255 && bytes[1] === 216 ? 'jpeg' : bytes?.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'webp' : undefined
      if (bytes && type) result.icon = `data:image/${type};base64,${bytes.toString('base64')}`
    }
    return result
  } catch { return {} }
}
