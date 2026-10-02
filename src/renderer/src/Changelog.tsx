import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronRight, Search } from 'lucide-react'
import slime from '../../../build/launcher-mark.png'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import './changelog.css'
import packageJson from '../../../package.json'

interface ReleaseNotes {
  version: string
  date: string
  title: string
  intro?: string
  changes: string[]
  sections?: Array<{ title: string; changes: string[] }>
}

const v016Sections = [
  { title: 'Yeni özellikler', changes: [
    'Her profil tek bir Minecraft sürümüne bağlandı; normal profillerin sürümü profil düzenleyicisinden değiştirilebilir.',
    'Sürümler sayfasından profil seçmeden oyun başlatma eklendi.',
    'Profil bilgi menüsü, kurulu yükleyiciyi, mod paketini, modları ve indirme kaynaklarını gösterir.',
    'Desteklenen sürümlerde başlangıç sunucusu ayarlanabilir; oyun açıldığında doğrudan bu sunucuya katılır.'
  ] },
  { title: 'Düzeltmeler', changes: [
    'OptiFine ile açılışta yoğun günlük çıktısının oyunu yükleme ekranında durdurması düzeltildi.',
    'Profil kartındaki Tekrar oyna düğmesi yalnızca o profil çalışıyorsa görünür; oturum sayıları oyun menüsünde gösterilir.',
    'Bellek değerleri GB cinsinden en fazla iki ondalık basamakla gösterilir.'
  ] },
  { title: 'Arayüz ve performans', changes: [
    'Ana sayfa ve Java ayarları yenilendi; varsayılan bellek Java sekmesine taşındı.',
    'Profil seçicilerine arama eklendi; açılır düğmelerin okları açılış ve kapanışta animasyonla döner.',
    'Web sitesi ve Discord bağlantıları kendi simgeleriyle üste, Hakkında en alta taşındı.',
    'Günlükler, Hakkında, profil menüleri ve değişiklik günlüğü ortak koyu temayla düzenlendi.',
    'Son beş indirme kalıcı olarak saklanır; depolama taraması tamamlandığında bildirim gösterilir.'
  ] }
]

const v015Sections = [
  { title: 'Yeni özellikler', changes: [
    'Profil klonlama, taşınabilir paketlerle içe/dışa aktarma ve eksik dosya onarımı eklendi.',
    'Profiller için özel kapak görseli, renk ve kısa açıklama eklendi.',
    'Modlar ve mod paketleri favorilere kaydedilebilir; ekleme ve kaldırmada bildirim gösterilir.',
    'İndirmeler duraklatılabilir, sürdürülebilir ve sürüklenerek sıralanabilir. Destekleyen sunucularda kısmi indirmeler korunur.',
    'İndirme başına KB/sn hız sınırı ve oyun açıkken isteğe bağlı duraklatma eklendi.',
    'Discord etkinliği, görüntülenen sayfa ve mod kaynağına göre değişir.'
  ] },
  { title: 'Düzeltmeler', changes: [
    'Fabric kurulumu sırasında 404 hatalarında gereksiz yeniden bağlanma ve başarısız dosya indirme davranışı düzeltildi.',
    'Pelerin seçimi ve ön/arka görünüm geçişlerinde karakterin yanlış yöne dönmesi düzeltildi.',
    'Mod kurarken katalog açık kalır; birden fazla içerik indirme kuyruğuna eklenebilir.'
  ] },
  { title: 'Arayüz ve performans', changes: [
    'Dropdownların hover/seçim stilleri, arama ayırıcıları, yazı boyutları ve kenar boşlukları ortak bir standarda getirildi.',
    'Profil kartları, kapak düzenleyici, indirmeler, günlükler ve değişiklik günlüğü koyu tema ile düzenlendi.',
    'Sayfa seçimleri ve kaydırma konumları korunur; ekran görüntüsü önizlemelerinin yüklenmesi iyileştirildi.',
    'İndirme ekranına en yüksek hız, daha dengeli tahmini süre ve anlık durum bilgileri eklendi.',
    'Profil ve sistem tepsisi menüleri sadeleştirildi; kaydet düğmelerindeki onay simgeleri kaldırıldı.'
  ] }
]

