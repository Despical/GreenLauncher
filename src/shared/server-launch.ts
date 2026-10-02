export type ServerLaunchMode = 'legacy' | 'quick-play' | null

// Loader installation IDs include the base Minecraft version; snapshots use their week ID.
export function serverLaunchMode(versionId: string): ServerLaunchMode {
  const snapshot = versionId.match(/(?:^|[-_])(\d{2})w(\d{2})[a-z](?:$|[-_])/i)
  if (snapshot) {
    const week = Number(snapshot[1]) * 100 + Number(snapshot[2])
    return week >= 2314 ? 'quick-play' : week >= 1316 ? 'legacy' : null
  }
  const release = versionId.match(/(?:^|[-_])(\d+)\.(\d+)(?:\.\d+)?(?:$|[-_])/)
  if (!release) return null
  const major = Number(release[1]), minor = Number(release[2])
  if (major > 1 || major === 1 && minor >= 20) return 'quick-play'
  return major === 1 && minor >= 6 ? 'legacy' : null
}

export function normalizeServerAddress(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error('Geçerli bir sunucu adresi girin.')
  const address = value.trim()
  if (!address) return undefined
  if (address.length > 260 || /[\s/\\?#@]/.test(address)) throw new Error('Geçerli bir sunucu adresi girin.')
  const match = address.match(/^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)(?::(\d{1,5}))?$/)
  if (!match || match[1].includes('..') || match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) throw new Error('Geçerli bir sunucu adresi girin.')
  if (match[1].startsWith('[')) {
    try { new URL(`http://${address}`) } catch { throw new Error('Geçerli bir sunucu adresi girin.') }
  }
  return address
}

export function serverLaunchOptions(versionId: string, value?: string): { quickPlayMultiplayer?: string; server?: { ip: string; port?: number } } {
  const mode = serverLaunchMode(versionId)
  if (!mode || !value) return {}
  const address = normalizeServerAddress(value)
  if (!address) return {}
  if (mode === 'quick-play') return { quickPlayMultiplayer: address }
  const match = address.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/)!
  return { server: { ip: match[1].replace(/^\[|\]$/g, ''), ...(match[2] ? { port: Number(match[2]) } : {}) } }
}
