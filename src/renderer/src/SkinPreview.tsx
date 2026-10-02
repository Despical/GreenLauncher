import { useEffect, useRef, useState } from 'react'
import { Info, LoaderCircle, RotateCcw, Rotate3D } from 'lucide-react'
import type { SkinViewer } from 'skinview3d'
import type { AccountCape, GameAccount } from '../../shared/types'
import { AccountAvatar } from './AccountControls'

const portraits = new Map<string, string>()
const maxPortraitCacheBytes = 8 * 1024 * 1024

function CapePortrait({ image }: { image: string }) {
  const [portrait, setPortrait] = useState(() => portraits.get(image) ?? '')
  useEffect(() => {
    const cached = portraits.get(image)
    if (cached) { setPortrait(cached); return }
    setPortrait('')
    let cancelled = false
    const source = new Image()
    source.onload = () => {
      if (cancelled) return
      const scale = source.naturalWidth === source.naturalHeight * 2 ? source.naturalWidth / 64
        : source.naturalWidth * 17 === source.naturalHeight * 22 ? source.naturalWidth / 22
          : source.naturalWidth * 11 === source.naturalHeight * 23 ? source.naturalWidth / 46 : 0
      if (!scale) return
      const canvas = document.createElement('canvas')
      canvas.width = 10 * scale
      canvas.height = 16 * scale
      const context = canvas.getContext('2d')
      if (!context) return
      context.imageSmoothingEnabled = false
      // The outward face shown by Minecraft is the 10×16 panel at (1, 1).
      context.drawImage(source, scale, scale, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
      const value = canvas.toDataURL('image/png')
      if (image.length + value.length <= maxPortraitCacheBytes) {
        portraits.set(image, value)
        let bytes = [...portraits].reduce((total, [source, output]) => total + source.length + output.length, 0)
        while (portraits.size > 64 || bytes > maxPortraitCacheBytes) {
          const oldest = portraits.keys().next().value!
          bytes -= oldest.length + portraits.get(oldest)!.length
          portraits.delete(oldest)
        }
      }
      setPortrait(value)
    }
    source.src = image
    return () => { cancelled = true; source.onload = null }
  }, [image])
  return <span className="cape-portrait" aria-hidden="true">{portrait && <img src={portrait} alt="" draggable={false} />}</span>
}

export function SkinPreview({ account, t, onNotify, active = true, onViewChange }: { onViewChange?: (view: 'account' | 'capes') => void; active?: boolean; account: GameAccount; t: (source: string) => string; onNotify: (message: string) => void }) {
  const accountId = account.id
  const officialAccount = account.kind !== 'offline'
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const viewer = useRef<SkinViewer | null>(null)
  const turnFrame = useRef<number | null>(null)
  const cancelTurn = () => {
    if (turnFrame.current !== null) cancelAnimationFrame(turnFrame.current)
    turnFrame.current = null
  }
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [skin, setSkin] = useState<string | null>()
  const [capes, setCapes] = useState<AccountCape[]>([])
  const [capesLoading, setCapesLoading] = useState(true)
  const [capesError, setCapesError] = useState(false)
  const [selectedCapeId, setSelectedCapeId] = useState('none')
  const [autoRotate, setAutoRotate] = useState(false)
  const [backEquipment, setBackEquipment] = useState<'cape' | 'elytra'>('cape')
  const [applyingCape, setApplyingCape] = useState(false)
  const [detailsTab, setDetailsTab] = useState<'account' | 'capes'>('account')
  useEffect(() => { onViewChange?.(detailsTab) }, [detailsTab, onViewChange])
  const activeRef = useRef(active)
  activeRef.current = active
  useEffect(() => { if (viewer.current) viewer.current.renderPaused = document.hidden || !active }, [active])
  const rotation = useRef(autoRotate)
  rotation.current = autoRotate

  useEffect(() => {
    let cancelled = false
    let revision = 0
    setSkin(undefined)
    setStatus('loading')
    const unsubscribe = window.launcher.on('skinUpdated', update => {
      if (update.accountId === accountId) { revision++; setSkin(update.skin) }
    })
    window.launcher.getAccountSkin(accountId).then(value => {
      if (!cancelled && revision === 0) setSkin(value)
    }).catch(() => { if (!cancelled && revision === 0) setSkin(null) })
    return () => { cancelled = true; unsubscribe() }
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    setCapes([])
    setCapesLoading(true)
    setCapesError(false)
    window.launcher.getAccountCapes(accountId).then(items => {
      if (cancelled) return
      setCapes(items)
      const saved = localStorage.getItem(`preview-cape:${accountId}`)
      setSelectedCapeId(saved && (saved === 'none' || items.some(item => item.id === saved)) ? saved : items.find(item => item.active)?.id ?? items[0]?.id ?? 'none')
    }).catch(() => { if (!cancelled) { setCapes([]); setSelectedCapeId('none'); setCapesError(true) } }).finally(() => { if (!cancelled) setCapesLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    let preview: SkinViewer | null = null
    let observer: ResizeObserver | null = null
    const visibility = () => { if (preview) preview.renderPaused = document.hidden || !activeRef.current }
    if (skin === undefined) { setStatus('loading'); return }
    if (!skin) { setStatus('missing'); return }
    setStatus('loading')
    void (async () => {
      try {
        // Three.js is only parsed when this page actually displays a skin.
        const { SkinViewer } = await import('skinview3d')
        if (cancelled || !canvas.current || !stage.current) return
        preview = new SkinViewer({
          canvas: canvas.current,
          width: Math.round(stage.current.clientWidth),
          height: Math.round(stage.current.clientHeight),
          pixelRatio: Math.min(3, Math.max(2, window.devicePixelRatio)),
          zoom: 0.8
        })
        viewer.current = preview
        preview.controls.enableRotate = true
        preview.controls.enableZoom = true
        preview.controls.enablePan = false
        preview.controls.addEventListener('start', cancelTurn)
        preview.autoRotate = rotation.current
        preview.autoRotateSpeed = 0.45
        observer = new ResizeObserver(() => {
          if (stage.current && preview && !preview.disposed) preview.setSize(Math.round(stage.current.clientWidth), Math.round(stage.current.clientHeight))
        })
        observer.observe(stage.current)
        document.addEventListener('visibilitychange', visibility)
        visibility()
        await preview.loadSkin(skin)
        if (cancelled) return
        setStatus('ready')
      } catch {
        if (!cancelled) {
          observer?.disconnect(); preview?.dispose(); viewer.current = null
          document.removeEventListener('visibilitychange', visibility)
          setStatus('missing')
        }
      }
    })()
    return () => {
      cancelled = true
      cancelTurn()
      preview?.controls.removeEventListener('start', cancelTurn)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      preview?.dispose()
      if (viewer.current === preview) viewer.current = null
    }
  }, [skin])

  useEffect(() => { if (viewer.current) viewer.current.autoRotate = autoRotate }, [autoRotate])

  useEffect(() => {
    if (status !== 'ready' || !viewer.current) return
    const preview = viewer.current
    const cape = capes.find(item => item.id === selectedCapeId)
    if (!cape) { preview.loadCape(null); return }
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled && viewer.current === preview) preview.loadCape(image, { backEquipment })
    }
    image.src = cape.image
    return () => { cancelled = true; image.onload = null }
  }, [status, capes, selectedCapeId, backEquipment])

  const faceCape = (back: boolean) => {
    const preview = viewer.current
    if (!preview) return
    cancelTurn()
    setAutoRotate(false)
    preview.autoRotate = false
    const startAngle = preview.playerWrapper.rotation.y
    // Dragging rotates the camera independently of the model; face the current camera.
    const cameraAngle = preview.controls.getAzimuthalAngle()
    const polarAngle = preview.controls.getPolarAngle()
    const radius = preview.camera.position.distanceTo(preview.controls.target)
    const target = cameraAngle + (back ? Math.PI : 0)
    const distance = Math.atan2(Math.sin(target - startAngle), Math.cos(target - startAngle))
    const start = performance.now()
    const step = (now: number) => {
      if (preview.disposed) return
      const progress = Math.min(1, (now - start) / 360)
      const eased = 1 - Math.pow(1 - progress, 3)
      preview.playerWrapper.rotation.y = startAngle + distance * eased
      const polar = polarAngle + (Math.PI / 2 - polarAngle) * eased
      preview.camera.position.set(radius * Math.sin(polar) * Math.sin(cameraAngle), radius * Math.cos(polar), radius * Math.sin(polar) * Math.cos(cameraAngle)).add(preview.controls.target)
      preview.controls.update()
      if (progress === 1) preview.playerWrapper.rotation.y = target
      turnFrame.current = progress < 1 ? requestAnimationFrame(step) : null
    }
    turnFrame.current = requestAnimationFrame(step)
  }

  const chooseCape = (id: string) => {
    setSelectedCapeId(id)
    localStorage.setItem(`preview-cape:${accountId}`, id)
    faceCape(id !== 'none')
  }

  const activeCapeId = capes.find(cape => cape.source === 'minecraft' && cape.active)?.id ?? 'none'
  const selectedCape = capes.find(cape => cape.id === selectedCapeId)
  const canApply = officialAccount && (selectedCapeId === 'none' || selectedCape?.source === 'minecraft') && selectedCapeId !== activeCapeId && !applyingCape && !capesLoading && !capesError
  const applyCape = async () => {
    if (!canApply) return
    setApplyingCape(true)
    try {
      const updated = await window.launcher.setAccountCape(accountId, selectedCapeId)
      setCapes(updated)
      onNotify(t('Pelerin Minecraft hesabında güncellendi.'))
    } catch (error) {
      onNotify(error instanceof Error ? error.message : t('Pelerin güncellenemedi.'))
    } finally { setApplyingCape(false) }
  }

  return <div className="account-page-layout">
    <div className="account-page-skin-column"><div className="skin-preview">
    <div className="skin-preview-stage">
      <div className="skin-preview-grid" />
      <div className="skin-preview-viewport" ref={stage}><canvas ref={canvas} aria-label={t('Döndürülebilir Minecraft skini')} /></div>
      {detailsTab === 'capes' && selectedCapeId !== 'none' && <div className="cape-preview-toolbar"><div className="cape-view-switch" role="group" aria-label={t('Görünüm türü')}><button type="button" className={backEquipment === 'cape' ? 'active' : ''} aria-pressed={backEquipment === 'cape'} onClick={() => { setBackEquipment('cape'); faceCape(true) }}>{t('Pelerin görünümü')}</button><button type="button" className={backEquipment === 'elytra' ? 'active' : ''} aria-pressed={backEquipment === 'elytra'} onClick={() => { setBackEquipment('elytra'); faceCape(true) }}>{t('Elytra görünümü')}</button></div></div>}
      {status !== 'ready' && <div className="skin-preview-status">{status === 'loading' ? <><LoaderCircle className="spin" size={22} /> {t('Skin yükleniyor...')}</> : t('Skin şu anda gösterilemiyor.')}</div>}
      {status === 'ready' && <div className="skin-preview-hint"><Rotate3D size={15} /> {t('Sürükleyerek döndür · Kaydırarak yakınlaştır')}</div>}
    </div>
    <div className="skin-preview-actions">
      <button disabled={status !== 'ready'} onClick={() => { const preview = viewer.current; if (preview) faceCape(Math.cos(preview.playerWrapper.rotation.y - preview.controls.getAzimuthalAngle()) >= 0) }}><RotateCcw size={16} /> {t('Ön / arka görünüm')}</button>
      <button className={autoRotate ? 'active' : ''} disabled={status !== 'ready'} aria-pressed={autoRotate} onClick={() => { cancelTurn(); setAutoRotate(value => !value) }}><Rotate3D size={16} /> {t('Otomatik döndür')}</button>
    </div>
    {detailsTab === 'capes' && officialAccount && !capesLoading && !capesError && <div className="cape-apply-row"><button type="button" className="cape-apply-button heading-action primary" disabled={!canApply} onClick={() => void applyCape()}>{applyingCape ? <><LoaderCircle className="spin" size={16} />{t('Uygulanıyor...')}</> : selectedCape?.source === 'optifine' ? t('Yalnızca önizleme') : selectedCapeId === activeCapeId ? t('Hesabında etkin') : t('Minecraft hesabımda kullan')}</button></div>}
    </div><div className="account-page-note"><Info size={17} /><span>{officialAccount ? t('Skinin Minecraft hesabından alınır. Buradaki görünüm oyun içindeki karakterindir.') : t('Çevrimdışı hesap ile çevrimiçi sunucu oturumlarına katılamazsın.')}</span></div></div>
    <div className="account-page-details">
      <div className="account-details-tabs" role="tablist" aria-label={t('Profil bölümleri')} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'account' : event.key === 'End' ? 'capes' : detailsTab === 'account' ? 'capes' : 'account'
        setDetailsTab(next)
        requestAnimationFrame(() => document.getElementById(next === 'account' ? 'account-tab' : 'capes-tab')?.focus())
      }}>
        <button type="button" role="tab" id="account-tab" aria-controls="account-panel" aria-selected={detailsTab === 'account'} tabIndex={detailsTab === 'account' ? 0 : -1} className={detailsTab === 'account' ? 'active' : ''} onClick={() => setDetailsTab('account')}>{t('Hesabım')}</button>
        <button type="button" role="tab" id="capes-tab" aria-controls="capes-panel" aria-selected={detailsTab === 'capes'} tabIndex={detailsTab === 'capes' ? 0 : -1} className={detailsTab === 'capes' ? 'active' : ''} onClick={() => setDetailsTab('capes')}>{t('Pelerinlerim')}</button>
      </div>
      {detailsTab === 'account' ? <div role="tabpanel" id="account-panel" aria-labelledby="account-tab" className="account-details-panel">
        <div className="account-section-heading"><h3>{t('Hesabım')}</h3><p>{t('Minecraft hesabının bilgilerini ve karakter görünümünü incele.')}</p></div>
        <div className="account-page-identity"><AccountAvatar account={account} className="account-page-avatar" /><div><h3>{account.name}</h3><p>{officialAccount ? t('Microsoft hesabı bağlı') : t('Çevrimdışı hesap')}</p></div></div>
        <div className="account-page-divider" />
        <div className="account-page-field"><span>{t('Oyuncu adı')}</span><strong>{account.name}</strong></div>
        <div className="account-page-field"><span>{t('Minecraft kimliği')}</span><code>{account.id}</code></div>
        {officialAccount && <div className="account-page-field"><span>{t('Karakter görünümü')}</span><strong>{account.skinUrl ? t('Hesabınla eşitleniyor') : t('Skin bilgisi bulunamadı')}</strong></div>}
      </div> : <div role="tabpanel" id="capes-panel" aria-labelledby="capes-tab" className="skin-capes">
      <div className="account-section-heading"><div className="skin-capes-heading"><h3>{t('Pelerinler')}</h3><span>{capesLoading ? t('Yükleniyor...') : `${capes.length} ${t('pelerin')}`}</span></div>
      <p>{t('Bir pelerin seçerek karakterinin üzerinde önizle.')}</p></div>
      {!capesLoading && !capesError && <div className="skin-capes-grid" role="group" aria-label={t('Önizleme pelerini')}>
        <button type="button" className={`cape-card ${selectedCapeId === 'none' ? 'selected' : ''}`} aria-pressed={selectedCapeId === 'none'} onClick={() => chooseCape('none')}><span className="cape-card-art"><span className="cape-none" /></span><span className="cape-card-label"><span className="cape-radio" /><strong>{t('Pelerinsiz')}</strong>{activeCapeId === 'none' && officialAccount && <small>{t('Etkin')}</small>}</span></button>
        {capes.map(cape => <button type="button" key={cape.id} className={`cape-card ${selectedCapeId === cape.id ? 'selected' : ''}`} aria-pressed={selectedCapeId === cape.id} onClick={() => chooseCape(cape.id)}><span className="cape-card-art"><CapePortrait image={cape.image} /></span><span className="cape-card-label"><span className="cape-radio" /><strong>{cape.name}</strong>{cape.active && <small>{t('Etkin')}</small>}</span></button>)}
      </div>}
      {(capesLoading || capesError) && <p className="skin-capes-empty">{capesLoading ? t('Pelerinler aranıyor...') : t('Pelerinler şu anda alınamadı.')}</p>}
      {!capesLoading && !capesError && !capes.length && !officialAccount && <p className="skin-capes-empty">{t('Bu oyuncu için pelerin bulunamadı.')}</p>}
      {!officialAccount && capes.length > 0 && <p className="skin-capes-note">{t('Çevrimdışı hesapta pelerin yalnızca önizlenebilir.')}</p>}
    </div>}
    </div>
  </div>
}
