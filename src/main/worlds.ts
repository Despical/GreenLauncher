import { lstat, readdir, readFile, writeFile, mkdir, rename, copyFile, cp, rm, realpath } from 'node:fs/promises'
import { basename, join, resolve, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { parseUncompressed, writeUncompressed, type NBT, type Compound } from 'prismarine-nbt'
import type { LauncherStore } from './store'
import type { SavedWorld } from '../shared/types'

const limit = 16 * 1024 ** 2
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const long = (tag: Compound['value'][string]): string | undefined => {
  if (tag?.type !== 'long') return undefined
  return ((BigInt(tag.value[0]) << 32n) | BigInt(tag.value[1] >>> 0)).toString()
}
const number = (tag: Compound['value'][string]): number | undefined => {
  const value = tag?.type === 'long' ? Number(long(tag)) : tag && typeof tag.value === 'number' ? tag.value : undefined
  return value !== undefined && Number.isFinite(value) ? value : undefined
}
async function readNbt(file: string) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Dünya verileri okunamadı.')
  const bytes = await readFile(file), compressed = bytes[0] === 31 && bytes[1] === 139
  const root = parseUncompressed(compressed ? gunzipSync(bytes, { maxOutputLength: limit }) : bytes, 'big')
  if (root.type !== 'compound') throw new Error('Dünya verileri okunamadı.')
  return { root, bytes, compressed }
}
async function level(directory: string) {
  const document = await readNbt(join(directory, 'level.dat'))
  if (document.root.value.Data?.type !== 'compound') throw new Error('Dünya verileri okunamadı.')
  return { ...document, data: document.root.value.Data.value }
}
async function worldSeed(directory: string, fallback?: string): Promise<string | undefined> {
  try {
    // Minecraft 26.1 moved world generation data out of level.dat.
    for (const folder of [join(directory, 'data'), join(directory, 'data', 'minecraft')]) {
      const info = await lstat(folder)
      if (!info.isDirectory() || info.isSymbolicLink()) return fallback
    }
    const { root } = await readNbt(join(directory, 'data', 'minecraft', 'world_gen_settings.dat'))
    return (root.value.data?.type === 'compound' ? long(root.value.data.value.seed) : undefined) ?? fallback
  } catch { return fallback }
}
async function treeSize(directory: string): Promise<number> {
  let total = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Bağlantı içeren dünya klasörleri desteklenmiyor.')
    if (info.isDirectory()) total += await treeSize(path)
    else if (info.isFile()) total += info.size
  }
  return total
}
export class WorldService {
  private active = new Set<string>()
  private sizes = new Map<string, { bytes: number; at: number }>()
  constructor(private store: LauncherStore, private assertIdle: (directory: string) => void = () => {}) {}
  get isBusy() { return this.active.size > 0 }
  private async saves(profileId: string, create = false): Promise<string> {
    const profile = this.store.get().profiles.find(item => item.id === profileId)
    if (!profile) throw new Error('Profil bulunamadı.')
    const directory = join(this.store.gamePath(profile), 'saves')
    if (create) await mkdir(directory, { recursive: true })
    try { if ((await lstat(directory)).isSymbolicLink()) throw new Error('Bağlantı içeren dünya klasörleri desteklenmiyor.') } catch (error) { if (!missing(error)) throw error }
    return directory
  }
  async path(profileId: string, id: string): Promise<string> {
    if (typeof id !== 'string' || !id || id !== basename(id) || /[<>:"\\/|?*\x00-\x1f]/.test(id) || id === '.' || id === '..' || id.startsWith('.green-world-')) throw new Error('Dünya bulunamadı.')
    const saves = await this.saves(profileId), path = join(saves, id), info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || dirname(await realpath(path)).toLowerCase() !== (await realpath(saves)).toLowerCase()) throw new Error('Dünya bulunamadı.')
    await level(path)
    return path
  }
  async list(profileId: string, refresh = false): Promise<SavedWorld[]> {
    const saves = await this.saves(profileId)
    let entries
    try { entries = await readdir(saves, { withFileTypes: true }) } catch (error) { if (missing(error)) return []; throw error }
    const result: SavedWorld[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.green-world-')) continue
      const directory = join(saves, entry.name)
      try {
        const { data } = await level(directory)
        const generation = data.WorldGenSettings?.type === 'compound' ? data.WorldGenSettings.value : undefined
        const difficulty = data.difficulty_settings?.type === 'compound' ? data.difficulty_settings.value : undefined
        const version = data.Version?.type === 'compound' ? data.Version.value : undefined
        let icon: string | undefined, size: number | undefined
        try {
          const file = join(directory, 'icon.png'), info = await lstat(file)
          if (info.isFile() && !info.isSymbolicLink() && info.size <= 350000) {
            const bytes = await readFile(file)
            if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.length >= 24 && bytes.readUInt32BE(16) <= 512 && bytes.readUInt32BE(20) <= 512) icon = `data:image/png;base64,${bytes.toString('base64')}`
          }
        } catch { /* Icons are optional. */ }
        try {
          const cached = this.sizes.get(directory)
          size = !refresh && cached && Date.now() - cached.at < 30000 ? cached.bytes : await treeSize(directory)
          this.sizes.set(directory, { bytes: size, at: Date.now() })
        } catch { /* A locked or unreadable file should not hide the world. */ }
        const lastPlayed = number(data.LastPlayed)
        result.push({ id: entry.name, name: data.LevelName?.type === 'string' && data.LevelName.value ? data.LevelName.value : entry.name,
          gameMode: number(data.GameType), hardcore: number(difficulty?.hardcore ?? data.hardcore) === 1, lastPlayed: lastPlayed && lastPlayed > 0 && lastPlayed <= 8640000000000000 ? lastPlayed : undefined,
          size, icon, seed: await worldSeed(directory, long(generation?.seed) ?? long(data.RandomSeed)), version: version?.Name?.type === 'string' ? version.Name.value : undefined })
      } catch { /* Ignore non-world directories and incomplete game saves. */ }
    }
    return result.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name))
  }
  private async unlocked(path: string) {
    this.assertIdle(dirname(dirname(path)))
    // Minecraft holds an OS lock on session.lock while the world is open.
    try { await readFile(join(path, 'session.lock')) } catch (error) { if (!missing(error)) throw new Error('Dünya açıkken bu işlem yapılamaz.') }
  }
  private async mutate<T>(profileId: string, action: (saves: string) => Promise<T>): Promise<T> {
    const saves = await this.saves(profileId, true), key = resolve(saves).toLowerCase()
    if (this.active.has(key)) throw new Error('Başka bir dünya işlemi devam ediyor.')
    this.assertIdle(dirname(saves)); this.active.add(key)
    try { return await action(saves) } finally { this.active.delete(key) }
  }
  async rename(profileId: string, id: string, name: string) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('Geçerli bir dünya adı gir.')
    return this.mutate(profileId, async () => {
      const path = await this.path(profileId, id); await this.unlocked(path)
      const document = await level(path), original = hash(document.bytes)
      document.data.LevelName = { type: 'string', value: name.trim() }
      const bytes = writeUncompressed(document.root, 'big')
      if (bytes.length > limit) throw new Error('Dünya verileri okunamadı.')
      const file = join(path, 'level.dat'), temp = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, document.compressed ? gzipSync(bytes) : bytes, { flag: 'wx' })
        await this.unlocked(path)
        if (hash(await readFile(file)) !== original) throw new Error('Dünya oyunda değişti. İşlemi yeniden dene.')
        try { await copyFile(file, `${file}.green-launcher-backup`, 1) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
        await rename(temp, file)
      } finally { await rm(temp, { force: true }) }
    })
  }
  private async copy(source: string, saves: string, name?: string): Promise<string> {
    if ((await lstat(source)).isSymbolicLink()) throw new Error('Bağlantı içeren dünya klasörleri desteklenmiyor.')
    await level(source); await this.unlocked(source); await treeSize(source)
    const base = basename(source).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').slice(0, 80) || 'World'
    let id = base, index = 1
    while (true) { try { await lstat(join(saves, id)); id = `${base} (${index++})` } catch (error) { if (missing(error)) break; throw error } }
    const staging = join(saves, `.green-world-${randomUUID()}`)
    try {
      await cp(source, staging, { recursive: true, errorOnExist: true, force: false, filter: async path => {
        const info = await lstat(path)
        if (info.isSymbolicLink()) throw new Error('Bağlantı içeren dünya klasörleri desteklenmiyor.')
        return basename(path) !== 'session.lock'
      } })
      if (name) {
        const document = await level(staging); document.data.LevelName = { type: 'string', value: name }
        const bytes = writeUncompressed(document.root, 'big'); await writeFile(join(staging, 'level.dat'), document.compressed ? gzipSync(bytes) : bytes)
      }
      await level(staging); await this.unlocked(source); this.assertIdle(dirname(saves))
      await rename(staging, join(saves, id)); return id
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  async import(profileId: string, source: string): Promise<string> {
    return this.mutate(profileId, async saves => {
      const target = (await realpath(saves)).toLowerCase(), origin = (await realpath(source)).toLowerCase()
      if (target === origin || target.startsWith(origin + '\\') || target.startsWith(origin + '/')) throw new Error('Bir dünya klasörü seç.')
      return this.copy(source, saves)
    })
  }
  async duplicate(profileId: string, id: string, name: string): Promise<string> {
    if (typeof name !== 'string' || !name.trim() || /[\x00-\x1f]/.test(name)) throw new Error('Geçerli bir dünya adı gir.')
    return this.mutate(profileId, async saves => this.copy(await this.path(profileId, id), saves, name.slice(0, 100)))
  }
  async launch<T>(profileId: string, id: string, start: () => Promise<T>): Promise<T> {
    return this.mutate(profileId, async () => { const path = await this.path(profileId, id); await this.unlocked(path); return start() })
  }
  async resetIcon(profileId: string, id: string) {
    return this.mutate(profileId, async () => { const path = await this.path(profileId, id); await this.unlocked(path); await rm(join(path, 'icon.png'), { force: true }) })
  }
  async delete(profileId: string, id: string, trash: (path: string) => Promise<void>) {
    return this.mutate(profileId, async () => { const path = await this.path(profileId, id); await this.unlocked(path); await trash(path) })
  }
}
