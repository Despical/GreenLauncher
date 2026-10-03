// Only the isolated UI fixture is launched; no real launcher data is read.
const { ipcMain } = require('electron')
const register = ipcMain.handle.bind(ipcMain)
const requests = []
ipcMain.handle = (channel, handler) => register(channel, async (event, ...args) => {
  if (['launcher:get-worlds', 'launcher:get-servers', 'launcher:get-installed-mods', 'launcher:get-profile-content', 'launcher:get-screenshots'].includes(channel)) {
    requests.push({ channel, profileId: args[0] })
  }
  const result = await handler(event, ...args)
  return channel === 'launcher:get-state' ? { ...result, qaWorkspaceRequests: requests } : result
})
require('./qa-ui-refresh-launch.cjs')
