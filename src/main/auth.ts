import { app, BrowserWindow, safeStorage } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MicrosoftAuthenticator, MojangClient } from '@xmcl/user'
import type { GameAccount } from '../shared/types'
import { LauncherStore } from './store'

// The public Xbox client used by the user's previous GreenLauncher project.
const clientId = '00000000402B5328'
const redirectUri = 'https://login.live.com/oauth20_desktop.srf'
const scope = 'XboxLive.signin XboxLive.offline_access'
type Token = { accessToken: string; refreshToken: string; expiresAt: number; minecraftAccessToken?: string; minecraftExpiresAt?: number }
type TokenCache = Record<string, Token>

export class AccountService {
  private readonly cachePath = join(app.getPath('userData'), 'auth-cache.bin')
  private readonly xbox = new MicrosoftAuthenticator()
  private readonly mojang = new MojangClient()
  private cache: TokenCache = {}

  constructor(private readonly store: LauncherStore) {
    if (existsSync(this.cachePath) && safeStorage.isEncryptionAvailable()) {
      try { this.cache = JSON.parse(safeStorage.decryptString(readFileSync(this.cachePath))) as TokenCache } catch { this.cache = {} }
    }
  }

  private persist(): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows güvenli depolama kullanılamıyor.')
    writeFileSync(this.cachePath, safeStorage.encryptString(JSON.stringify(this.cache)))
  }

  private async exchange(parameters: URLSearchParams): Promise<Token> {
    const response = await fetch('https://login.live.com/oauth20_token.srf', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: parameters
    })
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string }
    if (!response.ok || !data.access_token || !data.refresh_token) throw new Error(data.error_description || 'Microsoft oturumu tamamlanamadı.')
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 }
  }

  private authorizationCode(): Promise<{ code: string; verifier: string }> {
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomBytes(24).toString('hex')
    const url = new URL('https://login.live.com/oauth20_authorize.srf')
    for (const [key, value] of Object.entries({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(key, value)
    return new Promise((resolve, reject) => {
      let settled = false
      const window = new BrowserWindow({ width: 520, height: 740, minWidth: 420, minHeight: 560, title: 'Microsoft ile giriş yap', autoHideMenuBar: true,
        backgroundColor: '#171c1a', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:green-launcher-auth' } })
      const finish = (error?: Error, code?: string) => {
        if (settled) return
        settled = true
        if (!window.isDestroyed()) window.close()
        if (error) reject(error)
        else resolve({ code: code!, verifier })
      }
      const check = (event: Electron.Event, target: string) => {
        if (!target.startsWith(redirectUri)) return
        event.preventDefault()
        const result = new URL(target)
        if (result.searchParams.get('state') !== state) return finish(new Error('Microsoft oturum doğrulaması başarısız.'))
        const code = result.searchParams.get('code')
        finish(code ? undefined : new Error(result.searchParams.get('error_description') || 'Microsoft girişi iptal edildi.'), code || undefined)
      }
      window.webContents.on('will-redirect', check)
      window.webContents.on('will-navigate', check)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.on('closed', () => { if (!settled) { settled = true; reject(new Error('Giriş penceresi kapatıldı.')) } })
      window.loadURL(url.toString()).catch(error => finish(error))
    })
  }

  private async minecraftToken(msToken: string): Promise<{ token: string; expiresAt: number }> {
    const { minecraftXstsResponse } = await this.xbox.acquireXBoxToken(msToken)
    const uhs = minecraftXstsResponse.DisplayClaims.xui[0]?.uhs
    if (!uhs) throw new Error('Xbox hesabı doğrulanamadı.')
    const response = await this.xbox.loginMinecraftWithXBox(uhs, minecraftXstsResponse.Token)
    return { token: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 }
  }

  async signIn(): Promise<GameAccount> {
    const { code, verifier } = await this.authorizationCode()
    const token = await this.exchange(new URLSearchParams({ client_id: clientId, code, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }))
    const minecraft = await this.minecraftToken(token.accessToken)
    const ownership = await this.mojang.checkGameOwnership(minecraft.token)
    if (!ownership.items.some(item => item.name === 'game_minecraft' || item.name === 'product_minecraft')) throw new Error('Bu Microsoft hesabında Minecraft: Java Edition lisansı bulunamadı.')
    const profile = await this.mojang.getProfile(minecraft.token)
    this.store.assertAccountNameAvailable(profile.name, profile.id)
    token.minecraftAccessToken = minecraft.token
    token.minecraftExpiresAt = minecraft.expiresAt
    this.cache[profile.id] = token
    this.persist()
    return { id: profile.id, name: profile.name, homeAccountId: profile.id, skinUrl: profile.skins.find(s => s.state === 'ACTIVE')?.url, kind: 'microsoft' }
  }

  async getLaunchToken(account: GameAccount): Promise<string> {
    let token = this.cache[account.id]
    if (!token) throw new Error('Oturum süresi doldu. Microsoft hesabınıza yeniden giriş yapın.')
    try {
      if (token.minecraftAccessToken && (token.minecraftExpiresAt ?? 0) > Date.now() + 120_000) return token.minecraftAccessToken
      if (token.expiresAt < Date.now() + 120_000) {
        token = await this.exchange(new URLSearchParams({ client_id: clientId, refresh_token: token.refreshToken, grant_type: 'refresh_token', scope }))
      }
      const minecraft = await this.minecraftToken(token.accessToken)
      token.minecraftAccessToken = minecraft.token
      token.minecraftExpiresAt = minecraft.expiresAt
      this.cache[account.id] = token
      this.persist()
      return minecraft.token
    } catch (error) {
      if (token.minecraftAccessToken && (token.minecraftExpiresAt ?? 0) > Date.now() + 120_000) return token.minecraftAccessToken
      throw error
    }
  }

  async getProfileCapes(account: GameAccount): Promise<Array<{ id: string; name: string; url: string; active: boolean }>> {
    const token = await this.getLaunchToken(account)
    const profile = await this.mojang.getProfile(token)
    if (profile.id !== account.id) throw new Error('Minecraft profili eşleşmedi.')
    return (profile.capes ?? []).map(cape => ({ id: cape.id, name: cape.alias, url: cape.url, active: cape.state === 'ACTIVE' }))
  }

  async setActiveCape(account: GameAccount, capeId: string | null): Promise<void> {
    if (account.kind === 'offline') throw new Error('Pelerin değiştirmek için Microsoft hesabı gerekir.')
    const token = await this.getLaunchToken(account)
    const profile = await this.mojang.getProfile(token)
    if (profile.id !== account.id) throw new Error('Minecraft profili eşleşmedi.')
    if (capeId !== null && !profile.capes.some(cape => cape.id === capeId)) throw new Error('Bu pelerin hesabınıza ait değil.')
    // Check every status: some client versions treat a failed DELETE as success.
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
      method: capeId === null ? 'DELETE' : 'PUT',
      headers: { Authorization: `Bearer ${token}`, ...(capeId === null ? {} : { 'Content-Type': 'application/json' }) },
      body: capeId === null ? undefined : JSON.stringify({ capeId }),
      signal: AbortSignal.timeout(10000),
      redirect: 'error'
    })
    if (!response.ok) throw new Error(`Minecraft pelerini güncellenemedi (HTTP ${response.status}).`)
    if (capeId !== null) {
      const updated = await response.json() as { id?: string; capes?: Array<{ id: string; state: string }> }
      if (updated.id !== account.id || !updated.capes?.some(cape => cape.id === capeId && cape.state === 'ACTIVE')) throw new Error('Minecraft pelerini doğrulanamadı.')
    }
  }

  hasCachedLaunchToken(account: GameAccount): boolean {
    const token = this.cache[account.id]
    return !!token?.minecraftAccessToken && (token.minecraftExpiresAt ?? 0) > Date.now() + 120_000
  }

  async signOut(account: GameAccount): Promise<void> { delete this.cache[account.id]; this.persist() }
}
