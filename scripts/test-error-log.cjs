const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-error-log-test-'))
let now = Date.parse('2026-10-02T00:00:00Z')
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
function load(file) {
  const module = { exports: {} }
  const localRequire = name => name === '../shared/errors' ? load('src/shared/errors.ts') : require(name)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {require:localRequire,module,exports:module.exports,Error,Date:TestDate,structuredClone}, {filename:file})
  return module.exports
}
try {
  const message = 'Missing 1 libraries! Either the file not reachable or the file sha1 not matched!'
  const saved = [{id:'ipc',at:new Date(now).toISOString(),source:'play-version',message,code:'LAUNCHER_ERROR'}, {id:'activity',at:new Date(now).toISOString(),source:'Oyun',message,code:'LAUNCHER_ERROR'}, {id:'other',at:new Date(now).toISOString(),source:'play',message:'A different failure',code:'LAUNCHER_ERROR'}]
  fs.writeFileSync(path.join(root,'error-log.json'),JSON.stringify(saved))
  const { ErrorLog } = load('src/main/error-log.ts')
  let notifications = 0
  const log = new ErrorLog(root, () => notifications++)
  assert.equal(log.get().length,2)
  assert.equal(log.get()[0].source,'Oyun')
  assert.equal(JSON.parse(fs.readFileSync(log.path)).length,2)
  log.record('Oyun',new Error(message));log.record('play-version',message)
  assert.equal(log.get().length,2)
  log.record('Windows','Interleaved unrelated failure');log.record('play',message)
  assert.equal(log.get().length,3)
  log.record('play-version','Another missing library')
  assert.equal(log.get().length,4)
  log.record('install',message)
  assert.equal(log.get().length,5)
  now += 6000
  log.record('play-version',message)
  assert.equal(log.get().length,6)
  const copy=log.get();copy.length=0;assert.equal(log.get().length,6)
  assert.equal(notifications,4)
  const reopened=new ErrorLog(root,()=>{})
  assert.equal(reopened.get().length,6)
  reopened.clear();assert.equal(reopened.get().length,0)
  assert.deepEqual(JSON.parse(fs.readFileSync(reopened.path)),[])
  console.log('PASS historical activity/IPC duplicates, interleaved events, distinct messages/sources, later retries, persistence and clearing')
} finally {
  const relative=path.relative(os.tmpdir(),root)
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))
  fs.rmSync(root,{recursive:true,force:true})
}
