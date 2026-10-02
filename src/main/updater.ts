import type { NsisUpdater } from 'electron-updater'
import type { LauncherUpdate } from '../shared/types'

/** Only stable, strictly newer releases are installable, including at install time. */
export function newerRelease(candidate: string | undefined, current: string): boolean {
  const parse = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null
  const a = parse(candidate ?? ''), b = parse(current)
  if (!a || !b || ![...a, ...b].every(Number.isSafeInteger)) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

export class LauncherUpdater {
  private state: LauncherUpdate
  private checking?: Promise<LauncherUpdate>
  private downloading?: Promise<LauncherUpdate>
  private token?: { cancel(): void }
  private cancelled = false
  private files: string[] = []
  private installing = false
  constructor(
    private engine: NsisUpdater,
    version: string,
    enabled: boolean,
    portable: boolean,
    private changed: (state: LauncherUpdate) => void,
    private busy: () => boolean,
    private installPortable: (file: string) => Promise<void>,
  ) {
    this.state = { phase: enabled ? 'idle' : 'disabled', currentVersion: version, portable }
    engine.autoDownload = false
    engine.autoInstallOnAppQuit = false
    engine.allowDowngrade = false
    engine.allowPrerelease = false
    engine.disableWebInstaller = true
    engine.on('error', error => {
      if (!this.cancelled) this.fail(error)
    })
    engine.on('download-progress', progress => {
      if (this.state.phase === 'downloading' && !this.cancelled) this.set({
        percent: Math.max(0, Math.min(100, progress.percent)), transferred: progress.transferred,
        total: progress.total, bytesPerSecond: progress.bytesPerSecond,
      })
    })
  }
  get(): LauncherUpdate { return { ...this.state } }
  private set(value: Partial<LauncherUpdate>) { this.state = { ...this.state, ...value }; this.changed(this.get()) }
  private fail(error: unknown) {
    const code = String((error as { code?: string })?.code ?? '')
    this.set({ phase: 'error', error: /CHECKSUM|SIGNATURE/.test(code) ? 'checksum' : /CHANNEL_FILE_NOT_FOUND|INVALID_RELEASE_FEED|NO_PUBLISHED_VERSIONS/.test(code) ? 'metadata' : this.installing ? 'install' : 'network' })
  }
  check(): Promise<LauncherUpdate> {
    if (this.checking) return this.checking
    if (this.state.phase === 'disabled' || this.downloading || this.state.phase === 'ready' || this.installing) return Promise.resolve(this.get())
    this.set({ phase: 'checking', error: undefined })
    this.checking = (async () => {
      try {
        const result = await this.engine.checkForUpdates()
        if (!result) throw new Error('Update feed unavailable')
        const info = result.updateInfo
        this.token = result.cancellationToken
        const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes : info.releaseNotes?.map(item => item.note).join('\n\n')
        this.files = []
        this.set({ phase: newerRelease(info.version, this.state.currentVersion) ? 'available' : 'current',
          version: newerRelease(info.version, this.state.currentVersion) ? info.version : undefined,
          notes: notes?.slice(0, 32000), releasedAt: info.releaseDate, checkedAt: new Date().toISOString(), percent: undefined,
        })
      } catch (error) { this.fail(error) }
      finally { this.checking = undefined }
      return this.get()
    })()
    return this.checking
  }
  download(): Promise<LauncherUpdate> {
    if (this.downloading) return this.downloading
    if (!newerRelease(this.state.version, this.state.currentVersion) || !['available', 'error'].includes(this.state.phase)) return Promise.resolve(this.get())
    // A cancelled token cannot be reused. Recheck the release before retrying.
    this.downloading = (async () => {
      this.cancelled = false
      try {
        this.set({ phase: 'checking', error: undefined })
        const result = await this.engine.checkForUpdates()
        if (!result || !newerRelease(result.updateInfo.version, this.state.currentVersion)) {
          this.set({ phase: 'current', version: undefined }); return this.get()
        }
        this.token = result.cancellationToken
        const notes = result.updateInfo.releaseNotes
        this.set({ phase: 'downloading', version: result.updateInfo.version, percent: 0, transferred: 0, total: 0,
          notes: (typeof notes === 'string' ? notes : notes?.map(item => item.note).join('\n\n'))?.slice(0, 32000),
        })
        if (this.cancelled) this.token?.cancel()
        this.files = await this.engine.downloadUpdate(result.cancellationToken)
        if (!this.cancelled && this.files.length) this.set({ phase: 'ready', percent: 100 })
        else this.set({ phase: 'available', percent: undefined })
      } catch (error) {
        this.files = []
        if (this.cancelled) this.set({ phase: 'available', error: undefined, percent: undefined })
        else this.fail(error)
      } finally { this.downloading = undefined }
      return this.get()
    })()
    return this.downloading
  }
  cancel(): Promise<LauncherUpdate> {
    if (this.downloading) { this.cancelled = true; this.token?.cancel(); return this.downloading }
    return Promise.resolve(this.get())
  }
  async install(): Promise<LauncherUpdate> {
    if (this.installing || this.state.phase !== 'ready' || !this.files.length || !newerRelease(this.state.version, this.state.currentVersion)) return this.get()
    if (this.busy()) { this.set({ error: 'busy' }); return this.get() }
    this.installing = true
    this.set({ error: undefined })
    try {
      if (this.state.portable) await this.installPortable(this.files[0])
      else this.engine.quitAndInstall(false, true)
    } catch (error) { this.fail(error) }
    finally { this.installing = false }
    return this.get()
  }
  dispose() { this.cancelled = true; this.token?.cancel() }
}
