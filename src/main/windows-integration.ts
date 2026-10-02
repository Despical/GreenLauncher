import { app, nativeImage, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { LauncherPage, LauncherSettings } from '../shared/types'

export const appId = 'com.greenlauncher.desktop'
export const executable = (): string => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
const pages: Array<{ page: LauncherPage; label: string }> = [
  { page: 'home', label: 'Ana Sayfa' }, { page: 'gallery', label: 'Ekran görüntüleri' },
  { page: 'profiles', label: 'Profillerim' }, { page: 'versions', label: 'Sürümler' },
  { page: 'servers', label: 'Sunucular' }, { page: 'worlds', label: 'Dünyalar' },
  { page: 'downloads', label: 'İndirmeler' }, { page: 'settings', label: 'Ayarlar' }
]
export const navigationItems = pages
export function navigationArgument(args: string[]): LauncherPage | null {
  const value = args.find(arg => arg.startsWith('--open-page='))?.slice(12)
  return pages.find(item => item.page === value)?.page ?? null
}

// Shell shortcuts and jump lists outlive portable extraction directories.
export function persistentIcon(): string {
  const source = app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(app.getAppPath(), 'build/icon.ico')
  const directory = join(app.getPath('userData'), 'windows')
  const target = join(directory, 'launcher.ico')
  mkdirSync(directory, { recursive: true })
  if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) copyFileSync(source, target)
  return target
}

export function configureWindows(_language: LauncherSettings['language']): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const target = executable(), icon = persistentIcon()
  const details = { target, args: '', cwd: dirname(target), description: 'Green Launcher', icon, iconIndex: 0, appUserModelId: appId }
  const programs = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  mkdirSync(programs, { recursive: true })
  if (!shell.writeShortcutLink(join(programs, 'Green Launcher.lnk'), 'create', details)) throw new Error('Windows uygulama kısayolu oluşturulamadı.')
  // Repair only this launcher's existing pinned app shortcut; never pin new items.
  const pinned = join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  if (existsSync(pinned)) for (const file of readdirSync(pinned)) {
    if (!/^green\s?launcher.*\.lnk$/i.test(file)) continue
    const link = join(pinned, file)
    try {
      const old = shell.readShortcutLink(link)
      if (/^greenlauncher(?:[-\w.]*)?\.exe$/i.test(basename(old.target)) && !/--launch-(profile|version)/.test(old.args ?? '')) shell.writeShortcutLink(link, 'update', details)
    } catch { /* A stale pin must not prevent startup. */ }
  }
  if (!app.setUserTasks([])) throw new Error('Windows görev çubuğu kısayolları güncellenemedi.')
}

export function menuIcon() { return nativeImage.createFromPath(persistentIcon()).resize({ width: 16, height: 16 }) }
