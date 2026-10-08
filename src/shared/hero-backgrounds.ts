import type { HeroBackground, LauncherSettings } from './types'

export const builtinHeroIds = ['overworld', 'nether', 'end'] as const
export const maxHeroBackgrounds = 12
export const heroBackgroundId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function normalizeHeroSettings(settings: Partial<LauncherSettings>): Pick<LauncherSettings, 'heroBackgrounds' | 'disabledHeroBackgrounds' | 'heroBackgroundOrder'> {
  const seen = new Set<string>()
  const backgrounds: HeroBackground[] = []
  if (Array.isArray(settings.heroBackgrounds)) for (const item of settings.heroBackgrounds) {
    if (!item || typeof item.id !== 'string' || !heroBackgroundId.test(item.id) || seen.has(item.id) || typeof item.name !== 'string') continue
    seen.add(item.id)
    backgrounds.push({ id: item.id, name: item.name.trim().slice(0, 80) || 'Custom', enabled: item.enabled !== false })
    if (backgrounds.length >= maxHeroBackgrounds) break
  }
  const disabled = builtinHeroIds.filter(id => Array.isArray(settings.disabledHeroBackgrounds) && settings.disabledHeroBackgrounds.includes(id))
  // Always retain a usable background, including when a malformed saved list is recovered.
  if (disabled.length === builtinHeroIds.length && !backgrounds.some(item => item.enabled)) disabled.splice(disabled.indexOf('overworld'), 1)
  const available = new Set<string>([...builtinHeroIds, ...backgrounds.map(item => item.id)])
  const order: string[] = []
  if (Array.isArray(settings.heroBackgroundOrder)) for (const id of settings.heroBackgroundOrder) {
    if (typeof id === 'string' && available.delete(id)) order.push(id)
  }
  order.push(...available)
  return { heroBackgrounds: backgrounds, disabledHeroBackgrounds: disabled, heroBackgroundOrder: order }
}
