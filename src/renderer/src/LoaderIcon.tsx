import type { ProfileLoader } from '../../shared/types'
import vanilla from '../assets/minecraft-release.png'
import optifine from '../assets/optifine-mark.png'
import fabric from '../assets/loaders/fabric.png'
import forge from '../assets/loaders/forge.svg'
import neoforge from '../assets/loaders/neoforge.svg'
import quilt from '../assets/loaders/quilt.svg'
import liteloader from '../assets/loaders/liteloader.svg'
import './loader-icon.css'

export const loaderIconSources: Record<ProfileLoader, string> = { none: vanilla, optifine, fabric, forge, neoforge, quilt, liteloader }
const icons = loaderIconSources
export function LoaderIcon({ loader }: { loader: ProfileLoader }) {
  return <span className="profile-loader-icon" data-loader={loader} aria-hidden="true"><img src={icons[loader]} alt="" draggable={false} /></span>
}