const releases: ReleaseNotes[] = [
  { version: '0.17.1', date: '2026-10-02', title: 'Küçük düzeltmeler, daha düzgün bir deneyim', changes: ['Güncelleme kontrolleri için eksik yayın dosyaları tamamlandı; eksik dosya ve bağlantı hataları ayrı gösterilir.', 'Güncelleme kutusu Launcher ayarlarının en altına taşındı.', 'Dünya ve sunucu tablolarının son satır köşeleri ve başlıklarla ikon hizası düzeltildi.', 'Değişiklik günlüğünde en son sürüm, sol menüde yeşil bir rozetle gösterilir.'] },
  { version: '0.17.0', date: '2026-10-02', title: 'Bir kez kur, güncel kal', intro: 'Launcher güncellemeleri ve dünyaların yönetimi artık aynı yerde.', changes: ['Açılışta ve elle güncelleme kontrolü, ana sayfada sürüm notları ve alt barda güncelleme bildirimi eklendi.', 'Doğrulanan indirmeler, iptal, tekrar deneme ve yeniden başlatarak güncelleme eklendi; eski sürüme dönüş engellendi.', 'Dünyalar ve sunucular profillere bağlandı; sunucu listeleri oyunla karşılıklı eşitlenir.', 'Dünya ekleme, ad değiştirme, kopyalama, silme, simge sıfırlama ve seed kopyalama eklendi.', 'Dünya bilgilerinin simgeleri ve iki tablonun tam genişlikte seçim ve hover görünümü düzenlendi.'] },
  { version: '0.16.0', date: '2026-10-01', title: 'Profiline göre oyna', intro: 'Tek sürüme bağlı profiller, doğrudan sunucuya katılma ve yenilenen ayarlar. Profilini seç, dünyana devam et.', changes: v016Sections.flatMap(section => section.changes), sections: v016Sections },
  { version: '0.15.0', date: '2026-10-01', title: 'Daha fazla kontrol, daha düzenli', intro: 'Profil araçları, indirme yönetimi ve mod favorileri bir arada. Bu sürümde Discord etkinliği ve ortak menü tasarımı da yenilendi.', changes: v015Sections.flatMap(section => section.changes), sections: v015Sections },
  { version: '0.14.0', date: '2026-09-29', title: 'Daha hızlı, daha düzenli', changes: ['Açılış akışı ve sık kullanılan verilerin önbelleği iyileştirildi.', 'Oyuncu görünümleri önbellekten yüklenerek gereksiz indirmeler azaltıldı.', 'Günlükler arama, filtreler ve ayrıntı görünümüyle yeniden düzenlendi.', 'Profil bulunmayan ekran, ilk profilini oluşturmayı kolaylaştıracak şekilde yenilendi.', 'Sürüm geçmişi, kalıcı sürüm listesi ve ayrı bir okuma alanıyla yeniden tasarlandı.'] },
  { version: '0.13.1', date: '2026-09-29', title: 'Küçük dokunuşlar, daha iyi bir deneyim', changes: ['Değişiklik günlüğü sadeleştirildi ve sürüm ayrıntıları yenilendi.', 'Mod kaynakları arasında geçerken oluşan kimlik hatası düzeltildi.', 'Technic görünümü ve hata günlüklerinin kaydırma çubuğu düzenlendi.'] },
  { version: '0.13.0', date: '2026-09-29', title: 'Daha fazla kaynak, daha düzenli ayarlar', changes: ['CurseForge ve Technic katalogları ortak mod tarayıcısına eklendi.', 'Java ayarları Genel ve Kurulumlar sekmelerine ayrıldı.', 'Alt bara sürüm geçmişi ve değişiklik günlüğü eklendi.', 'Windows sağ tık menüsündeki boşluklar düzenlendi.'] },
  { version: '0.12.2', date: '2026-09-29', title: 'Hesaplar ve oyun oturumları', changes: ['Profiller ve masaüstü kısayolları hesaplara bağlandı.', 'Çalışan oyunları görüntüleme ve onayla tekrar başlatma eklendi.', 'Hesap menüleri, yazı boyutları ve bildirimler yenilendi.', 'Windows simgesi ve hızlı erişim kısayolları iyileştirildi.'] }
]

