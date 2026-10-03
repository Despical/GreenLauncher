import type { GameVersion, LauncherProfile, LauncherState, ProfileLoader, ProfileVersionResult } from '../shared/types'
import type { LauncherStore } from './store'

interface VersionRuntime {
  versions(): Promise<GameVersion[]>
  isInstalled(id: string): boolean
  install(id: string): Promise<void>
  installOptifine(baseId: string): Promise<string>
  installModLoader(gameVersion: string, loader: NonNullable<LauncherProfile['modLoader']>, profile: LauncherProfile): Promise<string>
  profileVersion(id: string): Pick<LauncherProfile, 'versionId' | 'modLoader' | 'modLoaderVersion'>
}
export class ProfileVersions {
  constructor(private store: LauncherStore, private game: VersionRuntime, private busy: (id: string) => boolean, private activeMods: (id: string) => Promise<number>) {}
  private profile(id: string) {
    const profile = this.store.get().profiles.find(item => item.id === id)
    if (!profile) throw new Error('Profil bulunamadı.')
    return profile
  }
  async configure(profileId: string, minecraftVersion: string, requestedLoader?: ProfileLoader, acknowledged = false): Promise<ProfileVersionResult> {
    if (this.busy(profileId)) throw new Error('Sürümü değiştirmek için oyunu ve devam eden kurulumu kapat.')
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(minecraftVersion)) throw new Error('Geçersiz Minecraft sürümü.')
    if (requestedLoader !== undefined && !['none', 'optifine', 'fabric', 'forge', 'neoforge', 'quilt', 'liteloader'].includes(requestedLoader)) throw new Error('Geçersiz mod yükleyicisi.')
    const profile = structuredClone(this.profile(profileId))
    if (profile.modpack) throw new Error('Bu mod paketinin sürümü ve yükleyicisi paket tarafından yönetilir.')
    const base = profile.versionId.split(/-OptiFine_/i)[0], currentLoader: ProfileLoader = profile.modLoader ?? (/-OptiFine_/i.test(profile.versionId) ? 'optifine' : 'none')
    const loader = requestedLoader ?? (minecraftVersion === base ? currentLoader : 'none')
    const versions = await this.game.versions()
    const chosen = versions.find(version => version.id === minecraftVersion)
    if (!chosen || this.game.profileVersion(minecraftVersion).modLoader || /-OptiFine_/i.test(minecraftVersion)) throw new Error('Minecraft sürümü bulunamadı.')
    if (chosen.custom && loader !== 'none') throw new Error('Özel istemcilere bu sayfadan yükleyici eklenemez.')
    if (loader === 'optifine' && !chosen.optifineAvailable && !chosen.optifineVersions.length) throw new Error('Bu Minecraft sürümü için OptiFine bulunamadı.')
    const signature = (item: LauncherProfile) => JSON.stringify([item.accountId, item.versionId, item.modLoader, item.modLoaderVersion, item.gameDirectory, item.modpack])
    const revalidate = () => {
      if (this.busy(profileId)) throw new Error('Sürümü değiştirmek için oyunu ve devam eden kurulumu kapat.')
      if (signature(this.profile(profileId)) !== signature(profile)) throw new Error('Profil ayarları değişti. Tekrar dene.')
    }
    const mods = minecraftVersion !== base || loader !== currentLoader ? await this.activeMods(profileId) : 0
    revalidate()
    if (mods && !acknowledged) return { status: 'confirmation-required', activeMods: mods }
    let version: Pick<LauncherProfile, 'versionId' | 'modLoader' | 'modLoaderVersion'>
    if (loader === 'none') {
      if (!this.game.isInstalled(minecraftVersion)) await this.game.install(minecraftVersion)
      version = { versionId: minecraftVersion }
    } else if (loader === 'optifine') {
      const installed = requestedLoader === undefined && minecraftVersion === base && currentLoader === loader && this.game.isInstalled(profile.versionId) ? profile.versionId : undefined
      const id = installed ?? await this.game.installOptifine(minecraftVersion)
      version = { versionId: id }
    } else {
      const id = await this.game.installModLoader(minecraftVersion, loader, profile)
      version = { versionId: minecraftVersion, modLoader: loader, modLoaderVersion: id }
    }
    revalidate()
    const state: LauncherState = this.store.setProfileVersion(profileId, version)
    return { status: 'configured', state }
  }
}
