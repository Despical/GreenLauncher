import { profileJoinTarget } from '../shared/profile-settings'
import { WorldService } from './worlds'
import { NsisUpdater } from 'electron-updater'
import { LauncherUpdater } from './updater'
import { PortableUpdateTransport, confirmUpdate, installedUpdateReceipt } from './portable-updater'
import type { ServerJoinPreference, ResourcePackPolicy } from '../shared/types'
import { clipboard, app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { AccountService } from './auth'
import { AccountSkins } from './account-skins'
import { AccountCapes } from './account-capes'
import { parseShortcut, shortcutArguments } from './shortcuts'
import { appId, configureWindows, executable, navigationArgument, navigationItems, persistentIcon } from './windows-integration'
import { translate } from '../renderer/src/i18n'
import { GameService, message } from './game'
import { publishGameLog } from './game-console'
import { DiscordPresence, DISCORD_APPLICATION_ID } from './discord'
import { ErrorLog } from './error-log'
import { prepareDataPath } from './data-path'
import { LauncherStore } from './store'
import { LibraryService } from './library'
import { ModrinthService } from './modrinth'
import { ModpackService } from './modpack'
import { CurseForgeService } from './curseforge'
import { TechnicService } from './technic'
import { ProviderPacks } from './provider-packs'
import { MetadataCache } from './metadata-cache'
import { DownloadManager } from './download-manager'
import { configureDiskSpace, diskSpace } from './disk-space'
import { activeLauncherPaths, cleanOldRuntimes, cleanUpdateCache } from './runtime-cleanup'
import { ModFavorites } from './mod-favorites'
import { ProfilePackages } from './profile-packages'
import { CustomClients } from './custom-clients'
import { ProfileServers } from './profile-servers'
import { ResourcePacks } from './resource-packs'
import { ProfileContent } from './profile-content'
import { ContentIconCache } from './content-icon-cache'
import { ProfileVersions } from './profile-versions'
import type { ProfileContentKind, ProfileLoader } from '../shared/types'
import { safePath } from './modpack'
import { downloadVerified, type FileHashes } from './modrinth-download'
import { diagnoseError } from '../shared/errors'
import type { GameVersion, LauncherActivity, LauncherProfile, LauncherSettings, ModContentType, ModLoader, ModSort, ModProvider, ModFavorite } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let splashShownAt = 0
let splashFinishing = false
const nativeSplashReadyFile = process.env.GREEN_LAUNCHER_SPLASH_READY_FILE
let tray: Tray | null = null
let minimizeToTray = false
let quitting = false
let pendingShortcut = parseShortcut(process.argv)
let pendingNavigation = navigationArgument(process.argv)
let keepForGames = () => false
let dispatchShortcut: (() => void) | null = null
const shortcutTarget = executable
const shortcutIcon = persistentIcon

// Set the data directory before Electron starts its GPU and renderer processes.
app.setPath('userData', prepareDataPath(process.env.GREEN_LAUNCHER_UPDATE_QA_ROOT || app.getPath('appData')))

function send(event: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, value)
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function createSplashWindow(): void {
  splashShownAt = 0
  splashFinishing = false
  const splashPath = app.isPackaged ? join(process.resourcesPath, 'portable-splash.png') : join(app.getAppPath(), 'build/portable-splash.png')
  const splash = readFileSync(splashPath).toString('base64')
  splashWindow = new BrowserWindow({
    width: 680,
    height: 360,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#111820',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  splashWindow.once('ready-to-show', () => {
    if (!splashFinishing && splashWindow && !splashWindow.isDestroyed()) {
      splashShownAt = Date.now()
      splashWindow.show()
    }
  })
  splashWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html lang="tr"><meta charset="utf-8"><style>
    body{margin:0;width:680px;height:360px;background:#111820 url(data:image/png;base64,${splash}) center/cover no-repeat;-webkit-app-region:drag;color:#f0f5f4;font:16px 'Segoe UI',Arial,sans-serif;user-select:none}
    .status{position:absolute;left:42px;bottom:34px;text-shadow:0 1px 9px #071018;font-weight:600;letter-spacing:.1px}
    .dots{display:inline-block;width:1.6em;text-align:left}
  </style><div class="status">Başlatılıyor<span class="dots" id="dots"></span></div><script>
    const frames=['','.','..','...'];let frame=0;setInterval(()=>{frame=(frame+1)%frames.length;document.getElementById('dots').textContent=frames[frame]},380)
  </script></html>`)}`)
}

function finishSplash(): void {
  if (nativeSplashReadyFile) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    setTimeout(() => {
      try { writeFileSync(nativeSplashReadyFile, 'ready') } catch { /* The portable wrapper may already be closing. */ }
    }, 120)
    return
  }
  if (!splashShownAt) {
    splashFinishing = true
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
    splashWindow = null
    return
  }
  splashFinishing = true
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show()
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
    splashWindow = null
  }, 120)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    title: 'Green Launcher',
    icon: persistentIcon(),
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (process.platform === 'win32') {
    mainWindow.setAppDetails({
      appId,
      appIconPath: persistentIcon(),
      appIconIndex: 0,
      relaunchCommand: app.isPackaged ? `"${shortcutTarget()}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Green Launcher'
    })
  }
  mainWindow.once('ready-to-show', finishSplash)
  mainWindow.on('close', event => {
    if ((minimizeToTray || keepForGames()) && !quitting) { event.preventDefault(); mainWindow?.hide() }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    const request = parseShortcut(argv)
    const page = navigationArgument(argv)
    if (page) send('launcher:navigate', page)
    if (request) { pendingShortcut = request; dispatchShortcut?.() }
    showMainWindow()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId(appId)
    if (!nativeSplashReadyFile) createSplashWindow()
    const store = new LauncherStore()
    minimizeToTray = store.get().settings.minimizeToTray
    createWindow()
    const logs = new ErrorLog(store.dataPath, entries => send('launcher:errorLog', entries))
    configureDiskSpace(error => {
      Object.assign(error, { diskSpaceReported: true })
      logs.record('İndirme', error)
      send('launcher:notice', translate(store.get().settings.language, diagnoseError(error).message))
    })
    let lastInstalled: { version: string; at: string } | undefined
    mainWindow!.once('ready-to-show', () => {
      lastInstalled = confirmUpdate(store.dataPath, app.getVersion(), process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, logs, result => downloads.recordLauncherUpdate(result.version, result.at, 0, true))
      send('launcher:update', { ...updater.get(), lastInstalled })
      if (process.env.GREEN_LAUNCHER_UPDATE_QA_ROOT) setTimeout(() => app.quit(), 2000)
    })
    const accountService = new AccountService(store)
    const accountSkins = new AccountSkins(join(store.dataPath, 'skin-cache'), (account, skin) => {
      const current = store.get().accounts.find(item => item.id === account.id)
      if (current && current.name === account.name && current.skinUrl === account.skinUrl) send('launcher:skinUpdated', { accountId: account.id, skin })
    })
    const accountCapes = new AccountCapes(accountService, join(store.dataPath, 'cape-cache'))
    let signingIn = false
    const library = new LibraryService(store)
    const servers = new ProfileServers(store)
    const downloads = new DownloadManager(store.get().settings, snapshot => send('launcher:downloads', snapshot), join(store.dataPath, 'download-history.json'))
    const favorites = new ModFavorites(join(store.dataPath, 'mod-favorites.json'))
    const modrinth = new ModrinthService(store)
    const discord = new DiscordPresence(DISCORD_APPLICATION_ID, store.get().settings.discordPresence)
    const game = new GameService(store, accountService, () => mainWindow, (activity: LauncherActivity) => {
      send('launcher:activity', activity)
      // Preparation failures are recorded by their rejected IPC/shortcut request.
      // A running game's exit has no pending request, so record that here.
      if (activity.kind === 'error' && activity.label === 'Oyun kapandı') logs.record('Oyun', activity.detail || activity.label)
      if (activity.kind === 'playing') {
        const versionId = game.getRunningInstances()[0]?.versionId
        if (versionId) discord.setPlaying(versionId)
      } else if (!game.getRunningInstances().length && (activity.kind === 'idle' || activity.kind === 'error')) discord.clearPlaying()
    }, instances => { downloads.setPlaying(instances.length > 0); send('launcher:instances', instances); if (instances.length) discord.setPlaying(instances[0].versionId); else discord.clearPlaying() }, () => send('launcher:state', store.get()), () => app.quit(), change => send('launcher:gameLog', change), target => send('launcher:consoleRequest', target))
    app.on('before-quit', () => game.flushPlaytime())
    keepForGames = () => game.getRunningInstances().length > 0
    const modpacks = new ModpackService(store, game, activity => { downloads.activity(activity); send('launcher:activity', activity) })
    const curseforge = new CurseForgeService(store)
    const resourcePacks = new ResourcePacks(store, modrinth, curseforge, profileId => game.getLaunchState().preparing || game.getRunningInstances().some(instance => instance.profileId === profileId))
    const shaderPacks = new ResourcePacks(store, modrinth, curseforge, profileId => game.getLaunchState().preparing || game.getRunningInstances().some(instance => instance.profileId === profileId), 'shader')
    const contentIcons = new ContentIconCache(join(store.dataPath, 'cache', 'content-icons'))
    const profileContent = new ProfileContent(store, modrinth, curseforge, resourcePacks, shaderPacks, profileId => game.getLaunchState().preparing || game.getRunningInstances().some(instance => instance.profileId === profileId), contentIcons)
    const technic = new TechnicService()
    const providerPacks = new ProviderPacks(store, game, curseforge, technic, activity => { downloads.activity(activity); send('launcher:activity', activity) })
    const profilePackages = new ProfilePackages(store, game, activity => { downloads.activity(activity); send('launcher:activity', activity) })
    const customClients = new CustomClients(store.minecraftPath, id => game.isInstalled(id) ? Promise.resolve() : game.install(id))
    let installingContent = false
    const profileVersions = new ProfileVersions(store, game, profileId => game.getLaunchState().preparing || game.getRunningInstances().some(instance => instance.profileId === profileId), async profileId => (await profileContent.list(profileId, 'mod')).filter(mod => mod.enabled).length)
    const installContent = async <T>(action: () => Promise<T>): Promise<T> => {
      if (installingContent || modpacks.isInstalling || game.getLaunchState().preparing) throw new Error('Oyun veya başka bir kurulum devam ediyor.')
      installingContent = true
      try { return await action() }
      catch (error) { send('launcher:activity', {kind:'error',label:'Kurulum tamamlanamadı',detail:message(error)}); throw error }
      finally { installingContent = false }
    }
    app.on('before-quit', () => { quitting = true; downloads.dispose(); discord.shutdown(); tray?.destroy(); tray = null; splashWindow?.destroy(); splashWindow = null })
    const navigate = (page: import('../shared/types').LauncherPage) => { showMainWindow(); send('launcher:navigate', page) }
    const updateShell = () => {
      const language = store.get().settings.language
      try { configureWindows(language) } catch (error) { logs.record('Windows', error) }
      if (!tray) return
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: translate(language, "Green Launcher'ı aç"), icon: nativeImage.createFromPath(persistentIcon()).resize({ width: 16, height: 16 }), click: showMainWindow },
        { type: 'separator' },
        ...navigationItems.filter(item => item.page !== 'home').map(item => ({ label: translate(language, item.label), click: () => navigate(item.page) })),
        { type: 'separator' },
        { label: translate(language, 'Çıkış'), click: () => app.quit() }
      ]))
    }
    // Shell shortcut repair and tray registration are not on the first-paint path.
    mainWindow!.once('ready-to-show', () => {
      setTimeout(() => {
        if (quitting) return
        try {
          tray = new Tray(persistentIcon())
          tray.setToolTip('Green Launcher')
          tray.on('click', showMainWindow)
          tray.on('double-click', showMainWindow)
        } catch (error) { logs.record('Sistem tepsisi', error) }
        updateShell()
      }, 250).unref()
    })
    const queue = <T>(title: string, action: () => Promise<T>, profileId?: string, forLaunch = false, content?: { title: string; iconUrl: string | null }): Promise<T> => {
      const owner = store.get().selectedAccountId
      const profileName = store.get().profiles.find(item => item.id === profileId)?.name
      let iconUrl: string | undefined
      if (content?.iconUrl && typeof content.iconUrl === 'string') {
        try { const url = new URL(content.iconUrl); if (url.protocol === 'https:' && ['cdn.modrinth.com','media.forgecdn.net','mediafilez.forgecdn.net','cdn.technicpack.net'].includes(url.hostname)) iconUrl = url.href } catch {}
      }
      const name = typeof content?.title === 'string' ? content.title.trim().slice(0, 150) : ''
      return downloads.enqueue(name || title, async () => { if (store.get().selectedAccountId !== owner) throw new Error('Hesap değişti. İşlemi yeniden başlat.'); return action() }, { profileId, profileName, forLaunch, iconUrl })
    }
    const changed = (state: ReturnType<LauncherStore['get']>) => { send('launcher:state', state); return state }
    dispatchShortcut = () => {
      const request = pendingShortcut
      if (!request) return
      pendingShortcut = null
      void (async () => {
        if (game.getLaunchState().preparing || modpacks.isInstalling || installingContent) throw new Error('Oyun hazırlanıyor. İkinci başlatma yapılmadı.')
        const profile = store.allProfiles().find(item => item.id === request.profileId)
        if (request.profileId && !profile) throw new Error('Profil bulunamadı.')
        const owner = profile?.accountId ?? request.accountId ?? store.get().selectedAccountId
        if (!owner || (profile && request.accountId && request.accountId !== profile.accountId)) throw new Error('Bu kısayol bir hesaba bağlı değil. Kısayolu yeniden oluşturun.')
        if (!store.get().accounts.some(account => account.id === owner)) throw new Error('Kısayolun hesabı bulunamadı. Önce bu hesabı ekleyin.')
        changed(store.selectAccount(owner))
        if (profile) changed(store.selectProfile(profile.id))
        const versionId = profile ? undefined : request.versionId
        const target = profileJoinTarget(profile)
        const start = () => game.play(profile?.id ?? null, versionId, false, undefined, undefined, undefined, target.worldId)
        const result = await queue(`Minecraft ${profile?.modLoaderVersion ?? profile?.versionId ?? versionId}`, () => profile && target.worldId ? worlds.launch(profile.id, target.worldId, start) : start(), profile?.id, true)
        if (result.status === 'confirmation-required') send('launcher:launchRequest', { profileId: profile?.id ?? null, versionId, accountId: owner })
        changed(store.get())
      })().catch(error => { logs.record('Kısayol', error); send('launcher:shortcutError', diagnoseError(error).message) })
    }
    const accountChangeAllowed = () => { if (downloads.pending || game.getLaunchState().preparing || modpacks.isInstalling || installingContent) throw new Error('İşlem tamamlanana kadar hesap değiştirilemez.') }
    const updateEngine = new NsisUpdater({ provider: 'github', owner: 'Despical', repo: 'GreenLauncher' })
    updateEngine.logger = null
    const updater = new LauncherUpdater(updateEngine, app.getVersion(), app.isPackaged && process.platform === 'win32', !!process.env.PORTABLE_EXECUTABLE_FILE,
      state => { if (state.phase === 'ready' && state.version && state.downloadedAt) downloads.recordLauncherUpdate(state.version, state.downloadedAt, state.total); send('launcher:update', { ...state, lastInstalled }) },
      () => downloads.pending || game.getLaunchState().preparing || game.getRunningInstances().length > 0 || modpacks.isInstalling || installingContent || signingIn,
      async file => { const error = await shell.openPath(file); if (error) throw new Error(error); app.quit() },
      error => { if (!(error as { diskSpaceReported?: boolean })?.diskSpaceReported) logs.record('Launcher güncellemesi', error) },
      process.env.PORTABLE_EXECUTABLE_FILE ? new PortableUpdateTransport(join(store.dataPath, 'cache', 'launcher-updates'), process.env.PORTABLE_EXECUTABLE_FILE, join(process.resourcesPath, 'update-helper.exe'), join(store.dataPath, 'update-result.json'), app.getVersion(), () => app.quit()) : undefined,
      version => installedUpdateReceipt(store.dataPath, app.getVersion(), version, process.execPath),
      size => {
        const bytes = size || 300 * 1024 ** 2
        const leases = []
        try {
          leases.push(diskSpace().reserve(join(process.env.LOCALAPPDATA ?? app.getPath('temp'), 'green-launcher-updater'), bytes))
          diskSpace().check(process.execPath, bytes * 4)
        } finally { for (const lease of leases) lease.release() }
      },
    )
    // Wait until the new main window is usable and the atomic updater has released its backup.
    mainWindow?.once('ready-to-show', () => {
      const cleanup = setTimeout(() => void (async () => {
        cleanUpdateCache(join(store.dataPath, 'cache', 'launcher-updates'), app.getVersion())
        if (!process.env.PORTABLE_EXECUTABLE_FILE) return
        const root = join(process.env.LOCALAPPDATA ?? '', 'GreenLauncher', 'runtime')
        const current = dirname(process.execPath)
        if (!process.env.LOCALAPPDATA || resolve(dirname(current)).toLowerCase() !== resolve(root).toLowerCase()) return
        const removed = cleanOldRuntimes(root, current, await activeLauncherPaths())
        if (removed) logs.info('Launcher güncellemesi', `${removed} eski launcher çalışma klasörü temizlendi.`, 'UPDATE_CLEANUP')
      })().catch(error => logs.record('Güncelleme temizliği', error)), 15000)
      cleanup.unref()
    })
    const startupUpdate = setTimeout(() => void updater.check(), 2500)
    startupUpdate.unref()
    const periodicUpdate = setInterval(() => void updater.check(), 6 * 60 * 60 * 1000)
    periodicUpdate.unref()
    app.on('before-quit', () => { clearTimeout(startupUpdate); clearInterval(periodicUpdate); updater.dispose() })
    const handle = <T extends unknown[]>(channel: string, action: (...args: T) => Promise<unknown> | unknown) => {
      ipcMain.handle(channel, async (_event, ...args: T) => {
        try { return await action(...args) }
        catch (error) { if (!(error as { diskSpaceReported?: boolean })?.diskSpaceReported) logs.record(channel.replace('launcher:', ''), error); throw error }
      })
    }

    handle('launcher:get-update', () => ({ ...updater.get(), lastInstalled }))
    handle('launcher:check-update', async () => ({ ...await updater.check(), lastInstalled }))
    handle('launcher:download-update', async () => ({ ...await updater.download(), lastInstalled }))
    handle('launcher:cancel-update', async () => ({ ...await updater.cancel(), lastInstalled }))
    handle('launcher:install-update', async () => ({ ...await updater.install(), lastInstalled }))
    handle('launcher:get-state', () => {
      if (pendingShortcut) setTimeout(() => dispatchShortcut?.(), 250)
      if (pendingNavigation) { const page = pendingNavigation; pendingNavigation = null; setTimeout(() => send('launcher:navigate', page), 250) }
      return store.get()
    })
    handle('launcher:get-downloads', () => downloads.snapshot())
    handle('launcher:set-presence-context', (context: import('../shared/types').LauncherPresenceContext) => {
      if (!context || !['home', 'versions', 'profiles', 'servers', 'worlds', 'mods', 'gallery', 'downloads', 'storage', 'settings', 'account'].includes(context.page)) throw new Error('Geçersiz etkinlik sayfası.')
      discord.setLauncherContext({ page: context.page, section: typeof context.section === 'string' ? context.section.slice(0, 40) : undefined, contentType: context.contentType === 'modpack' ? 'modpack' : 'mod', favorites: context.favorites === true })
    })
    handle('launcher:control-downloads', (action: string, id?: string, beforeId?: string) => { if (!['pause-all', 'resume-all', 'pause', 'resume', 'prioritize', 'reorder', 'clear'].includes(action)) throw new Error('Geçersiz indirme işlemi.'); const update = updater.get(); return downloads.control(action, action === 'clear' && update.downloadedAt && update.version ? `launcher-update-${update.version}` : id, beforeId) })
    handle('launcher:get-mod-favorites', async (refresh?: boolean) => {
      if (!refresh) return favorites.get()
      const saved = favorites.get()
      const refreshed = await modrinth.hydrate(saved.filter(item => item.provider === 'modrinth'))
      if (favorites.refresh('modrinth', refreshed)) send('launcher:modFavorites', favorites.get())
      const other = saved.filter(item => item.provider !== 'modrinth')
      let next = 0
      const refreshOther = async () => { while (next < other.length) {
        const item = other[next++]
        try {
          const details = await metadata.get(JSON.stringify(['project', item.provider, item.projectId]), () => item.provider === 'curseforge' ? curseforge.project(item.projectId) : technic.project(item.projectId))
          if (favorites.refresh(item.provider, [{ projectId: item.projectId, slug: details.slug, title: details.title, description: details.description, iconUrl: details.iconUrl, downloads: details.downloads }])) send('launcher:modFavorites', favorites.get())
        } catch { /* Keep favorites available when a provider is offline or unconfigured. */ }
      } }
      await Promise.all(Array.from({ length: Math.min(3, other.length) }, refreshOther))
      return favorites.get()
    })
    handle('launcher:set-mod-favorite', (favorite: ModFavorite, saved: boolean) => favorites.set(favorite, saved === true))
    handle('launcher:get-running-instances', () => game.getRunningInstances())
    const requireLogProfile = (profileId: string) => {
      if (!store.get().profiles.some(profile => profile.id === profileId)) throw new Error('Profil bulunamadı.')
    }
    handle('launcher:get-game-log', (profileId: string, instanceId?: string, afterSeq?: number) => {
      requireLogProfile(profileId)
      return game.console.snapshot(profileId, instanceId, Number.isFinite(afterSeq) ? afterSeq : 0)
    })
    handle('launcher:clear-game-log', (profileId: string, instanceId: string) => { requireLogProfile(profileId); return game.console.clear(profileId, instanceId) })
    handle('launcher:copy-game-log', (profileId: string, instanceId: string) => { requireLogProfile(profileId); clipboard.writeText(game.console.content(profileId, instanceId)) })
    handle('launcher:upload-game-log', async (profileId: string, instanceId: string) => {
      requireLogProfile(profileId)
      const language = store.get().settings.language
      const url = await publishGameLog(game.console, profileId, instanceId, { started: translate(language, 'Günlük yüklemesi başlatıldı.'), success: translate(language, 'Günlük mclo.gs’a yüklendi.'), failed: translate(language, 'Günlük yüklenemedi. İnternet bağlantını kontrol edip yeniden dene.') })
      clipboard.writeText(url)
      return url
    })
    handle('launcher:get-versions', async (refresh?: boolean | 'if-stale') => {
      const versions = await game.versions(refresh === true || refresh === 'if-stale' ? refresh : false)
      const known = (id: string | null): boolean => !!id && versions.some((version: GameVersion) => version.id === id || version.optifineVersions.some(variant => variant.id === id) || (version.optifineAvailable && `${version.id}-OptiFine_auto` === id))
      const current = store.get()
      if (versions.length && !current.selectedProfileId && !known(current.selectedVersionId)) {
        const recent = current.playHistory.find(entry => known(entry.versionId))?.versionId
        const profileVersion = current.profiles.find(profile => profile.id === current.selectedProfileId)?.versionId
        const fallback = recent ?? (known(profileVersion ?? null) ? profileVersion : null) ?? versions.find(version => version.type === 'release')?.id ?? versions[0].id
        changed(store.selectVersion(fallback))
      }
      return versions
    })
    handle('launcher:save-settings', (settings: Partial<LauncherSettings>) => {
      const updated = changed(store.updateSettings(settings))
      downloads.configure(updated.settings)
      discord.setEnabled(updated.settings.discordPresence)
      minimizeToTray = updated.settings.minimizeToTray
      updateShell()
      return updated
    })
    handle('launcher:save-profile', (profile: Omit<LauncherProfile, 'id' | 'createdAt'> & { id?: string }) => {
      const current = profile.id ? store.get().profiles.find(item => item.id === profile.id) : undefined
      return changed(store.saveProfile(current?.modpack ? profile : { ...profile, modLoader: undefined, modLoaderVersion: undefined, ...game.profileVersion(profile.modLoaderVersion ?? profile.versionId) }))
    })
    handle('launcher:clone-profile', (id: string) => queue('Profil klonlama', async () => { const result = await profilePackages.clone(id); changed(result.state); return result }, id))
    handle('launcher:export-profile', async (id: string) => {
      const profile = store.get().profiles.find(item => item.id === id)
      if (!profile) throw new Error('Profil bulunamadı.')
      const selection = await dialog.showSaveDialog(mainWindow!, { title: 'Profili dışa aktar', defaultPath: `${profile.name.replace(/[<>:"/\\|?*]/g, '_')}.glprofile`, filters: [{ name: 'Green Launcher profil paketi', extensions: ['glprofile'] }] })
      if (selection.canceled || !selection.filePath) return null
      return queue('Profil dışa aktarma', () => profilePackages.export(id, selection.filePath!), id)
    })
    handle('launcher:import-profile', async (path?: string) => {
      if (!store.get().selectedAccountId) throw new Error('Önce bir hesap seçin.')
      if (path === undefined) {
        const selection = await dialog.showOpenDialog(mainWindow!, { title: 'Profil içe aktar', properties: ['openFile'], filters: [{ name: 'Profil paketleri', extensions: ['glprofile', 'mrpack', 'zip'] }] })
        if (selection.canceled) return null
        path = selection.filePaths[0]
      }
      if (typeof path !== 'string' || !isAbsolute(path) || !['.glprofile', '.mrpack', '.zip'].includes(extname(path).toLowerCase())) throw new Error('Desteklenen bir profil paketi seçin: .glprofile veya .mrpack.')
      const archive = path
      return queue(`İçe aktar · ${basename(archive)}`, () => installContent(async () => { const result = extname(archive).toLowerCase() === '.mrpack' ? await modpacks.importArchive(archive) : await profilePackages.import(archive); changed(result.state); return result }))
    })
    handle('launcher:repair-profile', (id: string) => queue('Profil dosyaları onarılıyor', () => installContent(async () => {
      await profilePackages.repair(id)
      for (const mod of modrinth.installed(id)) {
        if (mod.provider === 'curseforge') await curseforge.install(id, mod.versionId, true)
        else await modrinth.install(id, mod.versionId, true)
      }
      const profile = store.get().profiles.find(item => item.id === id)!
      const manifest = join(store.profilePath(id), 'green-launcher-pack.json')
      if (existsSync(manifest)) {
        const pack = JSON.parse(readFileSync(manifest, 'utf8')) as { integrity?: Array<{ path: string; hashes: FileHashes; downloads: string[] }> }
        if (Array.isArray(pack.integrity)) for (const file of pack.integrity) await downloadVerified(file.downloads, file.hashes, safePath(store.gamePath(profile), file.path), join(store.dataPath, 'cache', 'modrinth-files'))
      }
      return changed(store.get())
    }), id))
    handle('launcher:choose-profile-cover', async () => {
      const selection = await dialog.showOpenDialog(mainWindow!, { title: 'Profil kapağı seç', properties: ['openFile'], filters: [{ name: 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
      if (selection.canceled) return null
      const image = nativeImage.createFromPath(selection.filePaths[0])
      if (image.isEmpty()) throw new Error('Kapak görseli açılamadı.')
      const { width, height } = image.getSize(), factor = Math.min(1, 960 / width, 540 / height)
      const thumbnail = image.resize({ width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)), quality: 'best' })
      const bytes = thumbnail.toJPEG(78)
      if (bytes.length > 250000) throw new Error('Kapak görseli çok büyük. Daha sade bir görsel seçin.')
      return `data:image/jpeg;base64,${bytes.toString('base64')}`
    })
    handle('launcher:save-profile-cover', (id: string, cover: import('../shared/types').ProfileCover) => changed(store.setProfileCover(id, cover)))
    handle('launcher:delete-profile', (id: string) => changed(store.deleteProfile(id)))
    handle('launcher:reorder-profiles', (ids: string[]) => changed(store.reorderProfiles(ids)))
    handle('launcher:toggle-profile-pin', (id: string) => changed(store.toggleProfilePin(id)))
    handle('launcher:select-profile', (id: string) => changed(store.selectProfile(id)))
    handle('launcher:select-version', (id: string) => changed(store.selectVersion(id)))
    handle('launcher:select-account', (id: string) => { accountChangeAllowed(); return changed(store.selectAccount(id)) })
    handle('launcher:create-offline-account', (name: string) => { accountChangeAllowed(); return changed(store.createOfflineAccount(name)) })
    handle('launcher:sign-in', async () => {
      if (signingIn) throw new Error('Microsoft girişi zaten devam ediyor.')
      signingIn = true
      try {
        const account = await accountService.signIn()
        accountChangeAllowed()
        return changed(store.upsertAccount(account))
      } finally { signingIn = false }
    })
    handle('launcher:sign-out', async (id: string) => {
      accountChangeAllowed()
      const account = store.get().accounts.find(a => a.id === id)
      if (!account) throw new Error('Hesap bulunamadı.')
      if (account.kind !== 'offline') await accountService.signOut(account)
      return changed(store.removeAccount(id))
    })
    handle('launcher:get-account-skin', (id: string) => {
      const account = store.get().accounts.find(item => item.id === id)
      return account ? accountSkins.get(account) : null
    })
    handle('launcher:install', (versionId: string) => queue(`Minecraft ${versionId}`, () => installContent(() => game.install(versionId))))
    const provider = (value: ModProvider = 'modrinth') => { if (!['modrinth','curseforge','technic'].includes(value)) throw new Error('Geçersiz mod kaynağı.'); return value }
    const metadata = new MetadataCache()
    handle('launcher:get-provider-status', () => ({curseforge:curseforge.connected}))
    handle('launcher:connect-curseforge', async (key:string) => { await curseforge.connect(key); metadata.clear(); return {curseforge:curseforge.connected} })
    handle('launcher:get-mod-categories', (source:ModProvider,type:ModContentType) => provider(source)==='curseforge'?metadata.get(JSON.stringify(['categories',source,type]), () => curseforge.categories(type)):[])
    handle('launcher:search-mods', async (query: string, gameVersion: string, loader: ModLoader, sort: ModSort, offset: number, category: string, contentType: ModContentType = 'mod', source?:ModProvider) => {
      const selected=provider(source)
      const result = await metadata.get(JSON.stringify(['search',selected,query,gameVersion,loader,sort,offset,category,contentType]), () => selected==='curseforge'?curseforge.search(query,gameVersion,loader,sort,offset,category,contentType):selected==='technic'?technic.search(query,gameVersion,sort,offset):modrinth.search(query, gameVersion, loader, sort, offset, category, contentType))
      if (selected === 'modrinth') result.hits = await modrinth.hydrate(result.hits)
      if (favorites.refresh(selected, result.hits)) send('launcher:modFavorites', favorites.get())
      return result
    })
    handle('launcher:get-account-capes', (id: string) => {
      const account = store.get().accounts.find(item => item.id === id)
      return account ? accountCapes.get(account) : []
    })
    handle('launcher:set-account-cape', (id: string, capeId: string) => {
      const account = store.get().accounts.find(item => item.id === id)
      if (!account) throw new Error('Hesap bulunamadı.')
      return accountCapes.activate(account, capeId)
    })
    handle('launcher:get-mod-project', async (id: string, source?:ModProvider) => {
      const selected = provider(source)
      const details = await metadata.get(JSON.stringify(['project',selected,id]), () => selected==='curseforge'?curseforge.project(id):selected==='technic'?technic.project(id):modrinth.project(id))
      if (selected === 'modrinth') {
        const [summary] = await modrinth.hydrate([{ projectId: id, slug: details.slug, title: details.title, description: details.description, iconUrl: details.iconUrl, downloads: details.downloads, author: '', updated: '', categories: [] }])
        Object.assign(details, { slug: summary.slug, title: summary.title, description: summary.description, iconUrl: summary.iconUrl, downloads: summary.downloads })
      }
      if (favorites.refresh(selected, [{ projectId: id, slug: details.slug, title: details.title, description: details.description, iconUrl: details.iconUrl, downloads: details.downloads }])) send('launcher:modFavorites', favorites.get())
      return details
    })
    handle('launcher:get-mod-versions', (id: string, gameVersion: string, loader: ModLoader, source?:ModProvider, allGameVersions = false, contentType: ModContentType = 'mod') => metadata.get(JSON.stringify(['versions',provider(source),id,gameVersion,loader,allGameVersions === true,contentType]), () => source==='curseforge'?curseforge.versions(id,gameVersion,loader,allGameVersions === true,contentType):source==='technic'?technic.versions(id):modrinth.versions(id, gameVersion, loader,allGameVersions === true,contentType)))
    handle('launcher:get-profile-content', (profileId: string, kind: ProfileContentKind) => profileContent.list(profileId, kind))
    handle('launcher:set-profile-content-enabled', (profileId: string, kind: ProfileContentKind, filename: string, enabled: boolean) => {
      if (installingContent || downloads.pending) throw new Error('Başka bir kurulum devam ediyor.')
      return profileContent.enable(profileId, kind, filename, enabled === true)
    })
    handle('launcher:check-profile-content-updates', async (profileId: string, kind: ProfileContentKind, force = true) => {
      const result = await profileContent.updates(profileId, kind, force !== false)
      if (force !== false) {
        for (const error of new Set(result.filter(item => item.status === 'error').map(item => item.error ?? 'Güncelleme kontrolü tamamlanamadı.'))) logs.record('Paket güncellemeleri', error)
        if (result.length && result.every(item => item.status === 'unknown')) logs.record('Paket güncellemeleri', 'Kaynak bilgisi bulunamadığı için güncellemeler kontrol edilemedi.')
      }
      return result
    })
    handle('launcher:reveal-profile-content', (profileId: string, kind: ProfileContentKind, filename: string) => shell.showItemInFolder(profileContent.filePath(profileId, kind, filename)))
    handle('launcher:get-content-icon', (url: string) => typeof url === 'string' && url.length <= 4096 ? contentIcons.get(url) : undefined)
    handle('launcher:install-profile-content', (profileId: string, kind: ProfileContentKind, versionId: string, source: 'modrinth' | 'curseforge', content?: {title:string;iconUrl:string|null}) => queue(content?.title || 'Paket kurulumu', () => installContent(() => profileContent.install(profileId, kind, versionId, source)), profileId, false, content))
    handle('launcher:update-profile-content', (profileId: string, kind: ProfileContentKind, filename: string, content?: {title:string;iconUrl:string|null}) => queue(content?.title || 'Paket güncellemesi', () => installContent(() => profileContent.update(profileId, kind, filename)), profileId, false, content))
    handle('launcher:get-resource-packs', (profileId: string) => resourcePacks.list(profileId))
    handle('launcher:set-resource-pack-enabled', (profileId: string, filename: string, enabled: boolean) => {
      if (installingContent || downloads.pending) throw new Error('Başka bir kurulum devam ediyor.')
      return resourcePacks.enable(profileId, filename, enabled === true)
    })
    handle('launcher:install-resource-pack', (profileId: string, versionId: string, source: 'modrinth' | 'curseforge', content?: {title:string;iconUrl:string|null}) => queue('Kaynak paketi kurulumu', () => installContent(() => resourcePacks.install(profileId, versionId, source)), profileId, false, content))
    handle('launcher:get-installed-mods', (profileId: string) => modrinth.installed(profileId))
    handle('launcher:get-profile-mods', (profileId: string) => {
      const profile = store.get().profiles.find(item => item.id === profileId)
      if (!profile) throw new Error('Profil bulunamadı.')
      const directory = join(store.gamePath(profile), 'mods')
      if (!existsSync(directory)) return []
      const indexed = new Map(modrinth.installed(profileId).map(mod => [mod.filename, mod]))
      return readdirSync(directory, { withFileTypes: true }).filter(file => file.isFile() && /\.(jar|litemod)$/i.test(file.name)).map(file => indexed.get(file.name) ?? { projectId: '', title: file.name.replace(/\.(jar|litemod)$/i, ''), versionId: '', versionNumber: '', filename: file.name }).sort((a, b) => a.title.localeCompare(b.title))
    })
    handle('launcher:install-mod', (profileId: string, versionId: string, source?:ModProvider, content?: {title:string;iconUrl:string|null}) => queue('Mod kurulumu', () => installContent(() => {
      const selected=provider(source);if(selected==='technic')throw new Error('Technic yalnızca mod paketleri sunar.')
      return profileContent.install(profileId, 'mod', versionId, selected).then(() => modrinth.installed(profileId))
    }), profileId, false, content))
    handle('launcher:install-modpack', (versionId: string, gameVersion: string, loader: ModLoader, source?:ModProvider, content?: {title:string;iconUrl:string|null}) => queue('Mod paketi kurulumu', () => installContent(async () => {
      const selected=provider(source)
      const result = selected==='modrinth'?await modpacks.install(versionId, gameVersion, loader):await providerPacks.install(selected,versionId)
      changed(result.state)
      return result
    }), undefined, false, content))
    handle('launcher:configure-profile-version', (profileId: string, minecraftVersion: string, loader?: ProfileLoader, acknowledged?: boolean) => queue(`Minecraft ${minecraftVersion}`, () => installContent(async () => {
      const result = await profileVersions.configure(profileId, minecraftVersion, loader, acknowledged === true)
      if (result.status === 'configured') changed(result.state)
      return result
    }), profileId))
    handle('launcher:install-mod-loader', (profileId: string, gameVersion: string, loader: ModLoader) => queue(`${loader} · Minecraft ${gameVersion}`, async () => {
      if (installingContent) throw new Error('Başka bir kurulum devam ediyor.')
      const profile = store.get().profiles.find(item => item.id === profileId)
      if (!profile) throw new Error('Profil bulunamadı.')
      if (profile.versionId !== gameVersion) throw new Error('Yükleyici profilin Minecraft sürümüyle uyumlu olmalı. Başka bir sürüm için yeni profil oluşturun.')
      if (profile.modpack) {
        if (profile.versionId !== gameVersion || profile.modLoader !== loader) throw new Error('Mod paketi profilinin yükleyicisi değiştirilemez.')
        if (profile.modLoaderVersion && await game.hasModLoaderInstallation(profile.modLoaderVersion)) return store.get()
        throw new Error('Mod paketi dosyalarını profil menüsünden onarın.')
      }
      if ((profile.modLoader !== loader || profile.versionId !== gameVersion) && (modrinth.installed(profileId).length || (() => {
        const modsPath = join(store.gamePath(profile), 'mods')
        return existsSync(modsPath) && readdirSync(modsPath).some(name => /\.(jar|litemod)$/i.test(name))
      })())) throw new Error('Bu profilde modlar var. Farklı sürüm veya yükleyici için yeni profil oluşturun.')
      const existing = store.get().profiles.find(item => item.id !== profileId && item.versionId === gameVersion && item.modLoader === loader && item.modLoaderVersion)
      const versionId = existing?.modLoaderVersion && await game.hasModLoaderInstallation(existing.modLoaderVersion)
        ? existing.modLoaderVersion
        : await game.installModLoader(gameVersion, loader, profile)
      return changed(store.setModLoader(profileId, gameVersion, loader, versionId))
    }, profileId))
    handle('launcher:delete-version', async (versionId: string) => { await game.deleteVersion(versionId) })
    handle('launcher:play', (profileId: string, allowAdditional?: boolean, versionId?: string, serverAddress?: string, serverPreference?: ServerJoinPreference, worldId?: string) => queue(`Minecraft ${store.get().profiles.find(item => item.id === profileId)?.modLoaderVersion ?? store.get().profiles.find(item => item.id === profileId)?.versionId ?? ''}`, async () => {
      if (modpacks.isInstalling || installingContent) throw new Error('Mod paketi kurulumu devam ediyor.')
      if (worlds.isBusy) throw new Error('Başka bir dünya işlemi devam ediyor.')
      const target = profileJoinTarget(store.get().profiles.find(item => item.id === profileId), serverAddress, worldId)
      const start = () => game.play(profileId, versionId, allowAdditional, serverAddress, serverPreference, undefined, target.worldId)
      const result = target.worldId !== undefined ? await worlds.launch(profileId, target.worldId, start) : await start()
      changed(store.get())
      return result
    }, profileId, true))
    handle('launcher:play-version', (versionId: string, allowAdditional?: boolean, serverAddress?: string, serverPreference?: ServerJoinPreference, temporaryOfflineName?: string) => queue(`Minecraft ${versionId}`, async () => {
      if (modpacks.isInstalling || installingContent) throw new Error('Mod paketi kurulumu devam ediyor.')
      if (worlds.isBusy) throw new Error('Başka bir dünya işlemi devam ediyor.')
      const result = await game.play(null, versionId, allowAdditional, serverAddress, serverPreference, temporaryOfflineName)
      changed(store.get())
      return result
    }, undefined, true))
    handle('launcher:open-version-location', async (versionId: string) => {
      const error = await shell.openPath(game.versionLocation(versionId))
      if (error) throw new Error('Sürüm klasörü açılamadı.')
    })
    handle('launcher:get-error-log', () => logs.get())
    handle('launcher:clear-error-log', () => logs.clear())
    handle('launcher:open-error-log', () => { shell.showItemInFolder(logs.path) })
    handle('launcher:choose-java', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Java çalıştırılabilir dosyasını seçin',
        properties: ['openFile'],
        filters: [{ name: 'Java', extensions: ['exe'] }]
      })
      return result.canceled ? null : result.filePaths[0]
    })
    handle('launcher:get-java-runtimes', () => game.javaRuntimes())
    const worlds = new WorldService(store, directory => {
      if (game.getLaunchState().preparing || game.getRunningInstances().some(instance => {
        const profile = store.get().profiles.find(item => item.id === instance.profileId)
        return profile && resolve(store.gamePath(profile)).toLowerCase() === resolve(directory).toLowerCase()
      })) throw new Error('Dünya açıkken bu işlem yapılamaz.')
    })
    handle('launcher:get-worlds', (profileId: string, refresh?: boolean) => worlds.list(profileId, refresh))
    handle('launcher:import-world', async (profileId: string) => {
      await worlds.list(profileId)
      const selected = await dialog.showOpenDialog(mainWindow!, { title: translate(store.get().settings.language, 'Dünya klasörünü seç'), properties: ['openDirectory'] })
      return selected.canceled || !selected.filePaths[0] ? null : worlds.import(profileId, selected.filePaths[0])
    })
    handle('launcher:rename-world', (profileId: string, id: string, name: string) => worlds.rename(profileId, id, name))
    handle('launcher:duplicate-world', (profileId: string, id: string, name: string) => worlds.duplicate(profileId, id, name))
    handle('launcher:delete-world', (profileId: string, id: string) => worlds.delete(profileId, id, path => shell.trashItem(path)))
    handle('launcher:reset-world-icon', (profileId: string, id: string) => worlds.resetIcon(profileId, id))
    handle('launcher:copy-world-seed', async (profileId: string, id: string) => {
      const seed = (await worlds.list(profileId)).find(item => item.id === id)?.seed
      if (seed === undefined) throw new Error('Dünya tohumu okunamadı.')
      clipboard.writeText(seed)
    })
    handle('launcher:open-world-folder', async (profileId: string, id: string) => {
      const error = await shell.openPath(await worlds.path(profileId, id))
      if (error) throw new Error(error)
    })
    handle('launcher:get-servers', (profileId?: string | null) => servers.forProfile(profileId).get())
    handle('launcher:reorder-servers', (ids: string[], profileId?: string | null) => servers.forProfile(profileId).reorder(ids))
    handle('launcher:save-server', (server: { id?: string; name: string; address: string; resourcePacks?: ResourcePackPolicy }, profileId?: string | null) => {
      if (!store.get().profiles.length) throw new Error('Sunucu ekleyebilmek için önce bir profil oluştur.')
      return servers.forProfile(profileId).save(server)
    })
    handle('launcher:delete-server', (id: string, profileId?: string | null) => servers.forProfile(profileId).delete(id))
    handle('launcher:refresh-server', (id: string, profileId?: string | null) => servers.forProfile(profileId).refresh(id))
    handle('launcher:import-custom-client', async () => {
      const selected = await dialog.showOpenDialog(mainWindow!, { title: translate(store.get().settings.language, 'İstemci klasörünü seç'), properties: ['openDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      return queue('Özel istemci', () => installContent(async () => {
        const id = await customClients.import(selected.filePaths[0])
        return { id, versions: await game.versions() }
      }))
    })
    const profileModsPath = (profileId: string): string | null => {
      const profile = store.get().profiles.find(item => item.id === profileId)
      if (!profile) throw new Error('Profil bulunamadı.')
      const path = join(store.gamePath(profile), 'mods')
      if (!profile.modpack && (!existsSync(path) || !readdirSync(path, { withFileTypes: true }).some(file => file.isFile() && /\.(jar|zip)$/i.test(file.name)))) return null
      return path
    }
    handle('launcher:get-profile-mods-path', (id: string) => profileModsPath(id))
    handle('launcher:open-profile-mods', async (id: string) => {
      const path = profileModsPath(id)
      if (!path) throw new Error('Bu profilde kurulu mod yok.')
      mkdirSync(path, { recursive: true })
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    })
    handle('launcher:delete-java-runtime', (path: string) => game.deleteJavaRuntime(path))
    handle('launcher:open-java-location', async (path: string) => {
      if (!(await game.javaRuntimes()).some(runtime => runtime.path.toLowerCase() === path.toLowerCase()) || !existsSync(path)) throw new Error('Java dosyası bulunamadı.')
      shell.showItemInFolder(path)
    })
    handle('launcher:create-profile-shortcut', (profileId: string) => {
      if (!app.isPackaged) throw new Error('Masaüstü kısayolu kurulu sürümde oluşturulabilir.')
      const profile = store.get().profiles.find(item => item.id === profileId)
      if (!profile) throw new Error('Profil bulunamadı.')
      const account = store.get().accounts.find(item => item.id === profile.accountId)
      if (!account) throw new Error('Önce bir hesap seçin.')
      const safeName = `${account.name} - ${profile.name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/g, '').trim().slice(0, 50) || 'Profil'
      const path = join(app.getPath('desktop'), `Green Launcher - ${safeName} (${profile.id.slice(0, 8)}).lnk`)
      const success = shell.writeShortcutLink(path, 'create', {
        target: shortcutTarget(),
        args: shortcutArguments(account.id, profile.id),
        cwd: dirname(shortcutTarget()),
        description: `${account.name} · ${profile.name} profiliyle Minecraft'ı başlat`,
        icon: shortcutIcon(),
        iconIndex: 0,
        appUserModelId: 'com.greenlauncher.desktop'
      })
      if (!success) throw new Error('Masaüstü kısayolu oluşturulamadı.')
      return path
    })
    handle('launcher:create-version-shortcut', (versionId: string) => {
      if (!app.isPackaged) throw new Error('Masaüstü kısayolu kurulu sürümde oluşturulabilir.')
      if (!/^[a-zA-Z0-9._-]{1,90}$/.test(versionId)) throw new Error('Geçersiz sürüm kimliği.')
      const current = store.get()
      const account = current.accounts.find(item => item.id === current.selectedAccountId)
      if (!account) throw new Error('Önce bir hesap seçin.')
      const path = join(app.getPath('desktop'), `Green Launcher - ${account.name} - Minecraft ${versionId}.lnk`)
      const success = shell.writeShortcutLink(path, 'create', {
        target: shortcutTarget(),
        args: shortcutArguments(account.id, null, versionId),
        cwd: dirname(shortcutTarget()),
        description: `${account.name} · Minecraft ${versionId}`,
        icon: shortcutIcon(),
        iconIndex: 0,
        appUserModelId: 'com.greenlauncher.desktop'
      })
      if (!success) throw new Error('Masaüstü kısayolu oluşturulamadı.')
      return path
    })
    handle('launcher:open-folder', async (profileId?: string) => {
      const profile = store.get().profiles.find(p => p.id === profileId)
      const path = profile ? store.gamePath(profile) : store.dataPath
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    })
    handle('launcher:open-shared-folder', async () => {
      const error = await shell.openPath(store.minecraftPath)
      if (error) throw new Error(error)
    })
    handle('launcher:choose-game-directory', async () => {
      const result = await dialog.showOpenDialog(mainWindow!, { title: 'Oyun klasörünü seçin', properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : result.filePaths[0]
    })
    handle('launcher:get-screenshots', (scope?: string, offset?: number, sort?: 'newest' | 'oldest') => library.screenshots(scope, offset, sort))
    handle('launcher:get-screenshot', (id: string) => library.screenshot(id))
    handle('launcher:get-screenshot-preview', (id: string) => library.screenshotPreview(id))
    handle('launcher:copy-screenshot', (id: string) => library.copyScreenshot(id))
    handle('launcher:open-screenshot-location', (id: string) => library.openScreenshotLocation(id))
    handle('launcher:delete-screenshot', (id: string) => library.deleteScreenshot(id))
    handle('launcher:get-disk-usage', () => library.diskUsage())
    handle('launcher:get-cleanup-preview', () => library.cleanupPreview())
    handle('launcher:get-offline-status', () => {
      const current = store.get()
      const account = current.accounts.find(item => item.id === current.selectedAccountId)
      const profile = current.profiles.find(item => item.id === current.selectedProfileId)
      const versionId = profile?.modLoaderVersion ?? profile?.versionId
      return { accountReady: !!account && (account.kind === 'offline' || accountService.hasCachedLaunchToken(account)), versionReady: !!versionId && game.isInstalled(versionId) }
    })
    handle('launcher:clean-unused-files', async (approvedPaths: string[]) => {
      if (game.getLaunchState().busy || installingContent) throw new Error('Oyun veya indirme sürerken temizlik yapılamaz.')
      return library.cleanUnusedFiles(approvedPaths)
    })
    handle('launcher:open-external', async (url: string) => {
      const parsed = new URL(url)
      const trustedSite = ['www.curseforge.com', 'curseforge.com', 'console.curseforge.com', 'support.curseforge.com', 'www.technicpack.net', 'technicpack.net', 'modrinth.com', 'microsoft.com', 'www.microsoft.com', 'aka.ms', 'minecraft.net', 'www.minecraft.net', 'learn.microsoft.com', 'optifine.net', 'www.optifine.net'].includes(parsed.hostname)
      const projectRepository = parsed.hostname === 'github.com' && /^\/Despical(?:\/GreenLauncher)?\/?$/.test(parsed.pathname)
      const gplLicense = parsed.hostname === 'www.gnu.org' && parsed.pathname === '/licenses/gpl-3.0.html'
      const launcherSite = ['greenlauncher.org', 'www.greenlauncher.org'].includes(parsed.hostname)
      const launcherDiscord = parsed.hostname === 'discord.gg' && parsed.pathname === '/uXVU8jmtpU'
      if (parsed.protocol !== 'https:' || (!trustedSite && !projectRepository && !gplLicense && !launcherSite && !launcherDiscord)) {
        throw new Error('Bu bağlantı açılamıyor.')
      }
      await shell.openExternal(parsed.toString())
    })
    handle('launcher:window-action', (action: 'minimize' | 'maximize' | 'close') => {
      if (!mainWindow) return
      if (action === 'minimize') mainWindow.minimize()
      if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
      if (action === 'close') mainWindow.close()
    })
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  }).catch(error => {
    dialog.showErrorBox('Green Launcher', message(error))
    app.quit()
  })
}

app.on('window-all-closed', () => app.quit())
