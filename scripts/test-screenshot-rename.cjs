// Real filesystem checks in an owned temporary directory; no launcher data.
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-screenshot-rename-'))
const fakeImage = { isEmpty: () => false, toJPEG: () => Buffer.from('isolated-thumbnail') }
const electron = { app: { getPath: () => path.join(root, 'appData') }, nativeImage: { createThumbnailFromPath: async () => fakeImage } }
function load(file, promises) {
  const mod = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, { module: mod, exports: mod.exports, Buffer, console, require: name => name === 'electron' ? electron : name === 'node:fs/promises' && promises ? promises : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts'), promises) : require(name) })
  return mod.exports
}
const { LibraryService } = load('src/main/library.ts')
const { screenshotFilename } = load('src/shared/screenshot-name.ts')
let profiles = [{ id: 'a' }], count = 0
const store = { get: () => ({ profiles }), gamePath: profile => path.join(root, profile.id) }
const library = new LibraryService(store)
const folder = path.join(root, 'a', 'screenshots')
const id = (name, profileId = 'a') => Buffer.from(JSON.stringify({ profileId, name })).toString('base64url')
const bytes = Buffer.from('unchanged screenshot contents')
function put(name, contents = bytes) { fs.mkdirSync(folder, { recursive: true }); const file = path.join(folder, name); fs.writeFileSync(file, contents); return file }
function pass(name) { count++; console.log('PASS', name) }
;(async () => {
  try {
    const original = put('original.png'), time = new Date('2026-01-02T10:00:00Z')
    fs.utimesSync(original, time, time)
    await library.screenshots('a'); await library.screenshotPreview(id('original.png'))
    const renamed = await library.renameScreenshot(id('original.png'), 'Yeni görüntü.png')
    assert.equal(renamed.name, 'Yeni görüntü.png'); assert.equal(renamed.visible, true)
    assert.equal(fs.existsSync(original), false); assert.deepEqual(fs.readFileSync(path.join(folder, renamed.name)), bytes)
    assert.equal(fs.statSync(path.join(folder, renamed.name)).mtimeMs, time.getTime())
    assert.equal((await library.screenshots('a'))[0].id, renamed.id)
    assert.match(await library.screenshot(renamed.id), /data:image\/png;base64,/)
    await assert.rejects(() => library.screenshot(id('original.png')))
    assert.equal([...library.thumbnailCache.keys(), ...library.previewCache.keys()].some(key => key.startsWith(original + '\0')), false)
    pass('Rename preserves image bytes and time, returns a usable new ID and refreshes cached paths')

    put('taken.png', 'existing file')
    await assert.rejects(() => library.renameScreenshot(renamed.id, 'taken.png'), /zaten var/)
    assert.equal(fs.readFileSync(path.join(folder, 'taken.png'), 'utf8'), 'existing file')
    assert.deepEqual(fs.readFileSync(path.join(folder, renamed.name)), bytes)
    pass('Existing destination is never overwritten')

    for (const name of ['', ' ', '..', '../escape.png', 'nested/image.png', 'nested\\image.png', 'C:\\escape.png', 'bad:name.png', 'bad\0name.png', 'CON.png', 'CON .png', 'LPT1.jpg', 'COM¹.png', 'bad.', 'x'.repeat(241)]) {
      assert.throws(() => screenshotFilename(name))
      await assert.rejects(() => library.renameScreenshot(renamed.id, name))
    }
    for (const source of [id('../escape.png'), id('missing.png'), id(renamed.name, 'foreign')]) await assert.rejects(() => library.renameScreenshot(source, 'blocked.png'))
    fs.mkdirSync(path.join(folder, 'directory.png')); await assert.rejects(() => library.renameScreenshot(id('directory.png'), 'blocked.png'))
    pass('Invalid Windows names, traversal, missing files, directories and foreign profiles are rejected')

    await assert.rejects(() => library.renameScreenshot(renamed.id, 'renamed.jpg'), /onay gerekiyor/)
    const jpg = await library.renameScreenshot(renamed.id, 'renamed.jpg', true)
    assert.equal(jpg.visible, true); assert.deepEqual(fs.readFileSync(path.join(folder, jpg.name)), bytes)
    const hidden = await library.renameScreenshot(jpg.id, 'renamed.txt', true)
    assert.equal(hidden.visible, false); assert.deepEqual(fs.readFileSync(path.join(folder, hidden.name)), bytes)
    assert.equal((await library.screenshots('a')).some(item => item.name === 'renamed.txt'), false)
    pass('Extension changes require explicit confirmation and never convert or discard image data')

    put('case.png')
    const caseResult = await library.renameScreenshot(id('case.png'), 'CASE.PNG')
    assert.ok(fs.readdirSync(folder).includes('CASE.PNG')); assert.equal(caseResult.visible, true)
    assert.deepEqual(fs.readFileSync(path.join(folder, 'CASE.PNG')), bytes)
    pass('Case-only renames work on Windows without losing the source')

    const standard = path.join(root, 'appData', '.minecraft', 'screenshots')
    fs.mkdirSync(standard, { recursive: true }); fs.writeFileSync(path.join(standard, 'standard.png'), bytes)
    const standardResult = await library.renameScreenshot(id('standard.png', null), 'standard-new.png')
    assert.equal(standardResult.visible, true); assert.deepEqual(fs.readFileSync(path.join(standard, 'standard-new.png')), bytes)
    profiles = []; await assert.rejects(() => library.renameScreenshot(caseResult.id, 'foreign.png'))
    profiles = [{ id: 'a' }]
    pass('Standard screenshots remain supported and account-scoped profiles are rechecked')

    put('race.png')
    const real = require('node:fs/promises')
    const RacingService = load('src/main/library.ts', { ...real, copyFile: async (source, destination, flags) => { fs.writeFileSync(destination, 'other process'); return real.copyFile(source, destination, flags) } }).LibraryService
    await assert.rejects(() => new RacingService(store).renameScreenshot(id('race.png'), 'racing.png'), /zaten var/)
    assert.equal(fs.readFileSync(path.join(folder, 'racing.png'), 'utf8'), 'other process'); assert.deepEqual(fs.readFileSync(path.join(folder, 'race.png')), bytes)
    pass('A destination created during the operation is protected by exclusive creation')

    const FailureService = load('src/main/library.ts', { ...real, unlink: async file => { if (file === path.join(folder, 'race.png')) throw Object.assign(Error('fixture denied'), { code: 'EACCES' }); return real.unlink(file) } }).LibraryService
    await assert.rejects(() => new FailureService(store).renameScreenshot(id('race.png'), 'rollback.png'), /fixture denied/)
    assert.equal(fs.existsSync(path.join(folder, 'rollback.png')), false); assert.deepEqual(fs.readFileSync(path.join(folder, 'race.png')), bytes)
    pass('Failed source removal rolls back only the newly created destination')
    console.log(`${count} isolated screenshot rename checks passed.`)
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('green-screenshot-rename-')) throw Error('Unexpected fixture cleanup path')
    fs.rmSync(root, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
