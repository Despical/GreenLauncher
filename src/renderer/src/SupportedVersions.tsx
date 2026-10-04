import { useLayoutEffect, useRef, useState } from 'react'
import { translate, type Language } from './i18n'

export function SupportedVersions({ versions, language }: { versions?: string[]; language: Language }) {
  const text = versions?.join(', ') || translate(language, 'Bilinmiyor')
  const [expanded, setExpanded] = useState(false), [overflow, setOverflow] = useState(false)
  const content = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => { setExpanded(false) }, [text])
  useLayoutEffect(() => {
    const node = content.current
    if (!node) return
    const measure = () => { if (!expanded) setOverflow(node.scrollHeight > node.clientHeight + 1) }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(node)
    return () => observer.disconnect()
  }, [text, expanded])
  return <span className={`supported-versions${expanded ? ' expanded' : ''}`}><span ref={content} className="supported-versions-text">{text}</span>{(overflow || expanded) && <button type="button" className="supported-versions-toggle" aria-expanded={expanded} aria-label={translate(language, expanded ? 'Daha az göster' : 'Tüm sürümleri göster')} onClick={() => setExpanded(!expanded)}>{expanded ? translate(language, 'Daha az göster') : '…'}</button>}</span>
}
