import { useState } from 'react'
import { ExternalLink, KeyRound, LoaderCircle } from 'lucide-react'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import './curseforge-connection.css'

export function CurseForgeConnection({ language, onClose, onConnected }: { language: Language; onClose: () => void; onConnected: () => void }) {
  const t = (source: string) => translate(language, source)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connect = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || key.trim().length < 20) return
    setBusy(true)
    setError('')
    try {
      await window.launcher.connectCurseForge(key.trim())
      setKey('')
      onConnected()
    } catch {
      // Never echo the submitted credential or a provider response into the UI.
      setError(t('Bağlantı doğrulanamadı. Anahtarı ve internet bağlantını kontrol et.'))
    } finally { setBusy(false) }
  }
  return <AccountDialog className="provider-connect-dialog" title={t('CurseForge bağlantısı')} description={t('Uygulamaya ait API anahtarını gir. Windows üzerinde şifrelenerek saklanır.')} closeLabel={t('Kapat')} onClose={onClose} locked={busy} icon={<KeyRound size={22} />}>
    <form className="curseforge-connect-form" onSubmit={connect}>
      <label className="provider-key-label">{t('API anahtarı')}<input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={512} disabled={busy} onChange={event => { setKey(event.target.value); setError('') }} /></label>
      <p className="curseforge-connect-note">{t('Minecraft launcher anahtarları CurseForge başvurusu onaylandıktan sonra verilir.')}</p>
      {error && <p className="provider-connect-error" role="alert">{error}</p>}
      <div className="curseforge-connect-actions"><button type="button" disabled={busy} onClick={() => window.launcher.openExternal('https://support.curseforge.com/support/solutions/articles/9000208346').catch(() => setError(t('Bağlantı açılamadı.')))}><ExternalLink size={15} />{t('API başvurusu')}</button><button type="submit" className="primary" disabled={busy || key.trim().length < 20}>{busy && <LoaderCircle className="spin" size={16} />}{t('Bağlan')}</button></div>
    </form>
  </AccountDialog>
}
