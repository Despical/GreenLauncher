const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const file = path.join(__dirname, '../src/main/metadata-cache.ts')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const moduleValue = { exports: {} }
vm.runInNewContext(compiled, { module: moduleValue, exports: moduleValue.exports, structuredClone, Buffer }, { filename: file })
const { MetadataCache } = moduleValue.exports

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

let checks = 0
async function check(name, run) {
  await run()
  checks++
  console.log('PASS', name)
}

async function main() {
  await check('TTL starts when a response completes and expires exactly at the boundary', async () => {
    let now = 1000, calls = 0
    const cache = new MetadataCache(100, 8, 1024, () => now)
    const response = deferred()
    const first = cache.get('catalog', () => { calls++; return response.promise })
    await Promise.resolve()
    now = 5000
    response.resolve({ revision: calls })
    assert.deepEqual(await first, { revision: 1 })
    now = 5099
    assert.deepEqual(await cache.get('catalog', async () => ({ revision: ++calls })), { revision: 1 })
    assert.equal(calls, 1)
    now = 5100
    assert.deepEqual(await cache.get('catalog', async () => ({ revision: ++calls })), { revision: 2 })
    assert.equal(calls, 2)
  })

  await check('concurrent requests share one fetch and receive independent values', async () => {
    const cache = new MetadataCache()
    const response = deferred()
    let calls = 0
    const fetchValue = () => { calls++; return response.promise }
    const requests = Array.from({ length: 8 }, () => cache.get('search', fetchValue))
    await Promise.resolve()
    assert.equal(calls, 1)
    response.resolve({ hits: [{ title: 'Original' }] })
    const values = await Promise.all(requests)
    values[0].hits[0].title = 'Changed'
    assert.equal(values[1].hits[0].title, 'Original')
    assert.notStrictEqual(values[1], values[2])
    assert.notStrictEqual(values[1].hits, values[2].hits)
    assert.equal((await cache.get('search', fetchValue)).hits[0].title, 'Original')
    assert.equal(calls, 1)
  })

  await check('provider and caller mutations cannot change a cached response', async () => {
    const cache = new MetadataCache()
    const source = { project: { title: 'Original' }, versions: ['1.0'] }
    const result = await cache.get('project', async () => source)
    source.project.title = 'Provider mutation'
    source.versions.push('2.0')
    result.project.title = 'Caller mutation'
    result.versions.length = 0
    assert.deepEqual(await cache.get('project', async () => { throw Error('Unexpected refetch') }), { project: { title: 'Original' }, versions: ['1.0'] })
  })

  await check('entry bound evicts the least recently used value', async () => {
    const cache = new MetadataCache(1000, 2)
    const calls = { a: 0, b: 0, c: 0 }
    const get = key => cache.get(key, async () => ({ generation: ++calls[key] }))
    await get('a')
    await get('b')
    await get('a')
    await get('c')
    assert.deepEqual(await get('a'), { generation: 1 })
    assert.deepEqual(await get('b'), { generation: 2 })
    assert.deepEqual(calls, { a: 1, b: 2, c: 1 })
  })

  await check('byte bound accounts for UTF-8 data and evicts oldest values', async () => {
    const cache = new MetadataCache(1000, 8, 16)
    const calls = { a: 0, b: 0, c: 0 }
    const get = key => cache.get(key, async () => { calls[key]++; return 'ççç' }) // Eight JSON bytes, not five characters.
    await get('a')
    await get('b')
    await get('c')
    await get('b')
    assert.deepEqual(calls, { a: 1, b: 1, c: 1 })
    await get('a')
    assert.equal(calls.a, 2)
  })

  await check('oversized responses are delivered without evicting useful cached data', async () => {
    const cache = new MetadataCache(1000, 8, 16)
    let largeCalls = 0, smallCalls = 0
    const small = () => cache.get('small', async () => { smallCalls++; return 'tiny' })
    const large = () => cache.get('large', async () => { largeCalls++; return 'a'.repeat(64) })
    await small()
    assert.equal((await large()).length, 64)
    await large()
    assert.equal(largeCalls, 2)
    assert.equal(await small(), 'tiny')
    assert.equal(smallCalls, 1)
  })

  await check('expired entries release their byte budget before replacement', async () => {
    let now = 0, calls = 0
    const cache = new MetadataCache(10, 8, 8, () => now)
    await cache.get('item', async () => { calls++; return 'ççç' })
    now = 10
    await cache.get('item', async () => { calls++; return 'fresh' })
    assert.equal(await cache.get('item', async () => { calls++; return 'oops' }), 'fresh')
    assert.equal(calls, 2)
  })

  await check('shared fetch failures are retried on the next request', async () => {
    const cache = new MetadataCache()
    const response = deferred()
    let calls = 0
    const first = cache.get('project', () => { calls++; return response.promise })
    const second = cache.get('project', () => { calls++; return response.promise })
    const settled = Promise.allSettled([first, second])
    response.reject(Error('Temporary network error'))
    const failures = await settled
    assert.equal(calls, 1)
    for (const result of failures) {
      assert.equal(result.status, 'rejected')
      assert.match(result.reason.message, /Temporary network error/)
    }
    assert.equal(await cache.get('project', async () => { calls++; return 'recovered' }), 'recovered')
    assert.equal(calls, 2)
  })

  await check('synchronous provider failures do not poison the pending map', async () => {
    const cache = new MetadataCache()
    await assert.rejects(cache.get('project', () => { throw Error('Invalid provider response') }), /Invalid provider response/)
    assert.equal(await cache.get('project', async () => 'valid'), 'valid')
  })

  await check('clear removes cached values and resets entry and byte budgets', async () => {
    const cache = new MetadataCache(1000, 1, 8)
    let calls = 0
    const get = () => cache.get('same', async () => { calls++; return 'ççç' })
    await get()
    cache.clear()
    await get()
    await get()
    assert.equal(calls, 2)
  })

  await check('clear during a pending request keeps the replacement request deduplicated', async () => {
    const cache = new MetadataCache()
    const oldResponse = deferred(), newResponse = deferred()
    const oldRequest = cache.get('same', () => oldResponse.promise)
    await Promise.resolve()
    cache.clear()
    let replacementCalls = 0
    const replacement = cache.get('same', () => { replacementCalls++; return newResponse.promise })
    oldResponse.resolve('old')
    assert.equal(await oldRequest, 'old')
    const follower = cache.get('same', () => { replacementCalls++; return Promise.resolve('unexpected') })
    newResponse.resolve('new')
    assert.deepEqual(await Promise.all([replacement, follower]), ['new', 'new'])
    assert.equal(replacementCalls, 1)
    assert.equal(await cache.get('same', async () => 'unexpected'), 'new')
  })

  await check('a late response from before clear cannot overwrite fresh data', async () => {
    const cache = new MetadataCache()
    const oldResponse = deferred()
    const oldRequest = cache.get('same', () => oldResponse.promise)
    await Promise.resolve()
    cache.clear()
    assert.equal(await cache.get('same', async () => 'new'), 'new')
    oldResponse.resolve('old')
    assert.equal(await oldRequest, 'old')
    assert.equal(await cache.get('same', async () => 'unexpected'), 'new')
  })

  console.log(`Metadata cache: ${checks} deterministic checks passed.`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
