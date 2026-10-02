import { readMinecraftServers, writeMinecraftServers, serverAddressKey } from './minecraft-servers'
import type { ServerJoinPreference } from '../shared/types'

// Preserve all unrelated NBT fields, including Minecraft's hidden Quick Play entries.
export function saveMinecraftServerPreference(gamePath: string, address: string, preference: ServerJoinPreference): void {
  if (!preference || typeof preference.name !== 'string' || !preference.name.trim() || preference.name.length > 80 || !['enabled', 'prompt', 'disabled'].includes(preference.resourcePacks)) throw new Error('Kaynak paketi tercihi geçersiz.')
  const document = readMinecraftServers(gamePath)
  let entry = document.entries.find(value => value.ip?.type === 'string' && serverAddressKey(value.ip.value) === serverAddressKey(address))
  if (!entry) { entry = {}; document.entries.push(entry) }
  entry.name = { type: 'string', value: preference.name.trim() }
  entry.ip = { type: 'string', value: address }
  if (preference.resourcePacks === 'prompt') delete entry.acceptTextures
  else entry.acceptTextures = { type: 'byte', value: preference.resourcePacks === 'enabled' ? 1 : 0 }
  writeMinecraftServers(gamePath, document)
}
