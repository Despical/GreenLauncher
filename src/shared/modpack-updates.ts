import type { ModVersion } from './types'

// Provider identifiers are opaque; only newer publication dates count as updates.
export function newerModpackVersions(versions: ModVersion[], installedId: string): ModVersion[] {
  const current = versions.find(version => version.id === installedId)
  if (!current || !Number.isFinite(Date.parse(current.published))) return []
  return versions.filter(version => version.id !== installedId && Number.isFinite(Date.parse(version.published)) && Date.parse(version.published) > Date.parse(current.published) && (version.type === 'release' || current.type !== 'release' && version.type === current.type))
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
}
