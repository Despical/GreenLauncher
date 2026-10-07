import overworldImage from '../assets/green-landscape.png'
import overworldPanorama from '../assets/overworld-panorama.png'
import netherImage from '../assets/nether-landscape.png'
import endImage from '../assets/end-landscape.png'
import type { LauncherSettings } from '../../shared/types'
import { normalizeHeroSettings } from '../../shared/hero-backgrounds'

export interface HeroSlide { id: string; label: string; short: string; image: string; panoramaImage?: string; custom?: boolean; panorama?: boolean; titleA: string; titleB: string; description: string }
export const builtinHeroSlides: HeroSlide[] = [
  { id: 'overworld', label: '01 / THE OVERWORLD', short: 'Overworld', image: overworldImage, panoramaImage: overworldPanorama, titleA: 'Yeni bir dünya', titleB: 'seni bekliyor.', description: 'Macerana kaldığın yerden devam et. Profilini seç ve oynamaya başla.' },
  { id: 'nether', label: '02 / THE NETHER', short: 'Nether', image: netherImage, titleA: 'Ateşin ötesine', titleB: 'yolculuk et.', description: 'Bilinmeyene açılan kapı burada. Hazırsan macerana devam et.' },
  { id: 'end', label: '03 / THE END', short: 'End', image: endImage, titleA: 'Sonun ötesinde', titleB: 'yeni bir başlangıç.', description: 'Her keşif başka bir hikâye. Kendi yolunu seç ve dünyana dön.' }
]
export function enabledHeroSlides(settings: Partial<LauncherSettings>): HeroSlide[] {
  const normalized = normalizeHeroSettings(settings)
  return [...builtinHeroSlides.filter(slide => !normalized.disabledHeroBackgrounds?.includes(slide.id as 'overworld' | 'nether' | 'end')),
    ...(normalized.heroBackgrounds ?? []).filter(item => item.enabled).map(item => ({ ...builtinHeroSlides[0], id: item.id, label: item.name, short: item.name, image: '', panoramaImage: undefined, custom: true, panorama: item.panorama }))]
}
