// Renderer QA uses in-memory content/log fixtures and isolated Chromium data.
const { ipcMain } = require('electron')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/game-console.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require, structuredClone, Buffer, setTimeout, clearTimeout, AbortSignal })
const logs = new mod.exports.GameConsole(() => {})
logs.begin({ id: 'polish-game', profileId: 'qa-profile', profileName: 'Test World', accountId: 'qa-offline', accountName: 'DesignQA', pid: 9001, versionId: '1.21.1', startedAt: new Date().toISOString() })
const resetGame = () => { logs.clear('qa-profile', 'polish-game'); logs.append('polish-game', '[main/INFO]: Isolated console output') }
resetGame()
process.argv.push('--qa-profile-content', '--qa-content', '--qa-worlds', '--qa-profile-servers')
const register = ipcMain.handle.bind(ipcMain)
let failLogs = false, emptyLogs = false
ipcMain.handle = (channel, handler) => register(channel, async (event, ...args) => {
  if (channel === 'launcher:save-settings' && args[0]?.qaPolish) {
    const { qaPolish, ...settings } = args[0]; args[0] = settings
    failLogs = qaPolish.failLogs ?? failLogs; emptyLogs = qaPolish.emptyLogs ?? emptyLogs
    if (qaPolish.resetGame) resetGame()
  }
  if (channel === 'launcher:get-system-log') {
    await new Promise(resolve => setTimeout(resolve, 350))
    if (failLogs) throw Error('Fixture log read failed')
  }
  if (channel === 'launcher:copy-game-log') await new Promise(resolve => setTimeout(resolve, 350))
  const result = await handler(event, ...args)
  if (channel === 'launcher:get-system-log-files' && emptyLogs) return []
  if (channel === 'launcher:check-profile-content-updates') return result.map(item => item.compatible === false && item.status !== 'unknown' ? { ...item, status: 'incompatible', latest: undefined } : item)
  return result
})
require('./qa-profile-versions-launch.cjs')
ipcMain.handle('launcher:get-game-log', (_event, profile, id, after) => logs.snapshot(profile, id, after))
ipcMain.handle('launcher:clear-game-log', (_event, profile, id) => logs.clear(profile, id))
ipcMain.handle('launcher:copy-game-log', () => {})
