import overworldImage from '../assets/castle-cubemap/poster.png'
import cubeRight from '../assets/castle-cubemap/right.png'
import cubeLeft from '../assets/castle-cubemap/left.png'
import cubeUp from '../assets/castle-cubemap/up.png'
import cubeDown from '../assets/castle-cubemap/down.png'
import cubeFront from '../assets/castle-cubemap/front.png'
import cubeBack from '../assets/castle-cubemap/back.png'
import netherImage from '../assets/nether-landscape.png'
import endImage from '../assets/end-landscape.png'
import type { LauncherSettings } from '../../shared/types'
import { normalizeHeroSettings } from '../../shared/hero-backgrounds'

export type PanoramaCube = [string, string, string, string, string, string]
export interface HeroSlide { id: string; label: string; short: string; image: string; panoramaImage?: string; panoramaCube?: PanoramaCube; panoramaYaw?: number; custom?: boolean; panorama?: boolean; titleA: string; titleB: string; description: string }
export const builtinHeroSlides: HeroSlide[] = [
  { id: 'overworld', label: '01 / THE OVERWORLD', short: 'Overworld', image: overworldImage, panoramaCube: [cubeRight, cubeLeft, cubeUp, cubeDown, cubeFront, cubeBack], panoramaYaw: 0.12, titleA: 'Yeni bir dünya', titleB: 'seni bekliyor.', description: 'Macerana kaldığın yerden devam et. Profilini seç ve oynamaya başla.' },
  { id: 'nether', label: '02 / THE NETHER', short: 'Nether', image: netherImage, titleA: 'Ateşin ötesine', titleB: 'yolculuk et.', description: 'Bilinmeyene açılan kapı burada. Hazırsan macerana devam et.' },
  { id: 'end', label: '03 / THE END', short: 'End', image: endImage, titleA: 'Sonun ötesinde', titleB: 'yeni bir başlangıç.', description: 'Her keşif başka bir hikâye. Kendi yolunu seç ve dünyana dön.' }
]
export function enabledHeroSlides(settings: Partial<LauncherSettings>): HeroSlide[] {
  const normalized = normalizeHeroSettings(settings)
  return [...builtinHeroSlides.filter(slide => !normalized.disabledHeroBackgrounds?.includes(slide.id as 'overworld' | 'nether' | 'end')),
    ...(normalized.heroBackgrounds ?? []).filter(item => item.enabled).map(item => ({ ...builtinHeroSlides[0], id: item.id, label: item.name, short: item.name, image: '', panoramaImage: undefined, panoramaCube: undefined, panoramaYaw: undefined, custom: true, panorama: item.panorama }))]
}
