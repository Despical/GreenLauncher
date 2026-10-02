import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModFavorite } from '../shared/types'

export class ModFavorites {
  private items: ModFavorite[] = []
  constructor(private path: string) {
    if (existsSync(path)) try { const saved = JSON.parse(readFileSync(path, 'utf8')); if (Array.isArray(saved)) this.items = saved.filter(item => this.valid(item)).slice(0, 1000) } catch {}
  }
  private valid(item: ModFavorite) { return item && ['modrinth', 'technic', 'curseforge'].includes(item.provider) && ['mod', 'modpack'].includes(item.contentType) && typeof item.projectId === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(item.projectId) && typeof item.title === 'string' && typeof item.description === 'string' && typeof item.savedAt === 'string' }
  get() { return structuredClone(this.items) }
  set(item: ModFavorite, saved: boolean) {
    if (!this.valid(item)) throw new Error('Favori proje bilgisi geçersiz.')
    this.items = this.items.filter(value => value.provider !== item.provider || value.projectId !== item.projectId)
    if (saved) this.items.unshift({ projectId: item.projectId, provider: item.provider, contentType: item.contentType, slug: String(item.slug ?? '').slice(0, 120), title: item.title.slice(0, 200), description: item.description.slice(0, 2000), author: String(item.author ?? '').slice(0, 200), iconUrl: typeof item.iconUrl === 'string' ? item.iconUrl.slice(0, 2000) : null, downloads: Number.isFinite(item.downloads) ? item.downloads : 0, updated: String(item.updated ?? '').slice(0, 64), categories: Array.isArray(item.categories) ? item.categories.filter(value => typeof value === 'string').slice(0, 30) : [], savedAt: new Date().toISOString() })
    this.items = this.items.slice(0, 1000)
    mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(`${this.path}.tmp`, JSON.stringify(this.items), 'utf8'); renameSync(`${this.path}.tmp`, this.path)
    return this.get()
  }
}
