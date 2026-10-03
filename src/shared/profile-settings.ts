import type { LauncherProfile, LauncherSettings } from './types'

export function profileJoinTarget(profile?: LauncherProfile, serverAddress?: string, worldId?: string): { serverAddress?: string; worldId?: string } {
  if (serverAddress !== undefined || worldId !== undefined) return { serverAddress, worldId }
  if (!profile || profile.autoJoinEnabled === false) return {}
  if (profile.autoJoinEnabled === undefined) return { serverAddress: profile.serverAddress }
  return profile.autoJoinMode === 'world' ? { worldId: profile.worldId || undefined } : { serverAddress: profile.serverAddress }
}

export function profilePlaytime(profile: LauncherProfile | undefined, settings: LauncherSettings, option: 'showPlaytime' | 'savePlaytime'): boolean {
  return profile?.playtimeOverride ? profile[option] !== false : settings[option] !== false
}

export function profileMemory(profile: LauncherProfile, settings: LauncherSettings) {
  const maxMemory = profile.memoryOverride === false ? settings.memoryMb : profile.memoryMb
  return { maxMemory, minMemory: profile.memoryOverride === false ? Math.min(1024, maxMemory) : Math.min(profile.minMemoryMb ?? 1024, maxMemory) }
}

export function permGenArgument(profile: LauncherProfile, javaMajor: number | undefined): string[] {
  return profile.memoryOverride !== false && javaMajor !== undefined && javaMajor < 8 ? [`-XX:PermSize=${profile.permGenMb ?? 128}m`] : []
}
