import { useEffect, useState } from 'react'
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import type { LauncherSettings } from '../../shared/types'
import { maxHeroBackgrounds, normalizeHeroSettings } from '../../shared/hero-backgrounds'
import { builtinHeroSlides } from './hero-slides'
import { translate, type Language } from './i18n'
import './hero-settings.css'

function CustomThumbnail({ id }: { id: string }) {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.launcher.readHeroBackground(id, true).then(value => { if (!cancelled) setImage(value) }).catch(() => {})
    return () => { cancelled = true }
  }, [id])
  return image ? <img src={image} alt="" draggable={false} /> : <ImagePlus size={28} aria-hidden="true" />
}

function SortableBackgroundCard({ id, name, enabled, custom, children }: { id: string; name: string; enabled: boolean; custom: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id, transition: { duration: 310, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  })
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`hero-background-card ${custom ? 'custom' : ''} ${enabled ? '' : 'disabled'} ${isDragging ? 'is-dragging' : ''}`}
    data-background-id={id} {...attributes} {...listeners} aria-label={name}>{children}</div>
}

export function HeroSettings({ settings, language, onChange, onNotice }: { settings: LauncherSettings; language: Language; onChange: (changes: Partial<LauncherSettings>) => void; onNotice: (message: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const normalized = normalizeHeroSettings(settings), custom = normalized.heroBackgrounds ?? [], disabled = normalized.disabledHeroBackgrounds ?? []
  const enabledCount = 3 - disabled.length + custom.filter(item => item.enabled).length
  const cards = normalized.heroBackgroundOrder!.map(id => {
    const slide = builtinHeroSlides.find(item => item.id === id)
    const item = custom.find(item => item.id === id)
    return { id, name: slide?.short ?? item!.name, image: slide?.image, custom: !slide, enabled: slide ? !disabled.includes(id as 'overworld' | 'nether' | 'end') : item!.enabled }
  })
  const dragEnd = ({ active, over }: DragEndEvent) => {
    setDraggedId(null)
    if (!over || active.id === over.id) return
    const order = normalized.heroBackgroundOrder!
    const from = order.indexOf(String(active.id)), to = order.indexOf(String(over.id))
    if (from >= 0 && to >= 0) onChange({ heroBackgroundOrder: arrayMove(order, from, to) })
  }
  const content = (card: typeof cards[number]) => <>
    <div className="hero-background-preview">{card.custom ? <CustomThumbnail id={card.id} /> : <img src={card.image} alt="" draggable={false} />}</div>
    <div className="hero-background-info"><strong title={card.name}>{card.name}</strong><small>{t(card.custom ? 'Özel' : 'Varsayılan')}</small></div>
    <div className="hero-background-controls" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <label className="hero-background-enabled"><input type="checkbox" checked={card.enabled} disabled={card.enabled && enabledCount <= 1} onChange={() => onChange(card.custom
        ? { heroBackgrounds: custom.map(item => item.id === card.id ? { ...item, enabled: !item.enabled } : item) }
        : { disabledHeroBackgrounds: card.enabled ? [...disabled, card.id as 'overworld' | 'nether' | 'end'] : disabled.filter(id => id !== card.id) })} />{t('Göster')}</label>
      {card.custom && <button type="button" className="hero-background-remove" aria-label={t('{name} görselini kaldır', { name: card.name })} title={t('Kaldır')} onClick={() => onChange({ heroBackgrounds: custom.filter(item => item.id !== card.id), disabledHeroBackgrounds: card.enabled && enabledCount <= 1 ? disabled.filter(id => id !== 'overworld') : disabled })}><Trash2 size={16} /></button>}
    </div>
  </>
  const add = async () => {
    if (adding) return
    setAdding(true)
    try {
      const images = await window.launcher.chooseHeroBackgrounds(maxHeroBackgrounds - custom.length)
      if (images.length) onChange({ heroBackgrounds: [...custom, ...images].slice(0, maxHeroBackgrounds) })
    } catch (error) { onNotice(t(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Arka plan görseli açılamadı.')) }
    finally { setAdding(false) }
  }
  return <section className="hero-settings" aria-labelledby="hero-settings-title">
    <div className="hero-settings-heading"><div><h4 id="hero-settings-title">{t('Ana sayfa arka planları')}</h4><p>{t('Kendi görsellerini ekle veya kullanmak istemediklerini kapat. Varsayılan görseller korunur.')}</p></div>
      <button type="button" className="heading-action primary" onClick={() => void add()} disabled={adding || custom.length >= maxHeroBackgrounds}>{adding ? <LoaderCircle size={17} className="spin" /> : <ImagePlus size={17} />}{t('Görsel ekle')}</button>
    </div>
    <button type="button" role="checkbox" aria-checked={settings.animateHero} className="setting-toggle" onClick={() => onChange({ animateHero: !settings.animateHero })}><span><strong>{t('Ana ekran geçişleri')}</strong><small>{t('Açık arka planlar arasında otomatik geçiş yap')}</small></span><span aria-hidden="true" className={`switch ${settings.animateHero ? 'on' : ''}`} /></button>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={event => setDraggedId(String(event.active.id))} onDragCancel={() => setDraggedId(null)} onDragEnd={dragEnd}>
      <SortableContext items={cards.map(card => card.id)} strategy={rectSortingStrategy}>
        <div className="hero-background-list">{cards.map(card => <SortableBackgroundCard key={card.id} {...card}>{content(card)}</SortableBackgroundCard>)}</div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 330, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>{draggedId && cards.find(card => card.id === draggedId) && <div className={`hero-background-card hero-background-overlay ${cards.find(card => card.id === draggedId)!.enabled ? '' : 'disabled'}`} inert>{content(cards.find(card => card.id === draggedId)!)}</div>}</DragOverlay>
    </DndContext>
    <p className="hero-settings-note">{t('Birden fazla görsel seçebilirsin. En fazla {count} özel görsel; PNG, JPG ve WebP desteklenir.', { count: maxHeroBackgrounds })} {t('En az bir arka plan açık kalmalı.')}</p>
  </section>
}
