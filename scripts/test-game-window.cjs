const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-game-window-'))
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/game-window.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: mod, exports: mod.exports, require })
const { saveMinecraftWindowPreference, minecraftWindowSize } = mod.exports
try {
  const desktop = { width: 1920, height: 1040 }
  assert.deepEqual({ ...minecraftWindowSize({ width: 1920, height: 1080 }, desktop) }, { width: 1280, height: 720 })
  assert.deepEqual({ ...minecraftWindowSize({ width: 854, height: 480 }, desktop) }, { width: 854, height: 480 })
  assert.deepEqual({ ...minecraftWindowSize({ width: 854, height: 480, name: 'Saved profile' }, desktop) }, { width: 854, height: 480 })
  assert.deepEqual({ ...minecraftWindowSize({ width: 1600, height: 900 }, desktop) }, { width: 1600, height: 900 })
  const small = minecraftWindowSize({ width: 1280, height: 720 }, { width: 1280, height: 680 })
  assert.ok(small.width < 1280 && small.height < 640)
  const wide = minecraftWindowSize({ width: 3440, height: 1440 }, { width: 1920, height: 1040 })
  assert.ok(wide.width <= 1280 && wide.height <= 720 && Math.abs(wide.width / wide.height - 3440 / 1440) < .01)
  console.log('PASS monitor-sized windows shrink with aspect ratio intact; smaller custom windows stay unchanged; taskbar and smaller displays leave room for window decorations')
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
