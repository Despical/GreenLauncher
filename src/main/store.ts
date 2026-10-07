import { app, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { offlineAccount } from './offline-account'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { GameAccount, LauncherProfile, LauncherSettings, LauncherState, ProfileCover, PlaySession } from '../shared/types'
import { normalizeServerAddress } from '../shared/server-launch'
import { profilePlaytime } from '../shared/profile-settings'
import { normalizeProfileIcon } from '../shared/profile-icons'
import { minecraftWindowSize } from './game-window'
import { normalizeHeroSettings } from '../shared/hero-backgrounds'

function defaultSettings(): LauncherSettings {
  const primary = screen.getPrimaryDisplay()
  const display = primary.workAreaSize ?? primary.bounds
  const window = minecraftWindowSize({ width: 1280, height: 720 }, display)
  return {
  language: 'tr',
  javaPath: '',
  memoryMb: 4096,
  width: window.width,
  height: window.height,
    closeOnLaunch: false,
    showSnapshots: false,
    animateHero: true,
    ...normalizeHeroSettings({}),
    discordPresence: true,
    minimizeToTray: false,
    downloadSpeedLimitKiB: 0,
    pauseDownloadsWhilePlaying: false,
    downloadConcurrency: 6,
    savePlaytime: true,
    showPlaytime: true,
    showTotalPlaytime: true
  }
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

export class LauncherStore {
  readonly dataPath = app.getPath('userData')
  readonly minecraftPath = join(this.dataPath, 'minecraft')
  private readonly filePath = join(this.dataPath, 'launcher.json')
  private state: LauncherState
  private selections: Record<string, { profileId: string | null; versionId: string | null }> = {}

  constructor() {
    const defaults = defaultSettings()
    mkdirSync(this.dataPath, { recursive: true })
    mkdirSync(this.minecraftPath, { recursive: true })
    let saved: Partial<LauncherState> & { accountSelections?: Record<string, { profileId: string | null; versionId: string | null }> } = {}
    if (existsSync(this.filePath)) {
      try { saved = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<LauncherState> } catch { saved = {} }
    }
    const settings = { ...defaults, ...saved.settings } as LauncherSettings & { clientId?: string }
    settings.width = defaults.width
    settings.height = defaults.height
    if (settings.javaPath && this.isStandardMinecraftPath(settings.javaPath)) settings.javaPath = ''
    if (!['tr', 'en', 'de', 'fr', 'ru', 'pl'].includes(settings.language)) settings.language = 'tr'
    delete settings.clientId
    settings.downloadSpeedLimitKiB = bounded(settings.downloadSpeedLimitKiB, 0, 0, 102400)
    settings.downloadConcurrency = bounded(settings.downloadConcurrency, 6, 1, 12)
    settings.pauseDownloadsWhilePlaying = settings.pauseDownloadsWhilePlaying === true
    settings.savePlaytime = settings.savePlaytime !== false
    settings.showPlaytime = settings.showPlaytime !== false
    settings.showTotalPlaytime = settings.showTotalPlaytime !== false
    Object.assign(settings, normalizeHeroSettings(settings))
    const playHistory = (Array.isArray(saved.playHistory) && saved.playHistory.length > 0 ? saved.playHistory.slice(0, 100) : (saved.profiles ?? []).filter(profile => profile.lastPlayed).map(profile => ({ id: randomUUID(), profileId: profile.id, profileName: profile.name, versionId: profile.versionId, at: profile.lastPlayed! }))).sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const lastPlayedVersion = playHistory.find(item => /^[a-zA-Z0-9._-]{1,90}$/.test(item.versionId))?.versionId
    this.state = {
      settings,
      profiles: Array.isArray(saved.profiles) ? saved.profiles : [],
      selectedProfileId: saved.selectedProfileId ?? null,
      selectedVersionId: lastPlayedVersion ?? saved.selectedVersionId ?? saved.profiles?.find(p => p.id === saved.selectedProfileId)?.versionId ?? null,
      accounts: Array.isArray(saved.accounts) ? saved.accounts : [],
      selectedAccountId: saved.selectedAccountId ?? null,
      dataPath: this.dataPath,
      playHistory,
      playSessions: Array.isArray(saved.playSessions) ? saved.playSessions.filter(session => session && profilePlaytime(saved.profiles?.find(profile => profile.id === session.profileId), settings, 'savePlaytime') && typeof session.id === 'string' && typeof session.profileId === 'string' && typeof session.profileName === 'string' && typeof session.versionId === 'string' && typeof session.startedAt === 'string' && typeof session.endedAt === 'string' && Number.isFinite(Date.parse(session.startedAt)) && Number.isFinite(Date.parse(session.endedAt)) && Date.parse(session.endedAt) >= Date.parse(session.startedAt) && Number.isFinite(session.durationMs) && session.durationMs >= 0) : []
    }
    this.selections = saved.accountSelections ?? {}
    if (!this.state.accounts.some(a => a.id === this.state.selectedAccountId)) this.state.selectedAccountId = this.state.accounts[0]?.id ?? null
    const migrating = this.state.profiles.some(profile => profile.accountId === undefined)
    if (migrating && existsSync(this.filePath) && !existsSync(`${this.filePath}.before-account-profiles`)) copyFileSync(this.filePath, `${this.filePath}.before-account-profiles`)
    for (const profile of this.state.profiles) if (profile.accountId === undefined) profile.accountId = this.state.selectedAccountId
    if (this.state.profiles.length === 1 && this.state.profiles[0].name === 'En son sürüm') this.state.profiles[0].name = 'Varsayılan profil'
    for (const profile of this.state.profiles) {
      if (profile.icon) { try { profile.icon = normalizeProfileIcon(profile.icon) } catch { delete profile.icon } }
      if (profile.gameDirectory && this.isStandardMinecraftPath(profile.gameDirectory)) profile.gameDirectory = ''
      if (profile.javaPath && this.isStandardMinecraftPath(profile.javaPath)) profile.javaPath = ''
      profile.minMemoryMb = bounded(profile.minMemoryMb, Math.min(1024, profile.memoryMb), 512, profile.memoryMb)
      if (!profile.modpack) {
        try {
          const path = join(this.profilePath(profile.id), 'green-launcher-pack.json')
          if (existsSync(path)) {
            const pack = JSON.parse(readFileSync(path, 'utf8')) as { projectId?: string; versionId?: string; name?: string; files?: string[] }
            if (pack.projectId && pack.versionId && pack.name && Array.isArray(pack.files)) profile.modpack = { projectId: pack.projectId, versionId: pack.versionId, title: pack.name, fileCount: pack.files.length }
          }
        } catch { /* Keep existing profiles usable when pack metadata is damaged. */ }
      }
    }
    if (this.state.selectedProfileId && !this.state.profiles.some(p => p.id === this.state.selectedProfileId)) this.state.selectedProfileId = null
    if (this.state.selectedAccountId && !this.state.accounts.some(a => a.id === this.state.selectedAccountId)) this.state.selectedAccountId = null
    if (!saved.accountSelections) this.rememberSelection()
    this.restoreSelection()
    if (migrating) this.save()
  }

  get(): LauncherState {
    const result = structuredClone(this.state)
    result.profiles = result.profiles.filter(profile => !!result.selectedAccountId && profile.accountId === result.selectedAccountId)
    const ids = new Set(result.profiles.map(profile => profile.id))
    result.playHistory = result.playHistory.filter(entry => ids.has(entry.profileId))
    result.playSessions = result.playSessions?.filter(entry => ids.has(entry.profileId))
    return result
  }

  allProfiles(): LauncherProfile[] { return structuredClone(this.state.profiles) }

  private ownedProfile(id: string): LauncherProfile {
    const profile = this.state.profiles.find(item => item.id === id && !!this.state.selectedAccountId && item.accountId === this.state.selectedAccountId)
    if (!profile) throw new Error('Bu profil seçili hesaba ait değil.')
    return profile
  }

  private rememberSelection(): void {
    if (this.state.selectedAccountId) this.selections[this.state.selectedAccountId] = { profileId: this.state.selectedProfileId, versionId: this.state.selectedVersionId }
  }

  private restoreSelection(): void {
    const accountId = this.state.selectedAccountId
    const profiles = this.state.profiles.filter(profile => !!accountId && profile.accountId === accountId)
    const saved = accountId ? this.selections[accountId] : undefined
    const selected = profiles.find(profile => profile.id === (saved?.profileId ?? this.state.selectedProfileId)) ?? profiles[0]
    this.state.selectedProfileId = selected?.id ?? null
    this.state.selectedVersionId = selected?.modLoaderVersion ?? selected?.versionId ?? null
  }

  private save(): LauncherState {
    this.rememberSelection()
    const temp = `${this.filePath}.tmp`
    writeFileSync(temp, JSON.stringify({ ...this.state, playSessions: this.state.playSessions?.filter(session => profilePlaytime(this.state.profiles.find(profile => profile.id === session.profileId), this.state.settings, 'savePlaytime')), accountSelections: this.selections }, null, 2), 'utf8')
    renameSync(temp, this.filePath)
    return this.get()
  }

  updateSettings(changes: Partial<LauncherSettings>): LauncherState {
    const settings = this.state.settings
    if (changes.language && ['tr', 'en', 'de', 'fr', 'ru', 'pl'].includes(changes.language)) settings.language = changes.language
    if (typeof changes.javaPath === 'string') settings.javaPath = changes.javaPath.trim() && !this.isStandardMinecraftPath(changes.javaPath.trim()) ? changes.javaPath.trim() : ''
    if (changes.memoryMb !== undefined) settings.memoryMb = bounded(changes.memoryMb, settings.memoryMb, 1024, 32768)
    const defaults = defaultSettings()
    settings.width = defaults.width
    settings.height = defaults.height
    if (typeof changes.closeOnLaunch === 'boolean') settings.closeOnLaunch = changes.closeOnLaunch
    if (typeof changes.showSnapshots === 'boolean') settings.showSnapshots = changes.showSnapshots
    if (typeof changes.animateHero === 'boolean') settings.animateHero = changes.animateHero
    Object.assign(settings, normalizeHeroSettings({ ...settings, ...changes }))
    if (typeof changes.discordPresence === 'boolean') settings.discordPresence = changes.discordPresence
    if (typeof changes.minimizeToTray === 'boolean') settings.minimizeToTray = changes.minimizeToTray
    if (changes.downloadSpeedLimitKiB !== undefined) settings.downloadSpeedLimitKiB = bounded(changes.downloadSpeedLimitKiB, settings.downloadSpeedLimitKiB ?? 0, 0, 102400)
    if (changes.downloadConcurrency !== undefined) settings.downloadConcurrency = bounded(changes.downloadConcurrency, settings.downloadConcurrency ?? 6, 1, 12)
    if (typeof changes.pauseDownloadsWhilePlaying === 'boolean') settings.pauseDownloadsWhilePlaying = changes.pauseDownloadsWhilePlaying
    if (typeof changes.savePlaytime === 'boolean') settings.savePlaytime = changes.savePlaytime
    if (typeof changes.showPlaytime === 'boolean') settings.showPlaytime = changes.showPlaytime
    if (typeof changes.showTotalPlaytime === 'boolean') settings.showTotalPlaytime = changes.showTotalPlaytime
    return this.save()
  }

  saveProfile(input: Omit<LauncherProfile, 'id' | 'createdAt'> & { id?: string }): LauncherState {
    if (!this.state.selectedAccountId) throw new Error('Önce bir hesap seçin.')
    const name = input.name.trim().slice(0, 48)
    if (!name) throw new Error('Profil adı boş olamaz.')
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(input.versionId)) throw new Error('Geçersiz sürüm kimliği.')
    let gameDirectory = (input.gameDirectory ?? '').trim()
    if (gameDirectory && this.isStandardMinecraftPath(gameDirectory)) gameDirectory = ''
    if (gameDirectory && (!isAbsolute(gameDirectory) || parse(gameDirectory).root === gameDirectory || gameDirectory.length > 500)) throw new Error('Oyun klasörü için geçerli bir tam yol seçin.')
    const current = input.id ? this.ownedProfile(input.id) : undefined
    if (input.accountOverride === true && input.launchAccountId && !this.state.accounts.some(account => account.id === input.launchAccountId)) throw new Error('Seçilen hesap bulunamadı.')
    const worldId = typeof input.worldId === 'string' ? input.worldId : current?.worldId
    if (worldId && (worldId.length > 255 || /[\\/\x00]/.test(worldId) || worldId === '.' || worldId === '..')) throw new Error('Dünya bulunamadı.')
    if (current?.modpack && (input.versionId !== current.versionId || (input.modLoaderVersion !== undefined && input.modLoaderVersion !== current.modLoaderVersion) || (input.modLoader !== undefined && input.modLoader !== current.modLoader))) throw new Error('Mod paketi profilinin Minecraft sürümü ve yükleyicisi değiştirilemez.')
    if (input.id && !current) throw new Error('Profil bulunamadı.')
    const memoryMb = bounded(input.memoryMb, this.state.settings.memoryMb, 1024, 32768)
    const minMemoryMb = bounded(input.minMemoryMb, current?.minMemoryMb ?? Math.min(1024, memoryMb), 512, memoryMb)
    const profile: LauncherProfile = {
      id: current?.id ?? randomUUID(),
      accountId: this.state.selectedAccountId,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      name,
      versionId: input.versionId,
      javaPath: input.javaPath.trim() && !this.isStandardMinecraftPath(input.javaPath.trim()) ? input.javaPath.trim() : '',
      memoryMb,
      minMemoryMb,
      width: bounded(input.width, this.state.settings.width, 640, 7680),
      height: bounded(input.height, this.state.settings.height, 480, 4320),
      jvmArgs: (input.jvmArgs ?? '').trim().slice(0, 2048),
      fullscreen: input.fullscreen === true,
      serverAddress: normalizeServerAddress(input.serverAddress),
      autoJoinEnabled: typeof input.autoJoinEnabled === 'boolean' ? input.autoJoinEnabled : current?.autoJoinEnabled,
      autoJoinMode: input.autoJoinMode === 'world' ? 'world' : input.autoJoinMode === 'server' ? 'server' : current?.autoJoinMode,
      worldId,
      memoryOverride: typeof input.memoryOverride === 'boolean' ? input.memoryOverride : current?.memoryOverride,
      permGenMb: bounded(input.permGenMb, current?.permGenMb ?? 128, 64, 4096),
      hideLauncher: typeof input.hideLauncher === 'boolean' ? input.hideLauncher : current?.hideLauncher,
      quitOnGameExit: typeof input.quitOnGameExit === 'boolean' ? input.quitOnGameExit : current?.quitOnGameExit,
      consoleEnabled: typeof input.consoleEnabled === 'boolean' ? input.consoleEnabled : current?.consoleEnabled,
      showConsoleOnLaunch: typeof input.showConsoleOnLaunch === 'boolean' ? input.showConsoleOnLaunch : current?.showConsoleOnLaunch,
      showConsoleOnCrash: typeof input.showConsoleOnCrash === 'boolean' ? input.showConsoleOnCrash : current?.showConsoleOnCrash,
      playtimeOverride: typeof input.playtimeOverride === 'boolean' ? input.playtimeOverride : current?.playtimeOverride,
      showPlaytime: typeof input.showPlaytime === 'boolean' ? input.showPlaytime : current?.showPlaytime,
      savePlaytime: typeof input.savePlaytime === 'boolean' ? input.savePlaytime : current?.savePlaytime,
      accountOverride: typeof input.accountOverride === 'boolean' ? input.accountOverride : current?.accountOverride,
      launchAccountId: typeof input.launchAccountId === 'string' ? input.launchAccountId : current?.launchAccountId,
      icon: input.icon !== undefined ? normalizeProfileIcon(input.icon) : current?.icon,
      gameDirectory,
      modLoader: current?.modpack ? current.modLoader : input.modLoader,
      modLoaderVersion: current?.modpack ? current.modLoaderVersion : input.modLoaderVersion,
      modpack: current?.versionId === input.versionId ? current.modpack : undefined,
      lastPlayed: current?.lastPlayed,
      cover: current?.cover ?? (input.cover ? normalizeProfileCover(input.cover) : undefined)
    }
    if (gameDirectory) mkdirSync(this.gamePath(profile), { recursive: true })
    if (current) Object.assign(current, profile)
    else this.state.profiles.push(profile)
    this.state.selectedProfileId = profile.id
    this.state.selectedVersionId = profile.modLoaderVersion ?? profile.versionId
    mkdirSync(this.profilePath(profile.id), { recursive: true })
    return this.save()
  }

  setProfileVersion(id: string, version: Pick<LauncherProfile, 'versionId' | 'modLoader' | 'modLoaderVersion'>): LauncherState {
    const profile = this.ownedProfile(id)
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(version.versionId) || version.modLoaderVersion && !/^[a-zA-Z0-9._-]{1,90}$/.test(version.modLoaderVersion)) throw new Error('Geçersiz sürüm kimliği.')
    if (version.modLoader && (!['fabric', 'forge', 'neoforge', 'quilt', 'liteloader'].includes(version.modLoader) || !version.modLoaderVersion)) throw new Error('Geçersiz mod yükleyicisi.')
    if (profile.modpack && !profile.modpack.loader) profile.modpack.loader = profile.modLoader
    Object.assign(profile, { versionId: version.versionId, modLoader: version.modLoader, modLoaderVersion: version.modLoaderVersion })
    if (this.state.selectedProfileId === id) this.state.selectedVersionId = version.modLoaderVersion ?? version.versionId
    return this.save()
  }

  setModLoader(id: string, gameVersion: string, loader: LauncherProfile['modLoader'], loaderVersion: string): LauncherState {
    const profile = this.ownedProfile(id)
    if (profile.versionId !== gameVersion) throw new Error('Yükleyici profilin Minecraft sürümüyle uyumlu olmalı.')
    if (profile.modpack && (profile.versionId !== gameVersion || profile.modLoader !== loader || profile.modLoaderVersion !== loaderVersion)) throw new Error('Mod paketi profilinin yükleyicisi değiştirilemez.')
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(gameVersion)) throw new Error('Geçersiz Minecraft sürümü.')
    profile.versionId = gameVersion
    profile.modLoader = loader
    profile.modLoaderVersion = loaderVersion
    if (this.state.selectedProfileId === id) this.state.selectedVersionId = loaderVersion
    return this.save()
  }

  setProfileCover(id: string, cover: ProfileCover): LauncherState {
    this.ownedProfile(id).cover = normalizeProfileCover(cover)
    return this.save()
  }

  bindInstalledVersion(id: string, versionId: string): LauncherState {
    const profile = this.ownedProfile(id)
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(versionId) || !profile.versionId.endsWith('-OptiFine_auto') || !versionId.startsWith(profile.versionId.replace(/auto$/, ''))) throw new Error('Profil sürümü değiştirilemez.')
    profile.versionId = versionId
    if (this.state.selectedProfileId === id) this.state.selectedVersionId = versionId
    return this.save()
  }

  setModpack(id: string, modpack: NonNullable<LauncherProfile['modpack']>): LauncherState {
    const profile = this.ownedProfile(id)
    profile.modpack = modpack
    if (this.state.selectedProfileId === id) this.state.selectedVersionId = profile.modLoaderVersion ?? profile.versionId
    return this.save()
  }

  deleteProfile(id: string): LauncherState {
    this.ownedProfile(id)
    this.state.profiles = this.state.profiles.filter(p => p.id !== id)
    if (this.state.selectedProfileId === id) this.state.selectedProfileId = this.state.profiles.find(profile => profile.accountId === this.state.selectedAccountId)?.id ?? null
    const selected = this.state.profiles.find(profile => profile.id === this.state.selectedProfileId)
    this.state.selectedVersionId = selected?.modLoaderVersion ?? selected?.versionId ?? null
    // Keep worlds and game files on disk. The user can remove them deliberately.
    return this.save()
  }

  reorderProfiles(ids: string[]): LauncherState {
    const profiles = this.state.profiles.filter(profile => profile.accountId === this.state.selectedAccountId)
    if (ids.length !== profiles.length || new Set(ids).size !== profiles.length || ids.some(id => !profiles.some(profile => profile.id === id))) {
      throw new Error('Profil sıralaması geçersiz.')
    }
    const byId = new Map(profiles.map(profile => [profile.id, profile]))
    const reordered = ids.map(id => byId.get(id)!)
    this.state.profiles = [...this.state.profiles.filter(profile => profile.accountId !== this.state.selectedAccountId), ...reordered]
    return this.save()
  }

  selectProfile(id: string): LauncherState {
    const profile = this.ownedProfile(id)
    this.state.selectedProfileId = id
    this.state.selectedVersionId = profile.modLoaderVersion ?? profile.versionId
    return this.save()
  }

  selectVersion(id: string): LauncherState {
    if (!/^[a-zA-Z0-9._-]{1,90}$/.test(id)) throw new Error('Geçersiz sürüm kimliği.')
    const profile = this.state.profiles.find(item => item.id === this.state.selectedProfileId)
    if (profile && id !== (profile.modLoaderVersion ?? profile.versionId)) throw new Error('Bu profil yalnızca kendi Minecraft sürümüyle çalışır. Başka bir sürüm için profili değiştirin.')
    this.state.selectedVersionId = id
    return this.save()
  }

  markPlayed(id: string, versionId: string): LauncherState {
    const profile = this.state.profiles.find(p => p.id === id)
    if (profile) {
      profile.lastPlayed = new Date().toISOString()
      this.state.playHistory = [{ id: randomUUID(), profileId: id, profileName: profile.name, versionId, at: profile.lastPlayed }, ...this.state.playHistory].slice(0, 100)
      if (profile.id === this.state.selectedProfileId) this.state.selectedVersionId = profile.modLoaderVersion ?? profile.versionId
    }
    return this.save()
  }

  recordPlaySession(session: PlaySession): LauncherState {
    // A running game may belong to an account that is no longer selected.
    if (!this.state.profiles.some(profile => profile.id === session.profileId)) return this.get()
    const entries = this.state.playSessions ??= []
    const index = entries.findIndex(entry => entry.id === session.id)
    if (index < 0) entries.push({ ...session })
    else entries[index] = { ...session }
    return this.save()
  }

  upsertAccount(account: GameAccount): LauncherState {
    this.assertAccountNameAvailable(account.name, account.id)
    this.rememberSelection()
    this.state.accounts = [...this.state.accounts.filter(a => a.id !== account.id), account]
    for (const profile of this.state.profiles) if (!profile.accountId) profile.accountId = account.id
    this.state.selectedAccountId = account.id
    this.restoreSelection()
    return this.save()
  }

  createOfflineAccount(rawName: string): LauncherState {
    const account = offlineAccount(rawName)
    this.assertAccountNameAvailable(account.name)
    return this.upsertAccount(account)
  }

  removeAccount(id: string): LauncherState {
    this.rememberSelection()
    this.state.accounts = this.state.accounts.filter(a => a.id !== id)
    if (this.state.selectedAccountId === id) { this.state.selectedAccountId = this.state.accounts[0]?.id ?? null; this.restoreSelection() }
    return this.save()
  }

  assertAccountNameAvailable(name: string, exceptId?: string): void {
    if (this.state.accounts.some(account => account.id !== exceptId && account.name.toLowerCase() === name.trim().toLowerCase())) {
      throw new Error('Bu oyuncu adıyla bir hesap zaten var.')
    }
  }

  selectAccount(id: string): LauncherState {
    if (!this.state.accounts.some(a => a.id === id)) throw new Error('Hesap bulunamadı.')
    this.rememberSelection()
    this.state.selectedAccountId = id
    this.restoreSelection()
    return this.save()
  }

  isStandardMinecraftPath(path: string): boolean {
    const child = relative(resolve(app.getPath('appData'), '.minecraft'), resolve(path))
    return !child || (child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child))
  }

  gamePath(profile: LauncherProfile): string {
    const custom = profile.gameDirectory?.trim()
    return custom && !this.isStandardMinecraftPath(custom) ? custom : this.profilePath(profile.id)
  }

  profilePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Geçersiz profil kimliği.')
    return join(this.dataPath, 'profiles', id)
  }
}

export function normalizeProfileCover(cover: ProfileCover): ProfileCover {
  if (!cover || typeof cover !== 'object' || !/^#[0-9a-f]{6}$/i.test(cover.color) || typeof cover.description !== 'string') throw new Error('Profil kapağı geçersiz.')
  if (cover.image !== undefined && (typeof cover.image !== 'string' || cover.image.length > 360000 || !/^data:image\/(jpeg|png);base64,[a-zA-Z0-9+/=]+$/.test(cover.image))) throw new Error('Kapak görseli geçersiz veya çok büyük.')
  return { color: cover.color, description: cover.description.trim().slice(0, 120), ...(cover.image && { image: cover.image }) }
}
