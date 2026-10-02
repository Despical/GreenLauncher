export type ErrorDiagnosis = { message: string; code: string }

export function diagnoseError(error: unknown): ErrorDiagnosis {
  const raw = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
  if (/Diskteki boş alan kontrol edilemedi/.test(raw) || (error as { code?: string })?.code === 'DISK_SPACE_CHECK_FAILED') return {
    message: 'Diskteki boş alan kontrol edilemedi. Yeniden dene.', code: 'DISK_SPACE_CHECK_FAILED'
  }
  if (/ENOSPC|INSUFFICIENT_DISK_SPACE|Diskte yeterli boş alan yok/i.test(raw) || ['ENOSPC', 'INSUFFICIENT_DISK_SPACE'].includes(String((error as { code?: string })?.code ?? ''))) return {
    message: 'Diskte yeterli boş alan yok. Yer açıp yeniden dene.', code: 'INSUFFICIENT_DISK_SPACE'
  }
  const downloadHttp = /^Dosya indirilemedi \((\d{3})\)/.exec(raw)
  if (downloadHttp) return { message: raw.slice(0, 600), code: `DOWNLOAD_HTTP_${downloadHttp[1]}` }
  if (/429|too many requests|rate.?limit/i.test(raw)) return {
    message: 'Microsoft ve Xbox oturum servisi çok fazla deneme nedeniyle geçici olarak sınır koydu. Birkaç dakika bekleyip yeniden dene.',
    code: 'XBOX_429'
  }
  if (/ERR_(?:FAILED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|TIMED_OUT|CONNECTION|NETWORK)|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(raw)) return {
    message: /login\.live\.com|Microsoft|oauth/i.test(raw)
      ? 'Microsoft giriş sayfasına ulaşılamadı. Bağlantını kontrol edip yeniden dene.'
      : 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol edip yeniden dene.',
    code: raw.match(/ERR_[A-Z_]+/i)?.[0].toUpperCase() ?? 'NETWORK_ERROR'
  }
  if (/failed to login minecraft with xbox|login_with_xbox|xsts/i.test(raw)) return {
    message: 'Xbox oturumu doğrulanamadı. Biraz sonra yeniden dene; sorun sürerse Microsoft hesabını tekrar bağla.',
    code: 'XBOX_LOGIN'
  }
  if (/401|unauthorized|invalid_grant/i.test(raw)) return {
    message: 'Microsoft oturumunun süresi dolmuş olabilir. Hesaptan çıkıp tekrar giriş yap.',
    code: 'AUTH_EXPIRED'
  }
  if (/Başka bir oyun veya indirme işlemi devam ediyor/i.test(raw)) return {
    message: 'Oyun zaten çalışıyor veya hazırlanıyor. İkinci kez başlatılmadı.',
    code: 'LAUNCH_BUSY'
  }
  if (/Giriş penceresi kapatıldı|girişi iptal edildi/i.test(raw)) return {
    message: 'Microsoft girişi tamamlanmadı. Hazır olduğunda tekrar deneyebilirsin.',
    code: 'AUTH_CANCELLED'
  }
  if (raw.length <= 180 && !/https?:\/\/|\{|\}|\[object|Error:/i.test(raw)) return { message: raw, code: 'LAUNCHER_ERROR' }
  return { message: 'İşlem tamamlanamadı. Ayrıntılar için Ayarlar > Günlükler bölümüne bak.', code: 'UNEXPECTED_ERROR' }
}
