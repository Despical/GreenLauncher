const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), ts = require('typescript'), core = require('@xmcl/core'), { execFile } = require('node:child_process'), { promisify } = require('node:util'), { createHash } = require('node:crypto')
const original = path.join(process.env.APPDATA, '.minecraft', 'versions', '1.8.9-SPECIAL')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'green-custom-runtime-')), resourcePath = path.join(root, 'minecraft')
const java = path.join(process.env.APPDATA, 'GreenLauncher', 'java', 'java-runtime-epsilon', 'bin', 'javaw.exe')
let child, captured = ''
function load(file, mocks = {}) {
  const mod = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(source, { module: mod, exports: mod.exports, require: name => mocks[name] ?? (name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts'), mocks) : require(name)), structuredClone, Buffer, URL, AbortSignal, console, process, setTimeout, clearTimeout })
  return mod.exports
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const before = hash(path.join(original, '1.8.9-SPECIAL.jar'))
const state = { settings: { javaPath: '', memoryMb: 2048, width: 960, height: 540, closeOnLaunch: false }, profiles: [], accounts: [{ id: '1234567812343234a234123456781234', name: 'GreenQA', kind: 'offline' }], selectedAccountId: '1234567812343234a234123456781234' }
const store = { dataPath: root, minecraftPath: resourcePath, get: () => structuredClone(state) }
async function main() {
  const { CustomClients } = load('src/main/custom-clients.ts')
  await new CustomClients(resourcePath).import(original)
  const { customJavaVersion, customRuntime } = load('src/main/custom-runtime.ts')
  const folder = new core.MinecraftFolder(resourcePath), parsed = await core.Version.parse(folder, '1.8.9-SPECIAL')
  const required = await customJavaVersion(parsed, folder), natives = await customRuntime(parsed, folder)
  if (required.javaVersion.majorVersion !== 25 || natives.providedNatives.size !== parsed.libraries.filter(library => library.isNative).length) throw new Error('Expected Java 25 and all native libraries from the selected folder')
  const { GameService } = load('src/main/game.ts', { electron: {}, './download-manager': { getDownloadManager: () => undefined }, '@xmcl/core': { ...core, launch: async options => {
    child = await core.launch({ ...options, extraJVMArgs: ['-Duser.home=' + root], extraExecOption: { ...options.extraExecOption, env: { ...process.env, APPDATA: root } } })
    const capture = data => { if (captured.length < 2_000_000) captured += data.toString() }
    child.stdout?.on('data', capture); child.stderr?.on('data', capture)
    return child
  } } })
  const game = new GameService(store, {}, () => null, () => {})
  game.javaRuntimes = async () => [{ path: java }]
  await game.play(null, '1.8.9-SPECIAL')
  console.log(JSON.stringify({ started: true, pid: child.pid, javaRequired: required.javaVersion.majorVersion, suppliedNativeLibraries: natives.providedNatives.size, testDirectory: root }))
  await new Promise(resolve => setTimeout(resolve, 25000))
  fs.writeFileSync('build/qa-custom-client-output.txt', captured)
  if (child.exitCode !== null) throw new Error('Client exited: ' + child.exitCode + '. See build/qa-custom-client-output.txt')
  const threads = await promisify(execFile)(path.join(path.dirname(java), 'jcmd.exe'), [String(child.pid), 'Thread.print'], { windowsHide: true, maxBuffer: 4 * 1024 ** 2, timeout: 10000 })
  fs.writeFileSync('build/qa-custom-client-threads.txt', threads.stdout)
  const render = threads.stdout.split('\n\n').find(block => /"(Client thread|Render thread|main)"/.test(block)) ?? ''
  fs.writeFileSync('build/qa-custom-client-results.json', JSON.stringify({ alive: true, sourceUnchanged: before === hash(path.join(original, '1.8.9-SPECIAL.jar')), javaRequired: required.javaVersion.majorVersion, suppliedNativeLibraries: natives.providedNatives.size, renderThread: render }, null, 2))
  console.log(JSON.stringify({ alive: true, sourceUnchanged: before === hash(path.join(original, '1.8.9-SPECIAL.jar')), renderThread: render }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 3000) }) }
  if (path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(root).startsWith('green-custom-runtime-')) await fs.promises.rm(root, { recursive: true, force: true })
})
