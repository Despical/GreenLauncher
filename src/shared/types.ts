export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha'

export interface GameVersion {
  id: string
  type: VersionType
  releaseTime: string
  url: string
  installed: boolean
  installedFrom?: 'launcher' | 'minecraft'
  optifineVersions: Array<{ id: string; source: 'launcher' | 'minecraft' }>
  optifineAvailable?: boolean
  custom?: boolean
}

export interface LauncherProfile {
  id: string
  accountId?: string | null
  name: string
  versionId: string
  javaPath: string
  memoryMb: number
  minMemoryMb?: number
  width: number
  height: number
  jvmArgs?: string
  fullscreen?: boolean
  serverAddress?: string
  autoJoinEnabled?: boolean
  autoJoinMode?: 'server' | 'world'
  worldId?: string
  memoryOverride?: boolean
  permGenMb?: number
  hideLauncher?: boolean
  quitOnGameExit?: boolean
  playtimeOverride?: boolean
  showPlaytime?: boolean
  savePlaytime?: boolean
  accountOverride?: boolean
  launchAccountId?: string
  gameDirectory?: string
  modLoader?: ModLoader
  modLoaderVersion?: string
  modpack?: { projectId: string; versionId: string; title: string; fileCount: number; provider?: ModProvider; sourceUrl?: string }
  pinned?: boolean
  lastPlayed?: string
  cover?: ProfileCover
  createdAt: string
}

export interface ProfileCover { color: string; description: string; image?: string }

export interface PlayHistoryEntry { id: string; profileId: string; profileName: string; versionId: string; at: string }
export interface PlaySession { id: string; profileId: string; profileName: string; versionId: string; startedAt: string; endedAt: string; durationMs: number }
export const screenshotPageSize = 18
export interface ScreenshotItem { id: string; profileId: string | null; name: string; modifiedAt: string; thumbnail: string }
export type ScreenshotSort = 'newest' | 'oldest'
export interface DiskUsage { profiles: Array<{ id: string; name: string; bytes: number }>; sharedBytes: number; totalBytes: number }
export interface CleanupItem { path: string; kind: 'logs' | 'crashReports' | 'versions'; bytes: number }
export interface CleanupPreview { logs: number; crashReports: number; versions: number; bytes: number; items: CleanupItem[] }
export interface OfflineStatus { accountReady: boolean; versionReady: boolean }

export interface LauncherSettings {
  language: 'tr' | 'en' | 'de' | 'fr' | 'ru' | 'pl'
  javaPath: string
  memoryMb: number
  width: number
  height: number
  closeOnLaunch: boolean
  showSnapshots: boolean
  animateHero: boolean
  discordPresence: boolean
  minimizeToTray: boolean
  downloadSpeedLimitKiB?: number
  pauseDownloadsWhilePlaying?: boolean
  downloadConcurrency?: number
  savePlaytime?: boolean
  showPlaytime?: boolean
  showTotalPlaytime?: boolean
}

export interface GameAccount {
  id: string
  name: string
  skinUrl?: string
  homeAccountId: string
  kind?: 'microsoft' | 'offline'
}

export interface AccountCape { id: string; name: string; source: 'minecraft' | 'optifine'; image: string; active: boolean }

export interface LauncherState {
  settings: LauncherSettings
  profiles: LauncherProfile[]
  selectedProfileId: string | null
  selectedVersionId: string | null
  accounts: GameAccount[]
  selectedAccountId: string | null
  dataPath: string
  playHistory: PlayHistoryEntry[]
  playSessions?: PlaySession[]
}

export interface LauncherActivity {
  kind: 'idle' | 'installing' | 'launching' | 'playing' | 'error'
  label: string
  detail?: string
  progress?: number
  profileId?: string
  downloadedBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
}

