const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-content-reporting-'))
function load(file) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: name => name === '../shared/errors' ? load('src/shared/errors.ts') : require(name), Error, structuredClone })
  return mod.exports
}
;(async () => {
  const { ErrorLog } = load('src/main/error-log.ts'), logs = new ErrorLog(root, () => {})
  const source = ts.createSourceFile('index.ts', fs.readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  let handlerNode
  function visit(node) { if (ts.isCallExpression(node) && node.expression.getText(source) === 'handle' && node.arguments[0]?.text === 'launcher:check-profile-content-updates') handlerNode = node; ts.forEachChild(node, visit) }
  visit(source); assert.ok(handlerNode)
  let check, items = [], requestedForce
  vm.runInNewContext(ts.transpileModule(handlerNode.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { handle: (_channel, callback) => { check = callback }, profileContent: { updates: async (_id, _kind, force) => { requestedForce = force; return items } }, logs })
  items = [{ filename: 'good.jar', status: 'current' }, { filename: 'bad.jar', status: 'error', error: 'fetch failed' }, { filename: 'bad2.jar', status: 'error', error: 'fetch failed' }]
  const result = await check('isolated-profile', 'mod', true)
  assert.equal(result, items); assert.equal(requestedForce, true); assert.equal(logs.get().length, 1); assert.equal(logs.get()[0].level, 'error'); assert.equal(logs.get()[0].source, 'Paket güncellemeleri'); assert.equal(logs.get()[0].count, 1, 'identical failures in one check are logged once')
  await check('isolated-profile', 'shader', false); assert.equal(logs.get()[0].count, 1, 'background cache reads do not duplicate errors'); assert.equal(requestedForce, false)
  items = [{ filename: 'local.zip', status: 'unknown' }]; await check('isolated-profile', 'resourcepack', true); assert.equal(logs.get().length, 2, 'an uncheckable local-only list has an error record')
  const previous = JSON.stringify(logs.get()); items = [{ filename: 'pack.zip', status: 'update' }, { filename: 'local.zip', status: 'unknown' }]; await check('isolated-profile', 'resourcepack', true); assert.equal(JSON.stringify(logs.get()), previous, 'successful checks do not add errors for skipped local files')
  assert.equal(new ErrorLog(root, () => {}).get().length, 2, 'manual failure records survive restart')
  console.log('PASS real content-update IPC handler: partial failures, deduplicated error records, local-only failure, successful skips, silent background cache reads and persistent error log; isolated data')
})().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(root, { recursive: true, force: true }))
