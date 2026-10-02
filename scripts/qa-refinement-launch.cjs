// Isolated UI regression fixture. No user data or external credentials are used.
const { app, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
app.disableHardwareAcceleration()
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => {
  if (window.webContents.getURL().startsWith('file:')) { window.setSize(1080,700); window.show(); window.focus() }
}))
app.setAppPath(root)
app.setPath('appData', path.join(root, 'build', 'qa-accounts-data'))
const connected = !process.argv.includes('--qa-no-curseforge')
const calls = []
const output = path.join(root, 'build', 'qa-source-requests.json')
const record = item => { calls.push(item); fs.writeFileSync(output, JSON.stringify(calls, null, 2)) }
fs.writeFileSync(output, '[]')
const names = { technic: 'technic-fixture', modrinth: 'abcdefgh', curseforge: '12345' }
const hit = source => ({ projectId: names[source], slug: names[source], title: source + ' test pack', description: 'Provider transition regression fixture', author: 'QA', iconUrl: null, downloads: 1234, updated: '2026-09-29', categories: [] })
const original = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => original(channel, async (event, ...args) => {
  if (channel === 'launcher:get-provider-status') return { curseforge: connected }
  if (channel === 'launcher:get-mod-categories') return [{ value: '1', label: 'Adventure' }]
  if (channel === 'launcher:search-mods') {
    const source = args[7] || 'modrinth'
    record({ kind: 'search', source })
    await new Promise(resolve => setTimeout(resolve, args[0] ? 350 : 60))
    return { total: 1, hits: [hit(source)] }
  }
  if (['launcher:get-mod-project', 'launcher:get-mod-versions'].includes(channel)) {
    const source = args[channel.endsWith('project') ? 1 : 3] || 'modrinth'
    const valid = args[0] === names[source]
    record({ kind: channel, source, id: args[0], valid })
    if (!valid) throw Error('Wrong provider identifier')
    await new Promise(resolve => setTimeout(resolve, 80))
    if (channel.endsWith('project')) return { id: names[source], slug: names[source], title: hit(source).title, description: hit(source).description, body: 'Fixture release details', downloads: 1234, license: 'MIT', iconUrl: null, sourceUrl: null, projectType: 'modpack' }
    return [{ id: source + ':1', name: '1.0', versionNumber: '1.0', type: 'release', published: '', downloads: 10, gameVersions: ['1.20.1'], loaders: ['fabric'] }]
  }
  if (channel === 'launcher:get-error-log') return Array.from({ length: 18 }, (_, index) => ({ id: String(index), at: '2026-09-29T15:06:19Z', source: 'QA · network-check', code: 'TEST_FIXTURE', message: 'Test kaydı. Bu liste yalnızca kaydırma çubuğunu ve yerleşimi kontrol etmek için oluşturuldu.' }))
  return listener(event, ...args)
})
require('../out/main/index.js')
