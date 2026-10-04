import type { LauncherProfile, ProfileIconConfig, ProfileLoader } from './types'

export const profileIconLoaders: ProfileLoader[] = ['none', 'fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'optifine']
export const profileLoader = (profile: LauncherProfile): ProfileLoader => profile.modLoader ?? (/optifine/i.test(profile.versionId) ? 'optifine' : 'none')

export function normalizeProfileIcon(value: unknown): ProfileIconConfig {
  if (!value || typeof value !== 'object') throw new Error('Profil ikonu geçersiz.')
  const icon = value as ProfileIconConfig
  if (!['auto', 'custom', ...profileIconLoaders].includes(icon.type)) throw new Error('Profil ikonu geçersiz.')
  if (icon.image !== undefined && (typeof icon.image !== 'string' || icon.image.length > 100000 || !/^data:image\/png;base64,iVBORw0KGgo[a-zA-Z0-9+/=]+$/.test(icon.image))) throw new Error('Profil ikonu geçersiz veya çok büyük.')
  if (icon.enabled === true && icon.type === 'custom' && !icon.image) throw new Error('Önce bir ikon görseli seçin.')
  return { enabled: icon.enabled === true, type: icon.type, ...(icon.image && { image: icon.image }) }
}
