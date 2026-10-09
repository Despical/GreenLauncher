const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const source = ts.createSourceFile('index.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let presenceNode, trayTemplate
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'handle' && node.arguments[0]?.text === 'launcher:set-presence-context') presenceNode = node
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'Menu.buildFromTemplate') trayTemplate = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(source)
const contexts = [], nav = [], navigation = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/main/windows-integration.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: navigation, exports: navigation.exports, require: name => name === 'electron' ? {} : require(name) })
let presence
vm.runInNewContext(ts.transpileModule(presenceNode.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { handle: (_channel, handler) => presence = handler, discord: { setLauncherContext: context => contexts.push(context) } })
for (const page of ['home', 'versions', 'profiles', 'servers', 'worlds', 'mods', 'gallery', 'downloads', 'storage', 'settings', 'account', 'resource-packs', 'shader-packs', 'analytics']) presence({ page, section: 'x'.repeat(70) })
assert.equal(contexts.length, 14); assert.equal(contexts.at(-1).section.length, 40)
assert.throws(() => presence({ page: 'invalid-page' }), /Geçersiz/); assert.throws(() => presence(null), /Geçersiz/)
const menu = vm.runInNewContext('(' + trayTemplate.getText(source) + ')', { t: text => text, translate: (_language, text) => text, language: 'tr', navigationItems: navigation.exports.navigationItems, nativeImage: { createFromPath: () => ({ resize: () => 'icon' }) }, join: require('node:path').join, persistentIcon: () => 'fixture', showMainWindow: () => nav.push('open'), navigate: page => nav.push(page), app: { quit: () => nav.push('exit') } })
assert.equal(menu.length, 10); assert.equal(menu[1].type, 'separator'); assert.equal(menu[8].type, 'separator')
for (const item of menu.filter(item => item.click)) item.click()
assert.deepEqual(nav, ['open', 'home', 'versions', 'profiles', 'mods', 'downloads', 'settings', 'exit'])
assert.equal(navigation.exports.navigationArgument(['--open-page=mods']), 'mods')
assert.equal(navigation.exports.navigationArgument(['--open-page=invalid']), null)
console.log('PASS real presence handler accepts content pages and rejects invalid pages; native tray order, separators, navigation actions and mods startup route')
