const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MinecraftFolder, Version } = require('@xmcl/core')
const { createDefaultNodeInstallRuntime, executeInstallManifest, resolveOptifineInstallManifest } = require('@xmcl/installer')

const [installer, baseId, java] = process.argv.slice(2)
if (!installer || !baseId || !java) throw new Error('Usage: node scripts/smoke-optifine.cjs <installer.jar> <base-version> <java.exe>')
const source = new MinecraftFolder(path.join(process.env.APPDATA, '.minecraft'))
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'green-launcher-optifine-smoke-'))
const folder = new MinecraftFolder(scratch)

async function main() {
  fs.mkdirSync(folder.getVersionRoot(baseId), { recursive: true })
  fs.copyFileSync(source.getVersionJson(baseId), folder.getVersionJson(baseId))
  fs.copyFileSync(source.getVersionJar(baseId), folder.getVersionJar(baseId))
  const { version, plan } = await resolveOptifineInstallManifest(installer, folder, { java })
  if (!version.toLowerCase().startsWith(`${baseId}-optifine_`.toLowerCase())) throw new Error(`Unexpected version: ${version}`)
  for (const task of plan.tasks) if (task.type === 'java') {
    for (const output of task.outputs) fs.mkdirSync(path.dirname(output.path), { recursive: true })
  }
  await executeInstallManifest(plan, createDefaultNodeInstallRuntime({ maxConcurrency: 2 }))
  const resolved = await Version.parse(folder, version)
  console.log(JSON.stringify({ version: resolved.id, mainClass: resolved.mainClass, inheritance: resolved.inheritances }))
}

main().finally(() => {
  const tempRoot = fs.realpathSync(os.tmpdir())
  const target = fs.realpathSync(scratch)
  if (target.startsWith(tempRoot + path.sep) && path.basename(target).startsWith('green-launcher-optifine-smoke-')) {
    fs.rmSync(target, { recursive: true, force: true })
  }
}).catch(error => { console.error(error); process.exitCode = 1 })
