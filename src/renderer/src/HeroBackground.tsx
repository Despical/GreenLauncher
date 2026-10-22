import { useEffect, useState } from 'react'
import type { HeroSlide } from './hero-slides'

export function HeroBackground({ slide, active }: { slide: HeroSlide; active: boolean }) {
  const [customImage, setCustomImage] = useState<string | null>(null)
  useEffect(() => {
    if (!active) { setCustomImage(null); return }
    if (!slide.custom) return
    let cancelled = false
    setCustomImage(null)
    void window.launcher.readHeroBackground(slide.id).then(image => { if (!cancelled) setCustomImage(image) }).catch(() => {})
    return () => { cancelled = true }
  }, [slide.id, slide.custom, active])
  const image = active ? slide.custom ? customImage : slide.image : null
  return <div className={`hero-image ${active ? 'active' : ''}`} data-background-id={slide.id} style={{ backgroundImage: image ? `url("${image}")` : undefined }} />
}
