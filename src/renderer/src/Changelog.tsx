import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, CalendarDays, ChevronRight, RefreshCw, Search } from 'lucide-react'
import slime from '../../../build/launcher-mark.png'
import { AccountDialog } from './AccountControls'
import { translate, type Language } from './i18n'
import './changelog.css'
import packageJson from '../../../package.json'
import type { LauncherUpdate } from '../../shared/types'
import { releaseNotesBlocks } from '../../shared/release-notes'

interface ReleaseNotes {
  version: string
  date: string
  title: string
  intro?: string
  remoteNotes?: string
  changes: string[]
  sections?: Array<{ title: string; changes: string[] }>
}

const v0177Changes = [
  "Taşınabilir güncellemelerde yalnızca değişen parçalar indirilir ve yeni EXE doğrulanarak oluşturulur; gerektiğinde tam indirmeye dönülür. Bu sisteme geçiş sürümü bir kez tam indirilir.",
  "Başarılı açılıştan sonra eski launcher çalışma klasörleri ve kullanılmış güncelleme dosyaları temizlenir; çalışan sürümler ve kullanıcı verileri korunur.",
  "İndirmeden önce hedef diskteki boş alan kontrol edilir; eşzamanlı indirmeler, geçici dosyalar ve güncellemenin açılması hesaba katılır. Yetersiz alanda bildirim gösterilir ve sorun günlüğe kaydedilir.",
  "Dünya tablosunda son oynanma ve boyut başlıkları ile değerleri ortalandı; sağ paneldeki dört yönetim düğmesinin içeriği ortalanırken ikonlar aynı hizada tutuldu.",
  "Modrinth kataloğu ve favoriler aynı güncel proje bilgilerini kullanır. Katalog ve açıklamalar kısa süreli önbellekle yaklaşık iki dakikada bir yenilenir; çevrimdışıyken kayıtlı bilgiler korunur."
]

