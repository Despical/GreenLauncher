import type { LauncherProfile } from '../../shared/types'
import { profileLoader } from '../../shared/profile-icons'
import { LoaderIcon } from './LoaderIcon'
import customClient from '../assets/cracked-stone-bricks.svg'

export function ProfileIcon({ profile }: { profile: LauncherProfile }) {
  const icon = profile.icon?.enabled ? profile.icon : undefined
  if (icon?.type === 'custom' && icon.image) return <img src={icon.image} alt="" draggable={false} />
  if ((!icon || icon.type === 'auto') && profile.versionId.startsWith('custom:')) return <img src={customClient} alt="" draggable={false} />
  return <LoaderIcon loader={icon && icon.type !== 'auto' && icon.type !== 'custom' ? icon.type : profileLoader(profile)} />
}