export interface RunningInstance {
  id: string
  pid: number
  profileId: string
  profileName: string
  accountId: string
  accountName: string
  versionId: string
  loader?: ModLoader | 'optifine'
  startedAt: string
}
export type LaunchResult = { status: 'started' } | { status: 'confirmation-required'; instances: RunningInstance[] }
export type GameLogLevel = 'info' | 'warn' | 'error' | 'debug'
export interface GameLogLine { seq: number; text: string; level: GameLogLevel }
export interface GameLogSession { instance: RunningInstance; running: boolean }
export interface GameLogSnapshot {
  session: GameLogSession | null; sessions: GameLogSession[]; lines: GameLogLine[]
  firstSeq: number; nextSeq: number; revision: number; dropped: number
}
export interface GameLogChange { profileId: string; instanceId: string }
export type LauncherPage = 'home' | 'versions' | 'profiles' | 'servers' | 'worlds' | 'mods' | 'gallery' | 'downloads' | 'storage' | 'settings' | 'account'
export interface LauncherPresenceContext {
  page: LauncherPage
  section?: string
  contentType?: ModContentType
  favorites?: boolean
}
export interface LaunchRequest { profileId: string | null; versionId?: string; accountId: string; serverAddress?: string; serverPreference?: ServerJoinPreference; temporaryOfflineName?: string; worldId?: string }

export type ResourcePackPolicy = 'enabled' | 'prompt' | 'disabled'
export interface ServerJoinPreference { name: string; resourcePacks: ResourcePackPolicy }
export interface SavedServer { id: string; name: string; address: string; createdAt: string; resourcePacks?: ResourcePackPolicy; icon?: string }
export interface MotdPart { text: string; color?: string; bold?: boolean; italic?: boolean; underlined?: boolean; strikethrough?: boolean }
export interface ServerStatus {
  id: string; address: string; online: boolean; checkedAt: string; motd: MotdPart[]
  version?: string; protocol?: number; players?: number; maxPlayers?: number; sample?: string[]; icon?: string; latency?: number
}

export interface JavaRuntimeInfo { path: string; version: string; majorVersion: number; source: string }
export type ModLoader = 'neoforge' | 'forge' | 'fabric' | 'quilt' | 'liteloader'
export type ModProvider = 'modrinth' | 'curseforge' | 'technic'
export interface ProviderStatus { curseforge: boolean }
export type ModContentType = 'mod' | 'modpack'
export type ModSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
export interface ModSearchHit { projectId: string; slug: string; title: string; description: string; author: string; iconUrl: string | null; downloads: number; updated: string; categories: string[] }
export interface ModFavorite extends ModSearchHit { provider: ModProvider; contentType: ModContentType; savedAt: string }
export type DownloadPhase = 'queued' | 'preparing' | 'downloading' | 'verifying' | 'installing' | 'retrying' | 'paused' | 'completed' | 'failed'
export interface DownloadContent { title: string; iconUrl: string | null }
export interface DownloadJob {
  launcherVersion?: string
  id: string; title: string; profileId?: string; profileName?: string; forLaunch: boolean; phase: DownloadPhase; detail: string
  downloadedBytes: number; totalBytes: number; bytesPerSecond: number; filesDone: number; filesTotal: number
  peakBytesPerSecond?: number; estimatedSeconds?: number; iconUrl?: string
  paused: boolean; queued?: boolean; priority: number; error?: string; createdAt: string; finishedAt?: string
}
export interface DownloadSnapshot { jobs: DownloadJob[]; paused: boolean; playing: boolean; speedLimitKiB: number; concurrency: number; pauseWhilePlaying: boolean }
export interface ModSearchResult { hits: ModSearchHit[]; total: number }
export interface ModProject { id: string; slug: string; title: string; description: string; body: string; iconUrl: string | null; downloads: number; license: string; sourceUrl: string | null; projectType: ModContentType }
export interface ModVersion { id: string; name: string; versionNumber: string; type: string; published: string; downloads: number; gameVersions: string[]; loaders: string[] }
export interface InstalledMod { provider?: ModProvider; projectId: string; title: string; versionId: string; versionNumber: string; filename: string; sourceUrl?: string }
export interface LauncherErrorEntry {
  count?: number; firstAt?: string; lastAt?: string; level?: 'error' | 'info'; id: string; at: string; source: string; message: string; code: string }

