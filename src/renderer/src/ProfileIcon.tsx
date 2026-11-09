import type { GameVersion, LauncherProfile } from '../../shared/types'
import { profileLoader } from '../../shared/profile-icons'
import { LoaderIcon, loaderIconSources } from './LoaderIcon'
import { ClientIcon, useCustomClient } from './ClientIcons'
import clientFallback from '../assets/cracked-stone-bricks.svg'

export function ProfileIcon({ profile }: { profile: LauncherProfile }) {
  const client = useCustomClient(profile.versionId)
  const icon = profile.icon?.enabled ? profile.icon : undefined
  if (icon?.type === 'custom' && icon.image) return <img src={icon.image} alt="" draggable={false} />
  if ((!icon || icon.type === 'auto') && (client || profile.versionId.startsWith('custom:'))) return <ClientIcon versionId={profile.versionId} />
  return <LoaderIcon loader={icon && icon.type !== 'auto' && icon.type !== 'custom' ? icon.type : profileLoader(profile)} />
}

/** Image source of the icon ProfileIcon shows for a profile. */
export function profileIconSource(profile: LauncherProfile, versions: GameVersion[]): string {
  const icon = profile.icon?.enabled ? profile.icon : undefined
  if (icon?.type === 'custom' && icon.image) return icon.image
  const client = versions.find(version => version.custom && version.id === profile.versionId)
  if ((!icon || icon.type === 'auto') && (client || profile.versionId.startsWith('custom:'))) return client?.icon ?? clientFallback
  return loaderIconSources[icon && icon.type !== 'auto' && icon.type !== 'custom' ? icon.type : profileLoader(profile)]
}

/** Draws an icon source onto a square 256px PNG for Windows shortcut icons. */
export async function profileIconPng(source: string): Promise<string | undefined> {
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = source
    await image.decode()
    const size = 256, width = image.naturalWidth || size, height = image.naturalHeight || size
    const scale = Math.min(size / width, size / height), canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) return undefined
    // Keep pixel-art icons crisp when they are enlarged.
    context.imageSmoothingEnabled = Math.max(width, height) >= 64
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale)
    return canvas.toDataURL('image/png')
  } catch { return undefined }
}
