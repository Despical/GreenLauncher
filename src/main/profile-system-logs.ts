import { existsSync } from 'node:fs'
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { SystemLogDocument, SystemLogFile } from '../shared/types'
import { LauncherStore } from './store'
import { GameService } from './game'
import { safePath } from './modpack'
import { gameLogLevel, redactGameLog } from './game-console'

const limit = 8 * 1024 ** 2
const allowed = (file: string) => /^(?:logs\/[^/]+\.(?:log|txt)(?:\.gz)?|crash-reports\/[^/]+\.txt|hs_err_pid\d+\.log)$/i.test(file)
export class ProfileSystemLogs {
  constructor(private store: LauncherStore, private game: GameService) {}
  private root(id: string) {
    const profile = this.store.get().profiles.find(item => item.id === id)
    if (!profile) throw new Error('Profil bulunamadı.')
    const root = this.store.gamePath(profile)
    const child = relative(root, this.store.dataPath)
    if (!child || child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) throw new Error('Geçersiz günlük klasörü.')
    return root
  }
  private async path(id: string, file: string) {
    if (typeof file !== 'string' || !allowed(file)) throw new Error('Geçersiz günlük dosyası.')
    const root = this.root(id), target = safePath(root, file)
    for (let part = target; ; part = dirname(part)) {
      if ((await lstat(part)).isSymbolicLink()) throw new Error('Geçersiz günlük dosyası.')
      if (part === root) break
      if (dirname(part) === part) throw new Error('Geçersiz günlük dosyası.')
    }
    const canonical = relative(await realpath(root), await realpath(target))
    if (isAbsolute(canonical) || canonical.startsWith('..')) throw new Error('Geçersiz günlük dosyası.')
    return target
  }
  async list(id: string): Promise<SystemLogFile[]> {
    const root = this.root(id), files: SystemLogFile[] = []
    for (const folder of ['', 'logs', 'crash-reports']) {
      const directory = join(root, folder)
      if (!existsSync(directory) || (await lstat(directory)).isSymbolicLink()) continue
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = folder ? `${folder}/${entry.name}` : entry.name
        if (!entry.isFile() || !allowed(filename)) continue
        const path = await this.path(id, filename), info = await lstat(path)
        files.push({ filename, bytes: info.size, modifiedAt: info.mtime.toISOString(), compressed: filename.endsWith('.gz') })
        if (files.length >= 2000) break
      }
    }
    return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.filename.localeCompare(b.filename))
  }
  async read(id: string, filename: string): Promise<SystemLogDocument> {
    const path = await this.path(id, filename), handle = await open(path, 'r')
    let buffer: Buffer, truncated = false
    try {
      const info = await handle.stat()
      if (!info.isFile()) throw new Error('Geçersiz günlük dosyası.')
      if (filename.endsWith('.gz')) {
        if (info.size > limit) throw new Error('Günlük dosyası çok büyük.')
        buffer = gunzipSync(await handle.readFile(), { maxOutputLength: limit })
      } else {
        truncated = info.size > limit
        buffer = Buffer.alloc(Math.min(info.size, limit))
        const result = await handle.read(buffer, 0, buffer.length, Math.max(0, info.size - limit)); buffer = buffer.subarray(0, result.bytesRead)
      }
    } finally { await handle.close() }
    let text = redactGameLog(buffer.toString('utf8'))
    if (truncated) text = text.slice(text.indexOf('\n') + 1)
    let lines = text.replace(/\r\n/g, '\n').split('\n')
    if (lines.length > 10000) { lines = lines.slice(-10000); truncated = true }
    let level: ReturnType<typeof gameLogLevel> = 'info'
    return { filename, truncated, lines: lines.map((text, index) => ({ seq: index + 1, text: text.slice(0, 16384), level: level = gameLogLevel(text, level) })) }
  }
  async remove(id: string, filenames: string[]): Promise<void> {
    this.root(id)
    if (this.game.getLaunchState().preparing || this.game.getRunningInstances().some(item => item.profileId === id)) throw new Error('Bu işlem için önce profilin açık oyununu kapatın.')
    if (!Array.isArray(filenames) || filenames.length > 2000) throw new Error('Geçersiz günlük dosyası.')
    const paths = await Promise.all([...new Set(filenames)].map(file => this.path(id, file)))
    // Validate the entire selection before deleting any file. Never remove directories.
    for (const path of paths) if (!(await lstat(path)).isFile()) throw new Error('Geçersiz günlük dosyası.')
    for (const path of paths) await unlink(path)
  }
}
