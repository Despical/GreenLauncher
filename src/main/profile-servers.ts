import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LauncherStore } from './store'
import { ServerService } from './servers'

export class ProfileServers {
  private services = new Map<string, { directory?: string; service: ServerService }>()
  constructor(private readonly store: LauncherStore) {}
  forProfile(profileId?: string | null): ServerService {
    const state = this.store.get(), id = profileId === undefined ? state.selectedProfileId ?? state.profiles[0]?.id ?? null : profileId
    const profile = id ? state.profiles.find(item => item.id === id) : undefined
    if (id && !profile) throw new Error('Profil bulunamadı.')
    const accountId = state.accounts.find(item => item.id === state.selectedAccountId)?.id ?? 'unassigned'
    if (!/^[\w-]{1,90}$/.test(accountId)) throw new Error('Oyuncu adı geçersiz.')
    const key = profile ? profile.id : `unassigned:${accountId}`
    const directory = profile ? this.store.gamePath(profile) : undefined
    const cached = this.services.get(key)
    if (cached && cached.directory === directory) return cached.service
    const metadata = profile ? join(this.store.profilePath(profile.id), 'servers.json') : join(this.store.dataPath, 'account-servers', `${accountId}.json`)
    const service = new ServerService(metadata, directory)
    // Move the old shared list once, without copying it into every profile.
    const marker = join(this.store.dataPath, 'servers-profile-migration.json')
    if (profile && !existsSync(marker)) {
      const legacy = new ServerService(join(this.store.dataPath, 'servers.json')).get()
      service.importLegacy(legacy)
      mkdirSync(this.store.dataPath, { recursive: true })
      writeFileSync(marker, JSON.stringify({ profileId: profile?.id ?? null, accountId: state.selectedAccountId }), 'utf8')
    }
    this.services.set(key, { directory, service }); return service
  }
}