export interface LauncherEvents {
  update: LauncherUpdate
  downloads: DownloadSnapshot
  skinUpdated: { accountId: string; skin: string | null }
  instances: RunningInstance[]
  gameLog: GameLogChange
  navigate: LauncherPage
  launchRequest: LaunchRequest
  activity: LauncherActivity
  state: LauncherState
  shortcutError: string
  notice: string
  errorLog: LauncherErrorEntry[]
  modFavorites: ModFavorite[]
}

export interface LauncherApi {
  getUpdate(): Promise<LauncherUpdate>
  checkUpdate(): Promise<LauncherUpdate>
  downloadUpdate(): Promise<LauncherUpdate>
  cancelUpdate(): Promise<LauncherUpdate>
  installUpdate(): Promise<LauncherUpdate>
  setPresenceContext(context: LauncherPresenceContext): Promise<void>
  getDownloads(): Promise<DownloadSnapshot>
  controlDownloads(action: 'pause-all' | 'resume-all' | 'pause' | 'resume' | 'prioritize' | 'reorder' | 'clear', id?: string, beforeId?: string): Promise<DownloadSnapshot>
  getModFavorites(refresh?: boolean): Promise<ModFavorite[]>
  setModFavorite(favorite: ModFavorite, saved: boolean): Promise<ModFavorite[]>
  getState(): Promise<LauncherState>
  getVersions(refresh?: boolean | 'if-stale'): Promise<GameVersion[]>
  saveSettings(settings: Partial<LauncherSettings>): Promise<LauncherState>
  saveProfile(profile: Omit<LauncherProfile, 'id' | 'createdAt'> & { id?: string }): Promise<LauncherState>
  cloneProfile(id: string): Promise<{ state: LauncherState; profileId: string }>
  exportProfile(id: string): Promise<string | null>
  importProfile(path?: string): Promise<{ state: LauncherState; profileId: string } | null>
  repairProfile(id: string): Promise<LauncherState>
  chooseProfileCover(): Promise<string | null>
  saveProfileCover(id: string, cover: ProfileCover): Promise<LauncherState>
  getDroppedFilePath(file: File): string
  deleteProfile(id: string): Promise<LauncherState>
  reorderProfiles(ids: string[]): Promise<LauncherState>
  toggleProfilePin(id: string): Promise<LauncherState>
  selectProfile(id: string): Promise<LauncherState>
  selectVersion(id: string): Promise<LauncherState>
  selectAccount(id: string): Promise<LauncherState>
  createOfflineAccount(name: string): Promise<LauncherState>
  signIn(): Promise<LauncherState>
  signOut(id: string): Promise<LauncherState>
  getAccountSkin(id: string): Promise<string | null>
  getAccountCapes(id: string): Promise<AccountCape[]>
  setAccountCape(id: string, capeId: string): Promise<AccountCape[]>
  getRunningInstances(): Promise<RunningInstance[]>
  getGameLog(profileId: string, instanceId?: string, afterSeq?: number): Promise<GameLogSnapshot>
  clearGameLog(profileId: string, instanceId: string): Promise<GameLogSnapshot>
  copyGameLog(profileId: string, instanceId: string): Promise<void>
  uploadGameLog(profileId: string, instanceId: string): Promise<string>
  play(profileId: string, allowAdditional?: boolean, versionId?: string, serverAddress?: string, serverPreference?: ServerJoinPreference, worldId?: string): Promise<LaunchResult>
  install(versionId: string): Promise<void>
  deleteVersion(versionId: string): Promise<void>
  chooseJava(): Promise<string | null>
  getJavaRuntimes(): Promise<JavaRuntimeInfo[]>
  deleteJavaRuntime(path: string): Promise<void>
  openJavaLocation(path: string): Promise<void>
  createProfileShortcut(profileId: string): Promise<string>
  createVersionShortcut(versionId: string): Promise<string>
  playVersion(versionId: string, allowAdditional?: boolean, serverAddress?: string, serverPreference?: ServerJoinPreference, temporaryOfflineName?: string): Promise<LaunchResult>
  importCustomClient(): Promise<{ id: string; versions: GameVersion[] } | null>
  getWorlds(profileId: string, refresh?: boolean): Promise<SavedWorld[]>
  importWorld(profileId: string): Promise<string | null>
  renameWorld(profileId: string, id: string, name: string): Promise<void>
  duplicateWorld(profileId: string, id: string, name: string): Promise<string>
  deleteWorld(profileId: string, id: string): Promise<void>
  resetWorldIcon(profileId: string, id: string): Promise<void>
  copyWorldSeed(profileId: string, id: string): Promise<void>
  openWorldFolder(profileId: string, id: string): Promise<void>
  getServers(profileId?: string | null): Promise<SavedServer[]>
  saveServer(server: { id?: string; name: string; address: string; resourcePacks?: ResourcePackPolicy }, profileId?: string | null): Promise<SavedServer[]>
  reorderServers(ids: string[], profileId?: string | null): Promise<SavedServer[]>
  deleteServer(id: string, profileId?: string | null): Promise<SavedServer[]>
  refreshServer(id: string, profileId?: string | null): Promise<ServerStatus>
  getProfileModsPath(profileId: string): Promise<string | null>
  openProfileMods(profileId: string): Promise<void>
  openVersionLocation(versionId: string): Promise<void>
  getErrorLog(): Promise<LauncherErrorEntry[]>
  clearErrorLog(): Promise<LauncherErrorEntry[]>
  openErrorLog(): Promise<void>
  openFolder(profileId?: string): Promise<void>
  openSharedFolder(): Promise<void>
  chooseGameDirectory(): Promise<string | null>
  getScreenshots(scope?: string, offset?: number, sort?: ScreenshotSort): Promise<ScreenshotItem[]>
  getScreenshot(id: string): Promise<string>
  getScreenshotPreview(id: string): Promise<string>
  copyScreenshot(id: string): Promise<void>
  openScreenshotLocation(id: string): Promise<void>
  deleteScreenshot(id: string): Promise<void>
  getDiskUsage(): Promise<DiskUsage>
  getCleanupPreview(): Promise<CleanupPreview>
  cleanUnusedFiles(approvedPaths: string[]): Promise<CleanupPreview>
  getOfflineStatus(): Promise<OfflineStatus>
  getProviderStatus(): Promise<ProviderStatus>
  getModCategories(provider: ModProvider, type: ModContentType): Promise<Array<{value:string;label:string}>>
  connectCurseForge(key: string): Promise<ProviderStatus>
  searchMods(query: string, gameVersion: string, loader: ModLoader, sort: ModSort, offset: number, category: string, contentType?: ModContentType, provider?: ModProvider): Promise<ModSearchResult>
  getModProject(id: string, provider?: ModProvider): Promise<ModProject>
  getModVersions(id: string, gameVersion: string, loader: ModLoader, provider?: ModProvider, allGameVersions?: boolean): Promise<ModVersion[]>
  installMod(profileId: string, versionId: string, provider?: ModProvider, content?: DownloadContent): Promise<InstalledMod[]>
  installModpack(versionId: string, gameVersion: string, loader: ModLoader, provider?: ModProvider, content?: DownloadContent): Promise<{ state: LauncherState; profileId: string }>
  getInstalledMods(profileId: string): Promise<InstalledMod[]>
  getProfileMods(profileId: string): Promise<InstalledMod[]>
  installModLoader(profileId: string, gameVersion: string, loader: ModLoader): Promise<LauncherState>
  openExternal(url: string): Promise<void>
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>
  on<K extends keyof LauncherEvents>(event: K, listener: (value: LauncherEvents[K]) => void): () => void
}

export interface SavedWorld { id: string; name: string; gameMode?: number; hardcore: boolean; lastPlayed?: number; size?: number; icon?: string; seed?: string; version?: string }

export interface LauncherUpdate {
  downloadedAt?: string
  peakBytesPerSecond?: number
  estimatedSeconds?: number
  lastInstalled?: { version: string; at: string }
  operation?: 'check' | 'download' | 'install'
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'disabled'
  currentVersion: string
  version?: string
  notes?: string
  releasedAt?: string
  checkedAt?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  error?: 'network' | 'metadata' | 'checksum' | 'install' | 'busy' | 'space' | 'space-check'
  portable: boolean
}