const v0176Changes = [
  'Güncelleme kartı Hakkında sekmesine taşındı; Hakkında, güncelleme kartı ve değişiklik günlüğü için alanlarına uygun ayrı manzaralar hazırlandı.',
  'Değişiklik günlüğündeki sürüm bağlantısından animasyonlu kontrol ve sonuç bildirimi yapılır; yeni sürüme tıklayınca indirme başlar ve İndirmeler açılır.',
  'Tamamlanan launcher güncellemeleri kuyruktan Son indirmelere taşınır; indirme kartında hız, en yüksek hız, kalan süre ve kaliteli launcher simgesi gösterilir.',
  'Dünya tablosu ve sağ panelin yazı tipleri, renkleri ve sütunları sunucularla eşleştirildi; yönetim butonlarının ikonları yazılara yaklaştırıldı.',
  'Sunucu ve dünya ikonlarına hafif sol boşluk eklendi; tablo ayırıcıları ve son satırın yuvarlak köşeleri korundu.'
]

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
  { version: '0.18.2', date: '2026-10-08', title: 'Ana sayfanı kişiselleştir', intro: 'Özel arka planlar, animasyonlu sıralama ve daha düzenli ayarlar.', changes: [
    'Ana sayfaya en fazla 12 özel PNG, JPG veya WebP görseli ekleyebilir, varsayılan ve özel arka planların görünürlüğünü ayrı ayrı değiştirebilirsin.',
    'Arka plan kartları fareyle veya klavyeyle animasyonlu sıralanabilir; kaydedilen sıra ana sayfada ve arka plan menüsünde korunur.',
    'Ana sayfa sabit arka plan görselleri kullanır; açık görseller arasında otomatik geçiş isteğe bağlı olarak açılıp kapatılabilir.',
    'Arka plan ayarlarının ayırıcıları, kart kenarlıkları, yazı boyutları ve yeşil görsel ekleme düğmesi düzenlendi; kaldırma düğmesi kartın üzerine gelince veya klavyeyle odaklanınca Göster seçeneğinin sağında görünür.',
    'Ana sayfa ve arka plan menüsü yalnızca açık görselleri aynı sırayla numaralandırır; kapalı görseller artık numaralarda boşluk oluşturmaz.',
    'Profil paketi bırakma alanı Profillerim sayfasının tamamında çalışır; dışa aktarma tamamlandığında veya başarısız olduğunda etkinlik durumu temizlenir.'
  ] },
  { version: '0.18.1', date: '2026-10-07', title: 'Daha kompakt profiller', intro: 'Profil ikonları, sade seçimler ve daha uygun oyun pencereleri.', changes: [
    'Profillerim sayfası, profil ikonlarının ve altında adlarının göründüğü kompakt kartlarla yenilendi; RAM ve pencere boyutu bilgileri kaldırıldı.',
    'Profil kartları tek tıkla profil yönetimini açar; üç nokta menüsü ilgili kartın üzerine gelince veya klavyeyle odaklanınca görünür.',
    'Profil sabitleme ve menüdeki Kapağı düzenle seçeneği kaldırıldı; profiller sürükleyerek sıralanabilir.',
    'Ana sayfadaki profil seçicide ve açılır listesinde yalnızca profil ikonu ve adı gösterilir.',
    'Profil paketi bırakma alanı tüm uygulamayı kapsar; arka plan karartılır ve hafif bulanıklaştırılır.',
    'Varsayılan oyun penceresi normal boyutta açılır; ekranı dolduran eski pencere boyutları masaüstüne sığdırılır. Tam ekran tercihi ve kaydedilen özel boyutlar korunur.'
  ] },
  { version: '0.18.0', date: '2026-10-05', title: 'Profilinde daha fazla kontrol', intro: 'Profil çalışma alanı, canlı günlükler ve daha düzenli içerik yönetimi.', changes: [
    'Profil çalışma alanında Minecraft sürümü, mod yükleyicisi, başlatma ayarları ve profil simgesi yönetilebilir.',
    'Modlar, kaynak paketleri ve shader paketleri profil içinde yönetilir; kartın tamamına tıklayarak ayrıntıları seçebilirsin.',
    'Canlı Minecraft günlüğü ile arşiv kayıtlarında arama, kopyalama ve yükleme eklendi; kayıt yenilemesi tamamlanınca bildirim gösterilir.',
    'Boş günlük konsolunun rengi ve düğme durumları düzeltildi; kopyalama sırasında imleç artık bloke işareti göstermez.',
    'Sunucu ve dünya resimleriyle adları arasındaki boşluk artırıldı; başlıklar hizalandı ve paket uyumluluk uyarısı kırmızı gösterilir.',
    'Uzun Minecraft sürüm listeleri metnin yanındaki üç noktadan açılır; profil menüsündeki sayfalar yeniden sıralandı.',
    'Oyunun kaydettiği tam ekran ayarı, profilin başlangıç tercihine göre uygulanır; diğer oyun ayarları korunur.'
  ] },
  { version: '0.17.7', date: '2026-10-03', title: 'Daha küçük güncellemeler, güncel katalog', intro: 'Değişen parçaları indiren güncellemeler, otomatik dosya temizliği ve indirme öncesi disk kontrolü.', changes: v0177Changes, sections: [
    { title: 'Yeni özellikler', changes: v0177Changes.slice(0, 3) },
    { title: 'Düzeltmeler', changes: v0177Changes.slice(3) }
  ] },
  { version: '0.17.6', date: '2026-10-02', title: 'Kartlar ve güncellemeler yenilendi', intro: 'Kısa kartlara uygun yeni manzaralar, daha düzenli dünya bilgileri ve kolay güncelleme takibi.', changes: v0176Changes, sections: [
    { title: 'Yeni özellikler', changes: v0176Changes.slice(0, 2) },
    { title: 'Düzeltmeler', changes: v0176Changes.slice(2) }
  ] },
  { version: '0.17.5', date: '2026-10-02', title: "Kurulum ekranı olmadan güncelle", changes: ["Taşınabilir launcher güncellemeleri doğrulanmış EXE ile yerinde uygulanır; launcher kapanıp yeni sürümle açılır, başarısız açılışta eski dosya geri yüklenir.","Güncellemenin indirme, yeniden başlatma ve tamamlanma durumu İndirmeler sayfasında gösterilir; alt çubuktaki güncelleme bağlantısı bu sayfayı açar.","Güncelleme başarıları ve hataları günlüğe kaydedilir; aynı hatalar tekrar sayısıyla gruplanır, ilk ve son görülme zamanları ayrıntıda gösterilir."] },
  { version: '0.17.4', date: '2026-10-02', title: "Güncellemelere daha kolay ulaş", changes: ["Taşınabilir launcher paketine eksik güncelleme yapılandırması eklendi; indirme sırasında görülen app-update.yml hatası düzeltildi.","Alt çubuktaki güncelleme bağlantısı sürümle aynı ayırıcı grubuna taşındı ve doğrudan değişiklik günlüğünü açar.","Güncelleme ayarlarına sürüm notlarına doğrudan bağlantı ve yeşil indirme düğmesi eklendi; ayrı güncelleme penceresi kaldırıldı.","GitHub sürüm notlarındaki Markdown ve HTML başlıkları değişiklik günlüğünde başlık olarak gösterilir."] },
  { version: '0.17.3', date: '2026-10-02', title: "Alt çubuk ve güncellemeler daha sade", changes: ["Alt çubuk, açılışta son seçili profilin oyun geçmişini normal durum yazısıyla aynı fontta gösterir; toplam süre parantez içinde yer alır.","Oyun süresi metninin tıklama ve hover davranışı kaldırıldı; ayrı istatistik menüsü ve profil bilgilerindeki bağlantısı kaldırıldı.","Alt çubuğun sağındaki profil yazısı Profillerim sayfasını açar.","Güncelleme notları yalnızca değişiklik günlüğünde gösterilir; yeni ve kullanılan sürümler ayrı rozetlerle belirtilir.","Taşınabilir launcher güncellemeleri tam dosyayla indirilir; hatalar bildirim ve günlükle gösterilir, son kontrol tarihi kontrol sırasında sabit kalır."] },
  { version: '0.17.2', date: '2026-10-02', title: 'Oyun geçmişin her zaman elinin altında', changes: ['Alt çubuk, seçili profilin son oyun tarihini, oturum süresini ve toplam oyun süresini gösterir; indirme ve başlatma durumları önceliklidir.', 'Günlük ve haftalık oyun süreleri, profil geçmişi ve isteğe bağlı yerel kayıt eklendi; ayrıntılar alt çubuktan ve profil bilgilerinden açılır.', 'Sunucu ve dünya ikonları tablo satırlarının sol kenarına yaslandı; sütun ayırıcıları ve yuvarlak köşeler korundu.', 'Güncelleme kartı özel bir manzara, sade durum başlığı ve kartın dışında son kontrol bilgisiyle yenilendi; elle kontrolden sonra bildirim gösterilir.', 'Sürümler sayfasındaki içe aktarma ve yenileme düğmelerinin bazı ziyaret sıralarında üst üste gelmesi düzeltildi.'] },
  { version: '0.17.1', date: '2026-10-02', title: 'Küçük düzeltmeler, daha düzgün bir deneyim', changes: ['Güncelleme kontrolleri için eksik yayın dosyaları tamamlandı; eksik dosya ve bağlantı hataları ayrı gösterilir.', 'Güncelleme kutusu Launcher ayarlarının en altına taşındı.', 'Dünya ve sunucu tablolarının son satır köşeleri ve başlıklarla ikon hizası düzeltildi.', 'Değişiklik günlüğünde en son sürüm, sol menüde yeşil bir rozetle gösterilir.'] },
  { version: '0.17.0', date: '2026-10-02', title: 'Bir kez kur, güncel kal', intro: 'Launcher güncellemeleri ve dünyaların yönetimi artık aynı yerde.', changes: ['Açılışta ve elle güncelleme kontrolü, ana sayfada sürüm notları ve alt barda güncelleme bildirimi eklendi.', 'Doğrulanan indirmeler, iptal, tekrar deneme ve yeniden başlatarak güncelleme eklendi; eski sürüme dönüş engellendi.', 'Dünyalar ve sunucular profillere bağlandı; sunucu listeleri oyunla karşılıklı eşitlenir.', 'Dünya ekleme, ad değiştirme, kopyalama, silme, simge sıfırlama ve seed kopyalama eklendi.', 'Dünya bilgilerinin simgeleri ve iki tablonun tam genişlikte seçim ve hover görünümü düzenlendi.'] },
  { version: '0.16.0', date: '2026-10-01', title: 'Profiline göre oyna', intro: 'Tek sürüme bağlı profiller, doğrudan sunucuya katılma ve yenilenen ayarlar. Profilini seç, dünyana devam et.', changes: v016Sections.flatMap(section => section.changes), sections: v016Sections },
  { version: '0.15.0', date: '2026-10-01', title: 'Daha fazla kontrol, daha düzenli', intro: 'Profil araçları, indirme yönetimi ve mod favorileri bir arada. Bu sürümde Discord etkinliği ve ortak menü tasarımı da yenilendi.', changes: v015Sections.flatMap(section => section.changes), sections: v015Sections },
  { version: '0.14.0', date: '2026-09-29', title: 'Daha hızlı, daha düzenli', changes: ['Açılış akışı ve sık kullanılan verilerin önbelleği iyileştirildi.', 'Oyuncu görünümleri önbellekten yüklenerek gereksiz indirmeler azaltıldı.', 'Günlükler arama, filtreler ve ayrıntı görünümüyle yeniden düzenlendi.', 'Profil bulunmayan ekran, ilk profilini oluşturmayı kolaylaştıracak şekilde yenilendi.', 'Sürüm geçmişi, kalıcı sürüm listesi ve ayrı bir okuma alanıyla yeniden tasarlandı.'] },
  { version: '0.13.1', date: '2026-09-29', title: 'Küçük dokunuşlar, daha iyi bir deneyim', changes: ['Değişiklik günlüğü sadeleştirildi ve sürüm ayrıntıları yenilendi.', 'Mod kaynakları arasında geçerken oluşan kimlik hatası düzeltildi.', 'Technic görünümü ve hata günlüklerinin kaydırma çubuğu düzenlendi.'] },
  { version: '0.13.0', date: '2026-09-29', title: 'Daha fazla kaynak, daha düzenli ayarlar', changes: ['CurseForge ve Technic katalogları ortak mod tarayıcısına eklendi.', 'Java ayarları Genel ve Kurulumlar sekmelerine ayrıldı.', 'Alt bara sürüm geçmişi ve değişiklik günlüğü eklendi.', 'Windows sağ tık menüsündeki boşluklar düzenlendi.'] },
  { version: '0.12.2', date: '2026-09-29', title: 'Hesaplar ve oyun oturumları', changes: ['Profiller ve masaüstü kısayolları hesaplara bağlandı.', 'Çalışan oyunları görüntüleme ve onayla tekrar başlatma eklendi.', 'Hesap menüleri, yazı boyutları ve bildirimler yenilendi.', 'Windows simgesi ve hızlı erişim kısayolları iyileştirildi.'] }
]

