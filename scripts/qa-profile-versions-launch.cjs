// Isolated renderer fixture; all version downloads and profile changes stay in memory.
const { ipcMain, BrowserWindow } = require('electron')
const register = ipcMain.handle.bind(ipcMain), requests = [], installed = new Set(['1.21.1', '1.21.1-fabric'])
let stateHandler, fail = false, locked = false
const catalog = () => ['1.21.1', '1.20.4', '1.12.2', '24w02a'].map(id => ({ id, type: id.startsWith('24w') ? 'snapshot' : 'release', releaseTime: '2026-10-03', url: 'https://piston-meta.mojang.com/isolated-fixture', installed: installed.has(id), optifineAvailable: id !== '24w02a', optifineVersions: installed.has(`${id}-OptiFine_HD_U_TEST`) ? [{ id: `${id}-OptiFine_HD_U_TEST`, source: 'launcher' }] : [] })).concat([...installed].filter(id => /-fabric|-forge|-quilt|-neoforge|-liteloader/.test(id)).map(id => ({ id, installed: true, type: 'release', url: '', releaseTime: '2026-10-03', optifineVersions: [] })))
ipcMain.handle = (channel, handler) => {
  if (channel === 'launcher:get-state') stateHandler = handler
  return register(channel, async (event, ...args) => {
    if (channel === 'launcher:get-versions') return catalog()
    if (channel === 'launcher:get-state') return { ...await handler(event, ...args), qaVersionRequests: requests }
    if (channel === 'launcher:save-settings' && args[0]?.qaVersion) {
      const { qaVersion: control, ...settings } = args[0]; args[0] = settings; fail = control.fail ?? fail; locked = control.locked ?? locked
      const state = await stateHandler(event), profile = state.profiles.find(p => p.id === 'qa-profile')
      if (profile) profile.modpack = locked ? { projectId: 'qa', versionId: 'qa', title: 'Fixture pack', fileCount: 1 } : undefined
    }
    return handler(event, ...args)
  })
}
require('./qa-resource-packs-launch.cjs')
register('launcher:configure-profile-version', async (event, id, version, loader, acknowledged) => {
  const state = await stateHandler(event), profile = state.profiles.find(p => p.id === id)
  if (!profile) throw Error('Profil bulunamadı.')
  requests.push({ id, version, loader, acknowledged })
  if (profile.modpack) throw Error('Bu mod paketinin sürümü ve yükleyicisi paket tarafından yönetilir.')
  const oldBase = profile.versionId.split(/-OptiFine_/i)[0], oldLoader = profile.modLoader ?? (profile.versionId.includes('-OptiFine_') ? 'optifine' : 'none')
  loader ??= version === oldBase ? oldLoader : 'none'
  if (!acknowledged && (version !== oldBase || loader !== oldLoader)) return { status: 'confirmation-required', activeMods: 1 }
  await new Promise(resolve => setTimeout(resolve, 300)); if (fail) throw Error('Fixture download failed')
  profile.versionId = loader === 'optifine' ? `${version}-OptiFine_HD_U_TEST` : version
  profile.modLoader = ['none', 'optifine'].includes(loader) ? undefined : loader
  profile.modLoaderVersion = profile.modLoader ? `${version}-${loader}-fixture` : undefined
  installed.add(version); installed.add(profile.modLoaderVersion ?? profile.versionId)
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('launcher:state', state)
  return { status: 'configured', state }
})
