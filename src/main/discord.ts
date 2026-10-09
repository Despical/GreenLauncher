import type { Client } from '@xhayper/discord-rpc'
import type { LauncherPresenceContext } from '../shared/types'

// Discord application IDs are public. This value belongs to the Green Launcher
// application in the Discord Developer Portal.
export const DISCORD_APPLICATION_ID = '1553741172500070571'

export class DiscordPresence {
  private client: Client | null = null
  private versionId: string | null = null
  private startedAt = new Date()
  private publishedKey = ''
  private syncing = false
  private requested = false
  private context: LauncherPresenceContext = { page: 'home' }
  private contextTimer: NodeJS.Timeout | null = null
  private readonly retryTimer: NodeJS.Timeout

  constructor(private readonly applicationId: string, private enabled: boolean) {
    this.requestSync()
    this.retryTimer = setInterval(() => this.requestSync(), 20_000)
    this.retryTimer.unref()
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.requestSync()
  }

  setLauncherContext(context: LauncherPresenceContext): void {
    if (JSON.stringify(this.context) === JSON.stringify(context)) return
    this.context = { ...context }
    if (this.contextTimer) clearTimeout(this.contextTimer)
    // Collapse fast navigation into one update; game events remain immediate.
    this.contextTimer = setTimeout(() => { this.contextTimer = null; this.requestSync() }, 750)
    this.contextTimer.unref()
  }

  private launcherDetails(): string {
    const { page, section, contentType, favorites } = this.context
    if (section === 'changelog') return 'Değişiklik günlüğünü okuyor'
    if (section === 'profile-cover') return 'Profil kapağını düzenliyor'
    if (section === 'edit-profile') return 'Profilini düzenliyor'
    if (page === 'mods') {
      if (section === 'custom' || section === 'local') return 'Profilindeki modları yönetiyor'
      const provider = section === 'technic' ? 'Technic' : section === 'curseforge' ? 'CurseForge' : 'Modrinth'
      return favorites ? `${provider} favorilerine bakıyor` : `${provider} ${contentType === 'modpack' || section === 'technic' ? 'mod paketlerine' : 'modlarına'} bakıyor`
    }
    if (page === 'account') return section === 'capes' ? 'Pelerinlerini görüntülüyor' : 'Hesabını görüntülüyor'
    if (page === 'analytics') return 'Oyun istatistiklerini inceliyor'
    if (page === 'shader-packs') return 'Shader paketlerini yönetiyor'
    if (page === 'resource-packs') return 'Kaynak paketlerini yönetiyor'
    if (page === 'settings') return section === 'logs' ? 'Günlükleri inceliyor' : section === 'java' ? 'Java kurulumlarını yönetiyor' : 'Launcher ayarlarını düzenliyor'
    return { worlds: 'Dünyalarını görüntülüyor', servers: 'Sunucularını görüntülüyor', home: 'Ana sayfaya bakıyor', versions: 'Minecraft sürümlerini inceliyor', profiles: 'Profillerini görüntülüyor', gallery: 'Ekran görüntülerine bakıyor', downloads: 'İndirmelerini yönetiyor', storage: 'Depolama alanını inceliyor' }[page]
  }

  setPlaying(versionId: string): void {
    if (this.versionId === versionId) return
    this.versionId = versionId
    this.startedAt = new Date()
    this.publishedKey = ''
    this.requestSync()
  }

  clearPlaying(): void {
    if (!this.versionId) return
    this.versionId = null
    this.startedAt = new Date()
    this.requestSync()
  }

  shutdown(): void {
    clearInterval(this.retryTimer)
    if (this.contextTimer) clearTimeout(this.contextTimer)
    this.enabled = false
    this.versionId = null
    this.requestSync()
  }

  private requestSync(): void {
    this.requested = true
    if (!this.syncing) void this.flush()
  }

  private async flush(): Promise<void> {
    this.syncing = true
    try {
      while (this.requested) {
        this.requested = false
        await this.reconcile()
      }
    } finally {
      this.syncing = false
    }
  }

  private async disconnect(client: Client): Promise<void> {
    if (this.client === client) this.client = null
    this.publishedKey = ''
    try { if (client.isConnected) await client.user?.clearActivity() } catch { /* Discord may have closed. */ }
    try { await client.destroy() } catch { /* The socket may already be gone. */ }
  }

  private async reconcile(): Promise<void> {
    if (!this.enabled || !this.applicationId) {
      if (this.client) await this.disconnect(this.client)
      return
    }

    if (!this.client) {
      // Publish a launcher presence as soon as the user enables it.
      const rpc = await import('@xhayper/discord-rpc').catch(() => null)
      if (!rpc || !this.enabled) return
      const client = new rpc.Client({ clientId: this.applicationId })
      this.client = client
      client.on('disconnected', () => {
        if (this.client === client) { this.client = null; this.publishedKey = '' }
      })
      try {
        await client.login()
      } catch {
        await this.disconnect(client)
        return
      }
    }

    const client = this.client
    if (!client || !client.isConnected || !client.user) return
    if (!this.enabled) { this.requestSync(); return }
    const details = this.versionId ? `Playing Minecraft ${this.versionId}` : this.launcherDetails()
    const key = `${this.versionId}:${details}:${this.startedAt.getTime()}`
    if (this.publishedKey === key) return
    try {
      await client.user.setActivity({
        type: 0,
        details,
        state: this.versionId ? 'Minecraft: Java Edition' : undefined,
        startTimestamp: this.startedAt,
        largeImageKey: 'green_launcher_slime',
        largeImageText: 'Green Launcher'
      })
      this.publishedKey = key
    } catch {
      await this.disconnect(client)
    }
  }
}
