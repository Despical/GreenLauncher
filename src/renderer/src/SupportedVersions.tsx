import { useLayoutEffect, useRef, useState } from 'react'
import { translate, type Language } from './i18n'

export function SupportedVersions({ versions, language }: { versions?: string[]; language: Language }) {
  const text = versions?.join(', ') || translate(language, 'Bilinmiyor')
  const [expanded, setExpanded] = useState(false), [preview, setPreview] = useState(text)
  const container = useRef<HTMLSpanElement>(null), measure = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => { setExpanded(false) }, [text])
  useLayoutEffect(() => {
    const node = measure.current, parent = container.current
    if (!node || !parent) return
    const fit = () => {
      if (!parent.clientWidth) return
      const height = parseFloat(getComputedStyle(node).lineHeight) * 2 + 1
      node.textContent = text
      if (node.getBoundingClientRect().height <= height) { setPreview(text); return }
      const labels = text.split(', ')
      let low = 0, high = labels.length - 1
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        node.textContent = labels.slice(0, middle).join(', ') + ', ...'
        if (node.getBoundingClientRect().height <= height) low = middle
        else high = middle - 1
      }
      setPreview(labels.slice(0, low).join(', '))
    }
    fit()
    const observer = new ResizeObserver(fit); observer.observe(parent)
    return () => observer.disconnect()
  }, [text])
  const overflow = preview !== text
  return <span ref={container} className={`supported-versions${expanded ? ' expanded' : ''}`}><span ref={measure} className="supported-versions-measure" aria-hidden="true" /><span className="supported-versions-text">{expanded ? text : preview}</span>{(overflow || expanded) && <>{!expanded && preview && ', '}<button type="button" className="supported-versions-toggle" aria-expanded={expanded} aria-label={translate(language, expanded ? 'Daha az göster' : 'Tüm sürümleri göster')} onClick={() => setExpanded(!expanded)}>{expanded ? translate(language, 'Daha az göster') : '...'}</button></>}</span>
}
