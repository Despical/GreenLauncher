import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, lstatSync } from 'node:fs'
import { copyFile, lstat, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import type { LauncherProfile, LauncherState, ModLoader, ModProvider, ModpackInstallTarget } from '../shared/types'
import { LauncherStore } from './store'
import { GameService } from './game'
import { ProfilePackages } from './profile-packages'
import { safePath } from './modpack'

const protectedFile = (file: string) => {
  file = file.replace(/\\/g, '/')
  return /^(?:saves|logs|crash-reports|screenshots|cache|versions|libraries|assets|natives)(?:\/|$)/i.test(file) || /^(?:servers\.dat(?:_old)?|options[^/]*\.txt|launcher_[^/]*|usercache\.json|usernamecache\.json)$/i.test(file)
}
async function checked(root: string, file: string): Promise<string> {
  const target = safePath(root, file)
  for (let part = target; ; part = dirname(part)) {
    try {
      if ((await lstat(part)).isSymbolicLink()) throw new Error('Profil dosyasında bağlantı bulundu.')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (part === root) break
    if (dirname(part) === part) throw new Error('Geçersiz dosya yolu.')
  }
  return target
}
function manifest(root: string): string[] {
  const file = join(root, 'green-launcher-pack.json')
  if (!existsSync(file)) return []
  const info = lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 ** 2) throw new Error('Profil kurulum bilgisi geçersiz.')
  const value = JSON.parse(readFileSync(file, 'utf8')) as { files?: unknown }
  if (!Array.isArray(value.files) || value.files.length > 20000 || value.files.some(file => typeof file !== 'string')) throw new Error('Profil kurulum bilgisi geçersiz.')
  return value.files as string[]
}

/** Stage through the verified provider installer before touching an existing profile. */
export class ProfilePackInstalls {
  constructor(private store: LauncherStore, private game: GameService, private packages: ProfilePackages,
    private stage: (version: string, minecraft: string, loader: ModLoader, provider: ModProvider) => Promise<{ state: LauncherState; profileId: string }>) {}
  private profile(id: string): LauncherProfile {
    const profile = this.store.get().profiles.find(item => item.id === id)
    if (!profile?.modpack) throw new Error('Profil bulunamadı.')
    if (this.game.getRunningInstances().some(item => item.profileId === id) || this.game.getLaunchState().preparing) throw new Error('Bu işlem için önce profilin açık oyununu kapatın.')
    return structuredClone(profile)
  }
  private async discard(id: string) {
    const root = this.store.profilePath(id)
    this.store.deleteProfile(id)
    await rm(root, { recursive: true, force: true })
  }
  async install(id: string, version: string, minecraft: string, loader: ModLoader, target: ModpackInstallTarget): Promise<{ state: LauncherState; profileId: string }> {
    if (!['current', 'copy', 'new'].includes(target)) throw new Error('Geçersiz kurulum hedefi.')
    const original = this.profile(id), owner = this.store.get().selectedAccountId, previous = this.store.get().selectedProfileId
    const fingerprint = (profile: LauncherProfile) => JSON.stringify([profile.versionId, profile.modLoader, profile.modLoaderVersion, profile.gameDirectory, profile.modpack])
    let stagedId: string | undefined, copyId: string | undefined
    try {
      const staged = await this.stage(version, minecraft, loader, original.modpack!.provider ?? 'modrinth'); stagedId = staged.profileId
      const installed = this.profile(stagedId)
      if (owner !== this.store.get().selectedAccountId || fingerprint(this.profile(id)) !== fingerprint(original)) throw new Error('Profil değişti. İşlemi yeniden başlatın.')
      if (installed.modpack!.projectId !== original.modpack!.projectId || (installed.modpack!.provider ?? 'modrinth') !== (original.modpack!.provider ?? 'modrinth')) throw new Error('Paket sürümü bu projeye ait değil.')
      if (target === 'new') { this.store.selectProfile(stagedId); stagedId = undefined; return { state: this.store.get(), profileId: staged.profileId } }
      const destination = target === 'copy' ? (copyId = (await this.packages.clone(id)).profileId) : id
      this.profile(id); this.profile(destination)
      if (owner !== this.store.get().selectedAccountId || fingerprint(this.profile(id)) !== fingerprint(original)) throw new Error('Profil değişti. İşlemi yeniden başlatın.')
      await this.apply(destination, installed)
      await this.discard(stagedId); stagedId = undefined
      this.store.selectProfile(target === 'copy' ? destination : previous && this.store.get().profiles.some(item => item.id === previous) ? previous : destination)
      copyId = undefined
      return { state: this.store.get(), profileId: destination }
    } finally {
      if (stagedId) await this.discard(stagedId)
      if (copyId) await this.discard(copyId)
      if ((stagedId || copyId) && previous && this.store.get().profiles.some(item => item.id === previous)) this.store.selectProfile(previous)
    }
  }
  private async apply(id: string, installed: LauncherProfile) {
    const original = this.profile(id), root = this.store.gamePath(original), owned = this.store.profilePath(id), source = this.store.profilePath(installed.id)
    for (const protectedRoot of [this.store.dataPath, join(this.store.dataPath, 'profiles')]) {
      const child = relative(root, protectedRoot)
      if (!child || child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) throw new Error('Oyun klasörü launcher verilerini içeriyor. Profil ayarlarında ayrı bir oyun klasörü seçin.')
    }
    const backup = join(this.store.dataPath, 'backups', 'profile-packages', id, randomUUID())
    const files = new Map<string, { destination: string; source?: string; backup?: string }>()
    const add = async (base: string, file: string, replacement?: string) => {
      const destination = await checked(base, file), key = destination.toLowerCase(), old = files.get(key)
      if (old && replacement && old.source) throw new Error('Profil kurulum bilgisi geçersiz.')
      const item = old ?? { destination }
      if (replacement) { const info = await lstat(replacement); if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 ** 2) throw new Error('Profil kurulum bilgisi geçersiz.'); item.source = replacement }
      files.set(key, item)
    }
    await checked(owned, 'green-launcher-pack.json'); await checked(source, 'green-launcher-pack.json')
    for (const file of manifest(owned)) {
      if (protectedFile(file)) continue
      await add(root, file)
      if (/\.jar$/i.test(file) && existsSync(safePath(root, `${file}.disabled`))) await add(root, `${file}.disabled`)
    }
    for (const file of manifest(source)) if (!protectedFile(file)) await add(root, file, await checked(source, file))
    await add(owned, 'green-launcher-pack.json', join(source, 'green-launcher-pack.json'))
    // Provider indexes describe old hashes. Keep them in the backup and re-identify new files.
    await add(owned, 'green-launcher-mods.json')
    await mkdir(backup, { recursive: true })
    let bytes = 0
    for (const [index, item] of [...files.values()].entries()) {
      if (!existsSync(item.destination)) continue
      const info = await lstat(item.destination)
      bytes += info.size
      if (!info.isFile() || info.isSymbolicLink() || bytes > 2 * 1024 ** 3) throw new Error('Profil kurulum bilgisi geçersiz.')
      item.backup = join(backup, String(index)); await copyFile(item.destination, item.backup)
    }
    await writeFile(join(backup, 'manifest.json'), JSON.stringify({ profileId: id, versionId: original.versionId, modLoader: original.modLoader, modLoaderVersion: original.modLoaderVersion, modpack: original.modpack, files: [...files.values()].map(item => ({ destination: item.destination, backup: item.backup ? relative(backup, item.backup) : null })) }, null, 2))
    const changed: Array<{ destination: string; source?: string; backup?: string }> = []
    try {
      for (const item of files.values()) {
        await checked(item.destination.startsWith(owned + sep) ? owned : root, relative(item.destination.startsWith(owned + sep) ? owned : root, item.destination).replace(/\\/g, '/'))
        changed.push(item)
        if (item.source) { await mkdir(dirname(item.destination), { recursive: true }); await copyFile(item.source, item.destination) }
        else if (existsSync(item.destination)) await unlink(item.destination)
      }
      this.store.setProfileVersion(id, installed)
      this.store.setModpack(id, installed.modpack!)
    } catch (error) {
      for (const item of changed.reverse()) {
        if (item.backup) await copyFile(item.backup, item.destination)
        else if (existsSync(item.destination)) await unlink(item.destination)
      }
      this.store.setProfileVersion(id, original); this.store.setModpack(id, original.modpack!)
      throw error
    }
  }
}
