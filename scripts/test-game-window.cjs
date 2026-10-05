const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-game-window-'))
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/game-window.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: mod, exports: mod.exports, require })
const { saveMinecraftWindowPreference } = mod.exports
try {
  const file = path.join(root, 'options.txt')
  const other = 'version:3955\r\nresourcePacks:["vanilla","file/Örnek.zip"]\r\nkey_key.fullscreen:key.keyboard.f11\r\n'
  fs.writeFileSync(file, other + 'fullscreen:true\r\ngamma:0.5\r\n')
  saveMinecraftWindowPreference(root, false)
  assert.equal(fs.readFileSync(file, 'utf8'), other + 'fullscreen:false\r\ngamma:0.5\r\n')
  saveMinecraftWindowPreference(root, true)
  assert.equal(fs.readFileSync(file, 'utf8'), other + 'fullscreen:true\r\ngamma:0.5\r\n')
  fs.writeFileSync(file, 'gamma:0.5\r\nrenderDistance:12')
  saveMinecraftWindowPreference(root, false)
  assert.equal(fs.readFileSync(file, 'utf8'), 'gamma:0.5\r\nrenderDistance:12\r\nfullscreen:false\r\n')
  fs.unlinkSync(file); saveMinecraftWindowPreference(root, false)
  assert.equal(fs.readFileSync(file, 'utf8'), 'fullscreen:false\n')
  console.log('PASS remembered fullscreen follows the profile preference; unrelated settings, Unicode, F11 binding and CRLF survive; missing options are initialized in an isolated directory')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
