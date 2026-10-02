import { useEffect, useRef, useState } from 'react'
import type { ScreenshotItem } from '../../shared/types'

const previews = new Map<string, string>()

export function ScreenshotThumbnail({ item }: { item: ScreenshotItem }) {
  const image = useRef<HTMLImageElement>(null)
  const [source, setSource] = useState(() => previews.get(`${item.id}:${item.modifiedAt}`) ?? item.thumbnail)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const element = image.current
    if (!element) return
    const key = `${item.id}:${item.modifiedAt}`
    setSource(previews.get(key) ?? item.thumbnail)
    if (previews.has(key)) return
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return
      observer.disconnect()
      timer = setTimeout(() => {
        window.launcher.getScreenshotPreview(item.id).then(full => {
          if (cancelled) return
          const decoded = new Image()
          decoded.onload = () => { if (!cancelled) { previews.set(key, full); if (previews.size > 60) previews.delete(previews.keys().next().value!); setSource(full) } }
          decoded.src = full
        }).catch(() => { /* The thumbnail remains useful if the original was moved. */ })
      }, 0)
    }, { root: document.querySelector('.main-content'), rootMargin: '150px' })
    observer.observe(element)
    return () => { cancelled = true; observer.disconnect(); if (timer) clearTimeout(timer) }
  }, [item.id, item.thumbnail, item.modifiedAt])

  return <img ref={image} src={source} alt={item.name} loading="lazy" decoding="async" />
}
