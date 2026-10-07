import { useEffect, useState } from 'react'
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
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

export function HeroSettings({ settings, language, onChange, onNotice }: { settings: LauncherSettings; language: Language; onChange: (changes: Partial<LauncherSettings>) => void; onNotice: (message: string) => void }) {
  const [adding, setAdding] = useState(false)
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const normalized = normalizeHeroSettings(settings), custom = normalized.heroBackgrounds ?? [], disabled = normalized.disabledHeroBackgrounds ?? []
  const enabledCount = 3 - disabled.length + custom.filter(item => item.enabled).length
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
      <button type="button" className="heading-action" onClick={() => void add()} disabled={adding || custom.length >= maxHeroBackgrounds}>{adding ? <LoaderCircle size={17} className="spin" /> : <ImagePlus size={17} />}{t('Görsel ekle')}</button>
    </div>
    <button type="button" role="checkbox" aria-checked={settings.animateHero} className="setting-toggle" onClick={() => onChange({ animateHero: !settings.animateHero })}><span><strong>{t('Ana ekran geçişleri')}</strong><small>{t('Açık arka planlar arasında otomatik geçiş yap')}</small></span><span aria-hidden="true" className={`switch ${settings.animateHero ? 'on' : ''}`} /></button>
    <button type="button" role="checkbox" aria-checked={normalized.heroPanorama} className="setting-toggle" onClick={() => onChange({ heroPanorama: !normalized.heroPanorama })}><span><strong>{t('Panorama hareketi')}</strong><small>{t('Overworld panoramasında kamera yavaşça döner; diğer görseller hafifçe hareket eder.')}</small></span><span aria-hidden="true" className={`switch ${normalized.heroPanorama ? 'on' : ''}`} /></button>
    <div className="hero-background-list">
      {builtinHeroSlides.map(slide => {
        const enabled = !disabled.includes(slide.id as 'overworld' | 'nether' | 'end')
        return <div key={slide.id} className={`hero-background-card ${enabled ? '' : 'disabled'}`} data-background-id={slide.id}>
          <div className="hero-background-preview"><img src={slide.image} alt="" draggable={false} /></div>
          <div className="hero-background-info"><strong>{slide.short}</strong><small>{t('Varsayılan')}</small></div>
          <label className="hero-background-enabled"><input type="checkbox" checked={enabled} disabled={enabled && enabledCount <= 1} onChange={() => onChange({ disabledHeroBackgrounds: enabled ? [...disabled, slide.id as 'overworld' | 'nether' | 'end'] : disabled.filter(id => id !== slide.id) })} />{t('Göster')}</label>
        </div>
      })}
      {custom.map(item => <div key={item.id} className={`hero-background-card custom ${item.enabled ? '' : 'disabled'}`} data-background-id={item.id}>
        <div className="hero-background-preview"><CustomThumbnail id={item.id} /></div>
        <div className="hero-background-info"><strong title={item.name}>{item.name}</strong><small>{t('Özel')}</small></div>
        <label className="hero-background-enabled"><input type="checkbox" checked={item.enabled} disabled={item.enabled && enabledCount <= 1} onChange={() => onChange({ heroBackgrounds: custom.map(current => current.id === item.id ? { ...current, enabled: !current.enabled } : current) })} />{t('Göster')}</label>
        <div className="hero-background-custom-actions"><label title={t('2:1 oranında, 360° panorama görselleri için aç.')}><input type="checkbox" checked={item.panorama} onChange={() => onChange({ heroBackgrounds: custom.map(current => current.id === item.id ? { ...current, panorama: !current.panorama } : current) })} />{t('360° panorama')}</label>
          <button type="button" className="hero-background-remove" aria-label={t('{name} görselini kaldır', { name: item.name })} title={t('Kaldır')} onClick={() => onChange({ heroBackgrounds: custom.filter(current => current.id !== item.id), disabledHeroBackgrounds: item.enabled && enabledCount <= 1 ? disabled.filter(id => id !== 'overworld') : disabled })}><Trash2 size={15} /></button>
        </div>
      </div>)}
    </div>
    <p className="hero-settings-note">{t('Birden fazla görsel seçebilirsin. En fazla {count} özel görsel; PNG, JPG ve WebP desteklenir.', { count: maxHeroBackgrounds })} {t('En az bir arka plan açık kalmalı.')}</p>
  </section>
}