export function Changelog({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const [selectedVersion, setSelectedVersion] = useState(releases[0].version)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const shown = releases.filter(release => `v${release.version} ${release.title} ${release.changes.join(' ')}`.toLocaleLowerCase(language).includes(query.toLocaleLowerCase(language)))
  const [closing, setClosing] = useState(false)
  const selected = releases.find(release => release.version === selectedVersion) ?? releases[0]
  const content = useRef<HTMLElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.current?.focus(); search.current?.select() } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => { if (content.current) content.current.scrollTop = 0 }, [selectedVersion])

  const close = () => {
    if (closeTimer.current) return
    setClosing(true)
    closeTimer.current = setTimeout(onClose, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150)
  }

  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const buttons = Array.from(navigation.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const current = buttons.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length
      : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1
    if (next < 0) return
    event.preventDefault()
    setSelectedVersion(shown[next].version)
    buttons[next].focus({ preventScroll: true })
    buttons[next].scrollIntoView({ block: 'nearest' })
  }

  const date = (value: string, compact = false) => new Date(value + 'T12:00:00').toLocaleDateString(language, { day: 'numeric', month: compact ? 'short' : 'long', ...(!compact && { year: 'numeric' }) })

  return <AccountDialog className={`changelog-dialog ${closing ? 'changelog-closing' : ''}`} title={t('Değişiklik günlüğü')} description={t('Green Launcher sürümlerindeki yenilikler ve düzeltmeler.')} closeLabel={t('Kapat')} onClose={close} icon={<img src={slime} alt="" />}>
    <div className="release-history-layout">
      <nav className="release-history-navigation" aria-label={t('Sürümler')} ref={navigation} onKeyDown={navigate}>
        <label className="release-history-search"><Search size={17} /><input ref={search} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Geçmiş sürümlerde ara...')} aria-label={t('Geçmiş sürümlerde ara...')} /><kbd>Ctrl + F</kbd></label>
        <div className="release-history-count">{t('Toplam {count} sürüm', { count: releases.length })}</div>
        <div className="release-history-versions">{shown.map(release => <button
          type="button"
          className="release-history-version"
          key={release.version}
          aria-current={selectedVersion === release.version ? 'true' : undefined}
          aria-controls="release-history-detail"
          onClick={() => setSelectedVersion(release.version)}
        >
          <span className="release-history-version-top"><span className="release-history-version-label"><strong>v{release.version}</strong>{release.version === releases[0].version && <span className="release-latest-badge">{t('En son')}</span>}</span><time dateTime={release.date}>{date(release.date, true)}</time><ChevronRight size={14} aria-hidden="true" /></span>
          <span className="release-history-version-title">{t(release.title)}</span>
        </button>)}{!shown.length && <p className="release-history-no-results">{t('Sürüm bulunamadı.')}</p>}</div>
        <footer className="release-history-build"><strong>Green Launcher · v{packageJson.version}</strong></footer>
      </nav>
      <section className="release-history-detail" id="release-history-detail" aria-labelledby="release-history-title" tabIndex={0} ref={content}>
        <div className="release-history-article" key={selected.version}>
          <header className="release-history-heading">
            <h3 id="release-history-title">{t(selected.title)}</h3>
            <time dateTime={selected.date}><CalendarDays size={14} aria-hidden="true" />{date(selected.date)}</time>
          </header>
          <p className="release-history-intro">{t(selected.intro ?? 'Bu sürümde uygulamanın genel akışı iyileştirildi, performans arttırıldı ve kullanıcı arayüzünde önemli düzenlemeler yapıldı.')}</p>
          {(selected.sections ?? [{ title: 'Yeni özellikler', changes: selected.changes.slice(0, 2) }, { title: 'Düzeltmeler', changes: selected.changes.slice(2, 4) }, { title: 'Performans', changes: selected.changes.slice(4) }]).filter(section => section.changes.length).map(section => <section className="release-history-section" key={section.title}><h4>{t(section.title)}</h4>{section.changes.map(change => <p key={change}>{t(change)}</p>)}</section>)}
        </div>
      </section>
    </div>
  </AccountDialog>
}
