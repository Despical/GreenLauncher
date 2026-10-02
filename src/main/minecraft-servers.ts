import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { parseUncompressed, writeUncompressed, type NBT, type List, TagType } from 'prismarine-nbt'
import { normalizeServerAddress } from '../shared/server-launch'

export type MinecraftServerEntry = List<TagType.Compound>['value']['value'][number]
export type MinecraftServerList = { root: NBT; entries: MinecraftServerEntry[]; compressed: boolean; hash: string | null }
const fingerprint = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
export function serverAddressKey(address: string): string | undefined {
  try { return normalizeServerAddress(address)?.toLowerCase().replace(/:25565$/, '') } catch { return undefined }
}
export function readMinecraftServers(directory: string): MinecraftServerList {
  const file = join(directory, 'servers.dat')
  let root: NBT = { type: 'compound', name: '', value: {} }, compressed = false, hash: string | null = null
  if (existsSync(file)) {
    try {
      if (statSync(file).size > 8 * 1024 ** 2) throw new Error('too large')
      let bytes = readFileSync(file); hash = fingerprint(bytes)
      compressed = bytes[0] === 0x1f && bytes[1] === 0x8b
      if (compressed) bytes = gunzipSync(bytes, { maxOutputLength: 8 * 1024 ** 2 })
      root = parseUncompressed(bytes, 'big')
      if (root.type !== 'compound') throw new Error('invalid root')
    } catch { throw new Error('Minecraft sunucu listesi okunamadı. Mevcut dosya korunuyor.') }
  }
  let list = root.value.servers
  if (list && (list.type !== 'list' || (list.value.type !== 'compound' && list.value.value.length))) throw new Error('Minecraft sunucu listesi okunamadı. Mevcut dosya korunuyor.')
  if (!list || !list.value.value.length) root.value.servers = list = { type: 'list', value: { type: 'compound', value: [] } }
  return { root, entries: (list as List<TagType.Compound>).value.value, compressed, hash }
}
export function writeMinecraftServers(directory: string, document: MinecraftServerList): void {
  const file = join(directory, 'servers.dat'), temp = `${file}.${randomUUID()}.tmp`
  const bytes = writeUncompressed(document.root, 'big')
  if (bytes.length > 8 * 1024 ** 2) throw new Error('Minecraft sunucu listesi okunamadı. Mevcut dosya korunuyor.')
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(temp, document.compressed ? gzipSync(bytes) : bytes)
    const current = existsSync(file) ? fingerprint(readFileSync(file)) : null
    if (current !== document.hash) throw new Error('Sunucu listesi oyunda değişti. İşlemi yeniden dene.')
    if (current && !existsSync(`${file}.green-launcher-backup`)) copyFileSync(file, `${file}.green-launcher-backup`)
    renameSync(temp, file)
  } finally { rmSync(temp, { force: true }) }
}
