export type ShortcutRequest = { profileId?: string; versionId?: string; accountId?: string }
const profilePattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const accountPattern = /^[0-9a-f]{32}$/i
const versionPattern = /^[a-zA-Z0-9._-]{1,90}$/

export function parseShortcut(args: string[]): ShortcutRequest | null {
  const value = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  const profileId = value('launch-profile'), versionId = value('launch-version'), accountId = value('launch-account')
  if ((!profileId && !versionId) || (profileId && !profilePattern.test(profileId)) || (versionId && !versionPattern.test(versionId)) || (accountId && !accountPattern.test(accountId))) return null
  return { profileId, versionId, accountId }
}

export function shortcutArguments(accountId: string, profileId: string | null, versionId?: string): string {
  if (!accountPattern.test(accountId) || (profileId !== null && !profilePattern.test(profileId)) || (!profileId && !versionId) || (versionId && !versionPattern.test(versionId))) throw new Error('Geçersiz kısayol bilgisi.')
  return `--launch-account=${accountId}${profileId ? ` --launch-profile=${profileId}` : ''}${versionId ? ` --launch-version=${versionId}` : ''}`
}