export function Changelog({ language, update, onCheck, onUpdate, onClose }: { language: Language; update: LauncherUpdate; onCheck(): Promise<unknown>; onUpdate(): void; onClose: () => void }) {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const available = !!update.version && ['available', 'checking', 'downloading', 'ready', 'error'].includes(update.phase)
  const incoming: ReleaseNotes | null = available && !releases.some(release => release.version === update.version) ? {
    version: update.version!, date: (update.releasedAt ?? new Date().toISOString()).slice(0, 10), title: 'Yeni bir güncelleme var',
    changes: [], remoteNotes: update.notes || t('Sürüm notları henüz yayımlanmadı.'),
  } : null
  const history = incoming ? [incoming, ...releases] : releases
  const [selectedVersion, setSelectedVersion] = useState(history[0].version)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const shown = history.filter(release => `v${release.version} ${release.title} ${release.changes.join(' ')} ${release.sections?.flatMap(section => section.changes).join(' ') ?? ''} ${release.remoteNotes ?? ''}`.toLocaleLowerCase(language).includes(query.toLocaleLowerCase(language)))
  const [closing, setClosing] = useState(false)
  const [checking, setChecking] = useState(false)
  const checkBusy = checking || update.phase === 'checking'
  const check = async () => {
    if (checkBusy) return
    setChecking(true)
    try { await onCheck() } catch { /* The shared update controls report failures through a notification. */ }
    finally { setChecking(false) }
  }
  const selected = history.find(release => release.version === selectedVersion) ?? history[0]
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
        <div className="release-history-count">{t('Toplam {count} sürüm', { count: history.length })}</div>
        <div className="release-history-versions">{shown.map(release => <button
          type="button"
          className="release-history-version"
          key={release.version}
          aria-current={selectedVersion === release.version ? 'true' : undefined}
          aria-controls="release-history-detail"
          onClick={() => setSelectedVersion(release.version)}
        >
          <span className="release-history-version-top"><span className="release-history-version-label"><strong>v{release.version}</strong>{release.version === history[0].version && <span className="release-latest-badge">{t('En son')}</span>}{history[0].version !== update.currentVersion && release.version === update.currentVersion && <span className="release-current-badge">{t('Kullandığın sürüm')}</span>}</span><time dateTime={release.date}>{date(release.date, true)}</time><ChevronRight size={14} aria-hidden="true" /></span>
          <span className="release-history-version-title">{t(release.title)}</span>
        </button>)}{!shown.length && <p className="release-history-no-results">{t('Sürüm bulunamadı.')}</p>}</div>
        <footer className="release-history-build">{available ? <button type="button" className="release-update-cta" onClick={onUpdate} disabled={checkBusy}><span>v{update.version}</span><span aria-hidden="true">·</span><span>{t('Güncelle')}</span><ArrowRight size={15} aria-hidden="true" /></button> : <div className="release-current-cta"><span>v{update.currentVersion || packageJson.version}</span><span aria-hidden="true">·</span><span>{t(update.error ? 'Kontrol et' : 'Güncel')}</span><button type="button" className="release-check" onClick={() => void check()} disabled={checkBusy} aria-label={t('Güncellemeleri kontrol et')} aria-busy={checkBusy}><RefreshCw size={15} className={checkBusy ? 'spin' : undefined} aria-hidden="true" /></button></div>}</footer>
      </nav>
      <section className="release-history-detail" id="release-history-detail" aria-labelledby="release-history-title" tabIndex={0} ref={content}>
        <div className="release-history-article" key={selected.version}>
          <header className="release-history-heading">
            <h3 id="release-history-title">{t(selected.title)}</h3>
            <time dateTime={selected.date}><CalendarDays size={14} aria-hidden="true" />{date(selected.date)}</time>
          </header>
          {selected.remoteNotes ? <section className="release-history-section release-remote-notes">{releaseNotesBlocks(selected.remoteNotes).map((block, index) => block.kind === 'heading' ? <h4 key={index} data-level={block.level}>{block.text}</h4> : block.kind === 'list' ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p key={index}>{block.text}</p>)}</section> : <>
            <p className="release-history-intro">{t(selected.intro ?? 'Bu sürümde uygulamanın genel akışı iyileştirildi, performans arttırıldı ve kullanıcı arayüzünde önemli düzenlemeler yapıldı.')}</p>
            {(selected.sections ?? [{ title: 'Yeni özellikler', changes: selected.changes.slice(0, 2) }, { title: 'Düzeltmeler', changes: selected.changes.slice(2, 4) }, { title: 'Performans', changes: selected.changes.slice(4) }]).filter(section => section.changes.length).map(section => <section className="release-history-section" key={section.title}><h4>{t(section.title)}</h4>{section.changes.map(change => <p key={change}>{t(change)}</p>)}</section>)}
          </>}
        </div>
      </section>
    </div>
  </AccountDialog>
}
