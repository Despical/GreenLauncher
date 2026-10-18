import type { LauncherProfile } from '../../shared/types'
import { profileLoader } from '../../shared/profile-icons'
import { LoaderIcon } from './LoaderIcon'
import { ClientIcon, useCustomClient } from './ClientIcons'

export function ProfileIcon({ profile }: { profile: LauncherProfile }) {
  const client = useCustomClient(profile.versionId)
  const icon = profile.icon?.enabled ? profile.icon : undefined
  if (icon?.type === 'custom' && icon.image) return <img src={icon.image} alt="" draggable={false} />
  if ((!icon || icon.type === 'auto') && (client || profile.versionId.startsWith('custom:'))) return <ClientIcon versionId={profile.versionId} />
  return <LoaderIcon loader={icon && icon.type !== 'auto' && icon.type !== 'custom' ? icon.type : profileLoader(profile)} />
}
