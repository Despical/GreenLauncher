const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript')
const { createServer } = require('node:http'), { createHash } = require('node:crypto')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-download-test-'))
const load = file => {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(output, { exports: mod.exports, module: mod, require, structuredClone, Buffer, URL, AbortController, AbortSignal, fetch, console, setInterval, clearInterval, setTimeout, clearTimeout })
  return mod.exports
}
const { DownloadManager } = load('src/main/download-manager.ts')
const { ModFavorites } = load('src/main/mod-favorites.ts')
const settings = { language: 'tr', downloadSpeedLimitKiB: 0, pauseDownloadsWhilePlaying: false, downloadConcurrency: 4 }
const payload = Buffer.alloc(192 * 1024); for (let i = 0; i < payload.length; i++) payload[i] = i % 251
const sha1 = createHash('sha1').update(payload).digest('hex')
const requests = [], counts = new Map(), results = []
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async check => { for (let i = 0; i < 200; i++) { if (check()) return; await wait(20) } throw Error('Timed out') }
const server = createServer((req, res) => {
  if (req.url === '/runtime') { const data = Buffer.from('{"fixture":true}'); res.writeHead(200, { 'Content-Length': data.length }); res.end(data); return }
  const count = (counts.get(req.url) || 0) + 1; counts.set(req.url, count)
  const offset = Number(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0)
  requests.push({ url: req.url, offset, ifRange: req.headers['if-range'] })
  if (req.url === '/missing') { res.writeHead(404); res.end('missing'); return }
  const ranged = offset > 0 && req.url !== '/no-range' && req.url !== '/changed'
  const data = req.url === '/changed' && count > 1 ? Buffer.alloc(payload.length, 42) : req.url === '/checksum' && count === 1 ? Buffer.alloc(payload.length, 33) : payload
  res.writeHead(ranged ? 206 : 200, { 'Content-Length': data.length - (ranged ? offset : 0), 'Content-Type': 'application/octet-stream', ETag: req.url === '/changed' && count > 1 ? '"new"' : '"fixture"', 'Accept-Ranges': 'bytes', ...(ranged ? { 'Content-Range': `bytes ${offset}-${data.length - 1}/${data.length}` } : {}) })
  let position = ranged ? offset : 0
  const timer = setInterval(() => {
    if (['/disconnect', '/no-range', '/changed'].includes(req.url) && count === 1 && position >= 40 * 1024) { clearInterval(timer); res.destroy(); return }
    if (position >= data.length) { clearInterval(timer); res.end(); return }
    res.write(data.subarray(position, position + 2048)); position += 2048
  }, req.url === '/speed-uncached' ? 10 : 3)
  res.on('close', () => clearInterval(timer))
})
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  let manager = new DownloadManager(settings, () => {})
  const destination = name => path.join(root, name)
  const file = name => ({ urls: [url + '/' + name], destination: destination(name), size: payload.length, checksum: { algorithm: 'sha1', value: sha1 } })
  try {
    await manager.enqueue('Unknown Maven size', () => manager.runtime().download([{ path: destination('unknown-size.jar'), urls: [url + '/unknown-size'], size: -1, checksum: { algorithm: 'sha1', value: sha1 } }]))
    assert.ok(fs.readFileSync(destination('unknown-size.jar')).equals(payload))
    assert.equal(manager.snapshot().jobs.find(job => job.title === 'Unknown Maven size').totalBytes, payload.length)
    results.push('Unknown XMCL Maven size -1 accepts a valid response and records its real byte count')
    const before404 = Date.now()
    await assert.rejects(manager.enqueue('Permanent HTTP failure', () => manager.download({ urls: [url + '/missing'], destination: destination('missing.jar') })), /Dosya indirilemedi \(404\).*missing.jar/)
    assert.equal(counts.get('/missing'), 1)
    assert.ok(Date.now() - before404 < 1500)
    assert.ok(!fs.existsSync(destination('missing.jar')))
    await manager.enqueue('HTTP mirror', () => manager.download({ urls: [url + '/missing', url + '/good-mirror'], destination: destination('mirror.jar'), checksum: { algorithm: 'sha1', value: sha1 } }))
    assert.equal(counts.get('/missing'), 2)
    assert.ok(fs.readFileSync(destination('mirror.jar')).equals(payload))
    results.push('Permanent 404 is attempted once and valid mirrors are used immediately without reconnect loops')
    fs.writeFileSync(destination('speed-cached'),payload)
    const speedCheck = manager.enqueue('Cache speed',()=>Promise.all([manager.download(file('speed-cached')),manager.download(file('speed-uncached'))]))
    await until(()=>manager.snapshot().jobs.find(job=>job.title==='Cache speed').bytesPerSecond>0)
    assert.ok(manager.snapshot().jobs.find(job=>job.title==='Cache speed').bytesPerSecond<400000)
    await speedCheck; results.push('Cached and resumed disk bytes are excluded from the network speed')
    const phaseCheck = manager.enqueue('Mixed transfer phases', () => Promise.all([manager.download(file('phase-main')),manager.download({urls:[url+'/runtime'],destination:destination('phase-small')})]))
    await until(()=>manager.snapshot().jobs.find(job=>job.title==='Mixed transfer phases').filesDone===1)
    assert.equal(manager.snapshot().jobs.find(job=>job.title==='Mixed transfer phases').phase,'downloading')
    await phaseCheck; results.push('Finished small files do not hide an ongoing parallel download or its speed')
    await manager.enqueue('Reconnect', () => manager.download(file('disconnect')))
    assert.ok(fs.readFileSync(destination('disconnect')).equals(payload)); assert.ok(requests.some(r => r.url === '/disconnect' && r.offset > 0)); results.push('Disconnected streams resume with Range and checksum verification')
    const paused = manager.enqueue('Pause', () => manager.download(file('pause')))
    await until(() => fs.existsSync(destination('pause') + '.green-part') && fs.statSync(destination('pause') + '.green-part').size >= 20 * 1024)
    const job = manager.snapshot().jobs.find(j => j.title === 'Pause')
    manager.control('pause', job.id); await wait(120)
    const held = fs.statSync(destination('pause') + '.green-part').size; await wait(200)
    assert.equal(fs.statSync(destination('pause') + '.green-part').size, held); assert.equal(manager.snapshot().jobs.find(j => j.id === job.id).phase, 'paused')
    manager.control('resume', job.id); await paused
    assert.ok(fs.readFileSync(destination('pause')).equals(payload)); assert.ok(requests.some(r => r.url === '/pause' && r.offset > 0 && r.ifRange === '"fixture"')); results.push('Pause preserves partial bytes and resume uses If-Range')
    await manager.enqueue('No ranges', () => manager.download(file('no-range')))
    assert.ok(fs.readFileSync(destination('no-range')).equals(payload)); assert.ok(requests.some(r => r.url === '/no-range' && r.offset > 0)); results.push('A server ignoring Range restarts instead of appending duplicate bytes')
    await manager.enqueue('Changed representation', () => manager.download({ urls: [url + '/changed'], destination: destination('changed'), size: payload.length, replace: true }))
    assert.ok(fs.readFileSync(destination('changed')).equals(Buffer.alloc(payload.length, 42))); assert.ok(requests.some(r => r.url === '/changed' && r.ifRange === '"fixture"')); results.push('Changed ETag/200 response replaces the partial representation')
    await manager.enqueue('Checksum', () => manager.download(file('checksum')))
    assert.ok(fs.readFileSync(destination('checksum')).equals(payload)); assert.equal(counts.get('/checksum'), 2); results.push('A corrupt transfer is rejected and replaced before installation')
    manager.configure({ ...settings, downloadSpeedLimitKiB: 96 })
    const start = Date.now()
    await manager.enqueue('Aggregate limit', () => Promise.all(['limit-a', 'limit-b'].map(name => manager.download(file(name)))))
    assert.ok(Date.now() - start >= 3700, '384 KiB is limited to 96 KiB/s across both files'); results.push('Each installation has its own speed budget, shared by its file workers')
    manager.configure({ ...settings, downloadSpeedLimitKiB: 1 })
    const changing = manager.enqueue('Live limit change', () => manager.download(file('live-limit')))
    await until(() => counts.has('/live-limit')); await wait(80)
    const changedAt = Date.now(); manager.configure(settings); await changing
    assert.ok(Date.now() - changedAt < 2000); results.push('Changing the speed limit wakes active throttled transfers immediately')
    const playingPause = manager.enqueue('Active game pause', () => manager.download(file('playing-pause')))
    await until(() => fs.existsSync(destination('playing-pause') + '.green-part') && fs.statSync(destination('playing-pause') + '.green-part').size >= 20 * 1024)
    manager.configure({ ...settings, pauseDownloadsWhilePlaying: true }); manager.setPlaying(true); await wait(120)
    const playingHeld = fs.statSync(destination('playing-pause') + '.green-part').size; await wait(200)
    assert.equal(fs.statSync(destination('playing-pause') + '.green-part').size, playingHeld)
    manager.setPlaying(false); await playingPause
    assert.ok(fs.readFileSync(destination('playing-pause')).equals(payload)); results.push('A running transfer pauses when a game opens and resumes when it closes')
    manager.configure(settings)
    const order = []; let release
    const active = manager.enqueue('Active', () => new Promise(resolve => { release = () => { order.push('active'); resolve() } }))
    const background = manager.enqueue('Background', async () => { order.push('background') })
    manager.control('prioritize', manager.snapshot().jobs.find(job => job.title === 'Background').id)
    const launch = manager.enqueue('Launch', async () => { order.push('launch') }, { forLaunch: true, profileId: 'play-profile' })
    release(); await Promise.all([active, background, launch]); assert.deepEqual(order, ['active', 'launch', 'background']); results.push('Launch jobs precede queued background jobs')
    manager.setPlaying(true)
    let defaultRan = false; await manager.enqueue('Default background', async () => { defaultRan = true }); assert.ok(defaultRan)
    manager.configure({ ...settings, pauseDownloadsWhilePlaying: true })
    let blockedRan = false
    const blocked = manager.enqueue('Game pause', async () => { blockedRan = true })
    await wait(150); assert.equal(blockedRan, false)
    await manager.enqueue('Additional game', async () => {}, { forLaunch: true })
    manager.setPlaying(false); await blocked; assert.ok(blockedRan); results.push('Game pause is off by default, blocks background work when enabled, and exempts launch prerequisites')
    let completeActive
    const serialOrder = []
    const serialActive = manager.enqueue('Drag active', () => new Promise(resolve => { completeActive = () => { serialOrder.push('active'); resolve() } }))
    const serialA = manager.enqueue('Pending one', async () => { serialOrder.push('one') })
    const serialB = manager.enqueue('Pending two', async () => { serialOrder.push('two') })
    const serialIds = Object.fromEntries(manager.snapshot().jobs.filter(j => ['Drag active','Pending one','Pending two'].includes(j.title)).map(j => [j.title,j.id]))
    manager.control('reorder', serialIds['Pending two'], serialIds['Drag active'])
    manager.control('reorder', serialIds['Drag active'])
    await wait(50); assert.deepEqual(serialOrder, [])
    completeActive(); await Promise.all([serialActive, serialA, serialB]); assert.deepEqual(serialOrder, ['active','two','one'])
    results.push('Dragging active and queued cards changes the queue without interrupting serial installation')
    let endMetric
    const metricPromise = manager.enqueue('Metrics', () => new Promise(resolve => { endMetric = resolve }))
    const metricJob = manager.jobs.find(j => j.title === 'Metrics')
    metricJob.phase = 'downloading'; metricJob.totalBytes = 100000; metricJob.downloadedBytes = 4000; metricJob.transferredBytes = 4000
    metricJob.lastAt = Date.now() - 4000
    const metric = manager.snapshot().jobs.find(j => j.title === 'Metrics')
    assert.ok(metric.bytesPerSecond >= 990 && metric.bytesPerSecond <= 1010); assert.ok(metric.peakBytesPerSecond >= 990); assert.ok(metric.estimatedSeconds >= 95 && metric.estimatedSeconds <= 98)
    metricJob.lastAt -= 400; metricJob.downloadedBytes += 4000; metricJob.transferredBytes += 4000
    assert.equal(manager.snapshot().jobs.find(j => j.title === 'Metrics').estimatedSeconds, metric.estimatedSeconds)
    manager.control('pause', metricJob.id); const pausedMetric = manager.snapshot().jobs.find(j => j.title === 'Metrics')
    assert.equal(pausedMetric.bytesPerSecond, 0); assert.equal(pausedMetric.estimatedSeconds, undefined); assert.ok(pausedMetric.peakBytesPerSecond > 0)
    manager.control('resume', metricJob.id); endMetric(); await metricPromise
    results.push('Speed is smoothed, peak is retained, ETA updates at five-second intervals, and paused ETA is hidden')
    manager.control('pause-all'); const manualOrder = []
    const first = manager.enqueue('First', async () => { manualOrder.push('first') })
    const second = manager.enqueue('Second', async () => { manualOrder.push('second') })
    const secondId = manager.snapshot().jobs.find(j => j.title === 'Second').id
    manager.control('prioritize', secondId); manager.control('resume-all'); await Promise.all([first, second]); assert.deepEqual(manualOrder, ['second', 'first']); results.push('Manual queue priority and pause all work')
    manager.control('pause-all'); const dragOrder = []
    const dragged = ['A','B','C'].map(name => manager.enqueue(`Drag ${name}`, async () => { dragOrder.push(name) }))
    const ids = Object.fromEntries(manager.snapshot().jobs.filter(j => j.title.startsWith('Drag ')).map(j => [j.title.slice(5),j.id]))
    manager.control('reorder',ids.C,ids.A)
    manager.control('reorder',ids.C,ids.B)
    manager.control('reorder',ids.A)
    assert.throws(()=>manager.control('reorder',ids.B,'missing'))
    manager.control('resume-all'); await Promise.all(dragged); assert.deepEqual(dragOrder,['C','B','A']); results.push('Drag reordering handles first, middle and last positions including equal priorities')
    assert.ok(manager.snapshot().concurrency>=2 && manager.snapshot().concurrency<=8)
    manager.configure({...settings,downloadSpeedLimitKiB:64}); assert.equal(manager.snapshot().concurrency,1); manager.configure(settings); results.push('Concurrency is chosen automatically from hardware and the speed limit')
    const runtimeFile = destination('runtime.json'), json = Buffer.from('{"fixture":true}')
    await manager.enqueue('Runtime', () => manager.runtime().download([{ path: runtimeFile, urls: [url + '/runtime'], size: json.length, checksum: { algorithm: 'sha1', value: createHash('sha1').update(json).digest('hex') }, validator: 'json' }])).catch(error => { throw error })
    assert.ok(fs.readFileSync(runtimeFile).equals(json)); results.push('XMCL runtime validates managed JSON downloads')
  } finally { manager.dispose() }
  const favorite = { projectId: 'test1234', provider: 'modrinth', contentType: 'mod', slug: 'fixture', title: 'Fixture', description: 'Saved fixture', author: 'QA', iconUrl: null, downloads: 0, updated: '', categories: [], savedAt: new Date().toISOString() }
  const favoritesPath = destination('favorites.json'), favorites = new ModFavorites(favoritesPath)
  favorites.set(favorite, true); favorites.set({ ...favorite, provider: 'technic', contentType: 'modpack' }, true)
  assert.equal(new ModFavorites(favoritesPath).get().length, 2)
  favorites.set(favorite, false); assert.equal(new ModFavorites(favoritesPath).get()[0].provider, 'technic'); results.push('Favorites persist with provider identity and independent removal')
  fs.writeFileSync('build/qa-download-manager-results.json', JSON.stringify({ passed: true, results }, null, 2))
  for (const result of results) console.log('PASS', result)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { server.closeAllConnections(); server.close() })
