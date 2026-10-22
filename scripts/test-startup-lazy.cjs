const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-startup-lazy-'))
let xbox = 0, mojang = 0
const account = { id: 'fixture-account', name: 'StartupQA', kind: 'microsoft' }
const dependencies = {
  electron: { app: { getPath: () => root }, safeStorage: { isEncryptionAvailable: () => false } },
  '@xmcl/user': {
    MicrosoftAuthenticator: class {
      constructor() { xbox++ }
      async acquireXBoxToken() { return { minecraftXstsResponse: { DisplayClaims: { xui: [{ uhs: 'fixture' }] }, Token: 'fixture' } } }
      async loginMinecraftWithXBox() { return { access_token: 'fixture-not-a-credential', expires_in: 3600 } }
    },
    MojangClient: class {
      constructor() { mojang++ }
      async getProfile() { return { id: account.id, capes: [] } }
    }
  }
}
const load = require('./test-source.cjs').createSourceLoader({ dependencies })
const { AccountService } = load('src/main/auth.ts')
const service = new AccountService({})
;(async () => {
  assert.equal(service.hasCachedLaunchToken(account), false)
  assert.equal(xbox + mojang, 0, 'opening the launcher does not construct online authentication clients')
  service.cache[account.id] = { minecraftAccessToken: 'fixture-not-a-credential', minecraftExpiresAt: Date.now() + 3600000 }
  assert.equal(await service.getLaunchToken(account), 'fixture-not-a-credential')
  assert.equal(xbox + mojang, 0, 'a valid cached launch token does not load online clients')
  await service.minecraftToken('fixture')
  await service.minecraftToken('fixture')
  assert.equal(xbox, 1, 'first online exchange constructs one reusable Xbox client')
  assert.equal(mojang, 0)
  service.getLaunchToken = async () => 'fixture-not-a-credential'
  await service.getProfileCapes(account); await service.getProfileCapes(account)
  assert.equal(mojang, 1, 'first profile request constructs one reusable Mojang client')
  console.log('PASS lazy authentication initialization, first-use token/profile requests and client reuse; isolated mocked services')
})().catch(error => { console.error(error); process.exitCode = 1 })
