import type { LauncherProfile } from './types'

const loaderNames = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', liteloader: 'LiteLoader' }

export const profileLaunchVersion = (profile: LauncherProfile) => profile.modLoaderVersion ?? profile.versionId
export function profileVersionLabel(profile: LauncherProfile): string {
  if (profile.modLoader) return `Minecraft ${profile.versionId} · ${loaderNames[profile.modLoader]}`
  const base = profile.versionId.split(/-OptiFine_/i)[0]
  return `Minecraft ${base}${/optifine/i.test(profile.versionId) ? ' · OptiFine' : ''}`
}
