import { useEffect, useRef, useState } from 'react'
import { Info, LoaderCircle } from 'lucide-react'
import type { ScreenshotItem, ScreenshotRenameResult } from '../../shared/types'
import { screenshotExtension, screenshotFilename } from '../../shared/screenshot-name'
import { diagnoseError } from '../../shared/errors'
import { translate, type Language } from './i18n'
import { AccountDialog } from './AccountControls'
import './screenshot-rename.css'

export function ScreenshotRenameDialog({ item, language, onClose, onRenamed }: {
  item: ScreenshotItem; language: Language; onClose: () => void; onRenamed: (result: ScreenshotRenameResult) => void
}) {
  const t = (source: string, values?: Record<string, string | number>) => translate(language, source, values)
  const [name, setName] = useState(item.name)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const busy = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    const frame = requestAnimationFrame(() => {
      input.current?.focus()
      const dot = item.name.lastIndexOf('.')
      input.current?.setSelectionRange(0, dot > 0 ? dot : item.name.length)
    })
    return () => { active.current = false; cancelAnimationFrame(frame) }
  }, [item.id])
  useEffect(() => { if (confirmation) confirmButton.current?.focus() }, [confirmation])
  const save = async (confirmed = false) => {
    if (busy.current) return
    setError('')
    let filename: string
    try { filename = screenshotFilename(name) }
    catch (failure) { setError(t(diagnoseError(failure).message)); input.current?.focus(); return }
    if (!confirmed && screenshotExtension(filename) !== screenshotExtension(item.name)) { setConfirmation(filename); return }
    busy.current = true; setPending(true)
    try {
      const result = await window.launcher.renameScreenshot(item.id, filename, confirmed)
      if (active.current) onRenamed(result)
    } catch (failure) { if (active.current) setError(t(diagnoseError(failure).message)) }
    finally { busy.current = false; if (active.current) setPending(false) }
  }
  return <AccountDialog title={t('Ekran görüntüsünü yeniden adlandır')} description={t('Dosyanın adını değiştir.')} closeLabel={t('Kapat')} onClose={onClose} locked={pending} className="screenshot-rename-dialog">
    <form onSubmit={event => { event.preventDefault(); if (!confirmation) void save() }}>
      <label className="screenshot-name-field">{t('Dosya adı')}<input ref={input} value={name} maxLength={240} disabled={pending || !!confirmation} required onChange={event => { setName(event.target.value); setError('') }} /></label>
      {confirmation && <section className="screenshot-extension-confirm" aria-labelledby="screenshot-extension-title">
        <div><Info size={17} /><strong id="screenshot-extension-title">{t('Dosya uzantısı değiştirilsin mi?')}</strong></div>
        <p>{t('Uzantıyı değiştirmek dosya türünü dönüştürmez. Desteklenmeyen uzantılar galeride görünmez.')}</p>
        <div className="screenshot-extension-change"><span>{screenshotExtension(item.name) || t('Uzantı yok')}</span><span aria-hidden="true">→</span><span>{screenshotExtension(confirmation) || t('Uzantı yok')}</span></div>
        <div className="modal-actions"><button className="secondary" type="button" disabled={pending} onClick={() => { setConfirmation(null); requestAnimationFrame(() => input.current?.focus()) }}>{t('Adı düzenle')}</button><button ref={confirmButton} className="modal-primary" type="button" disabled={pending} onClick={() => void save(true)}>{pending && <LoaderCircle size={16} className="spin" />}{t('Değiştir ve kaydet')}</button></div>
      </section>}
      {error && <p className="screenshot-rename-error" role="alert">{error}</p>}
      {!confirmation && <div className="modal-actions"><button className="secondary" type="button" disabled={pending} onClick={onClose}>{t('Vazgeç')}</button><button className="modal-primary" type="submit" disabled={pending || !name.trim() || name.trim() === item.name}>{pending && <LoaderCircle size={16} className="spin" />}{t('Kaydet')}</button></div>}
    </form>
  </AccountDialog>
}
