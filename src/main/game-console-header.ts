import { translate, type Language } from '../renderer/src/i18n'

export interface GameConsoleHeader {
  launcherVersion: string; profile: string; mode: 'offline' | 'microsoft'
  username: string; uuid: string
  gamePath: string; javaPath: string; javaVersion: string; os: string; cpu: string
  totalMemoryMb: number; availableMemoryMb: number; gpu: string[]
  minecraftVersion: string; loader?: string; mainClass?: string
  libraries: string[]; mods: string[]; width: number; height: number; fullscreen: boolean
  javaArguments: string[]; pid: number
}

export function gameConsoleHeader(data: GameConsoleHeader, language: Language): string[] {
  const t = (text: string, values?: Record<string, string | number>) => translate(language, text, values)
  const lines = [`Green Launcher ${data.launcherVersion}`, '', t('Başlatılan profil: {profile}', { profile: data.profile }), t('Başlatma modu: {mode}', { mode: t(data.mode === 'offline' ? 'Çevrimdışı hesap' : 'Microsoft hesabı') }), `${t('Kullanıcı adı')}: ${data.username}`, `UUID: ${data.uuid}`, '', `${t('Oyun klasörü')}:`, `  ${data.gamePath}`, '', `${t('Java çalıştırılabilir dosyası')}:`, `  ${data.javaPath}`, t('Java sürümü: {version}', { version: data.javaVersion }), '', `${t('İşletim sistemi')}: ${data.os}`, `${t('İşlemci')}: ${data.cpu}`, `RAM: ${data.totalMemoryMb} MiB (${t('Kullanılabilir')}: ${data.availableMemoryMb} MiB)`, ...data.gpu.map(gpu => `GPU: ${gpu}`), '', `${t('Bileşenler')}:`, `  Minecraft ${data.minecraftVersion}`, ...(data.loader ? [`  ${data.loader}`] : [])]
  if (data.mainClass) lines.push('', `${t('Ana sınıf')}: ${data.mainClass}`)
  if (data.mods.length) lines.push('', `${t('Modlar')}:`, ...data.mods.map(mod => `  ${mod}`))
  if (data.libraries.length) lines.push('', `${t('Kütüphaneler')}:`, ...data.libraries.map(library => `  ${library}`))
  lines.push('', `${t('Pencere')}: ${data.width} × ${data.height}${data.fullscreen ? ` (${t('Tam ekran başlat')})` : ''}`, `${t('JVM argümanları')}:`, `  ${data.javaArguments.join(' ')}`, '', t('Minecraft işlem kimliği: {pid}', { pid: data.pid }), '')
  return lines
}
