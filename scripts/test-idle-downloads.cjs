const assert = require('node:assert/strict')
const { DownloadManager } = require('./test-source.cjs').createSourceLoader()('src/main/download-manager.ts')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const events = [], manager = new DownloadManager({ downloadConcurrency: 4 }, snapshot => events.push(snapshot))
;(async () => {
  try {
    await delay(1250)
    assert.equal(events.length, 0, 'idle launcher receives no periodic snapshots')
    manager.setPlaying(true)
    const changed = events.length
    manager.setPlaying(true)
    await delay(450)
    assert.equal(events.length, changed, 'identical state does not rerender the launcher')
    let finish
    const gate = new Promise(resolve => { finish = resolve })
    const job = manager.enqueue('Fixture', async () => { await gate })
    await delay(550)
    assert.ok(events.some(event => event.jobs.some(job => job.title === 'Fixture')), 'live preparation remains visible')
    finish(); await job; await delay(20)
    assert.equal(manager.pending, false)
    assert.equal(events.at(-1).jobs.length, 0, 'rapid completion is published immediately')
    const completed = events.length
    await delay(850)
    assert.equal(events.length, completed, 'polling stops after the last job finishes')
    console.log('PASS idle snapshots, duplicate state suppression, active preparation, immediate completion and idle timer shutdown')
  } finally { manager.dispose() }
})().catch(error => { console.error(error); process.exitCode = 1 })
