import { nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { heroBackgroundId, maxHeroBackgrounds } from '../shared/hero-backgrounds'
import type { HeroBackground } from '../shared/types'

export class HeroBackgrounds {
  private readonly directory: string
  constructor(dataPath: string) { this.directory = join(dataPath, 'backgrounds') }
  private file(id: string): string {
    if (typeof id !== 'string' || !heroBackgroundId.test(id)) throw new Error('Geçersiz arka plan kimliği.')
    return join(this.directory, `${id}.jpg`)
  }
  async add(paths: string[]): Promise<HeroBackground[]> {
    if (!Array.isArray(paths) || paths.length > maxHeroBackgrounds) throw new Error('Çok fazla arka plan seçildi.')
    const prepared: Array<{ background: HeroBackground; bytes: Buffer }> = []
    for (const file of paths) {
      if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extname(file).toLowerCase()) || (await stat(file)).size > 32 * 1024 ** 2) throw new Error('PNG, JPG veya WebP görseli seç; dosya en fazla 32 MB olabilir.')
      const image = nativeImage.createFromBuffer(await readFile(file))
      if (image.isEmpty()) throw new Error('Arka plan görseli açılamadı.')
      const { width, height } = image.getSize(), scale = Math.min(1, 4096 / width, 2048 / height)
      const resized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' }) : image
      prepared.push({ background: { id: randomUUID(), name: basename(file, extname(file)).slice(0, 80), enabled: true }, bytes: resized.toJPEG(90) })
    }
    await mkdir(this.directory, { recursive: true })
    const written: string[] = []
    try {
      for (const item of prepared) { const file = this.file(item.background.id); written.push(file); await writeFile(file, item.bytes, { flag: 'wx' }) }
    } catch (error) { await Promise.all(written.map(file => unlink(file).catch(() => {}))); throw error }
    return prepared.map(item => item.background)
  }
  async read(id: string, thumbnail = false): Promise<string | null> {
    const file = this.file(id)
    try {
      const bytes = await readFile(file)
      if (!thumbnail) return `data:image/jpeg;base64,${bytes.toString('base64')}`
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) return null
      const size = image.getSize(), scale = Math.min(1, 280 / size.width, 160 / size.height)
      return image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }).toDataURL()
    } catch { return null }
  }
  async remove(id: string): Promise<void> { await unlink(this.file(id)).catch(() => {}) }
}
