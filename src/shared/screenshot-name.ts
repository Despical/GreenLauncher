export const screenshotImageExtensions = new Set(['.png', '.jpg', '.jpeg'])

export function screenshotExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function screenshotFilename(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Dosya adı boş olamaz.')
  const name = value.trim()
  const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(name.split('.')[0].trimEnd())
  if (name.length > 240 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || reserved) throw new Error('Geçerli bir dosya adı yaz. Klasör yolu ve özel karakterler kullanılamaz.')
  return name
}
