const { mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')
const {
  DEFAULT_RUNTIME_ALL_URL,
  createJavaRuntimeInstallWorkflow,
  createDefaultNodeInstallRuntime,
  executeInstallWorkflow,
  resolveJava
} = require('@xmcl/installer')

async function main() {
  const component = 'java-runtime-epsilon'
  const all = await fetch(DEFAULT_RUNTIME_ALL_URL).then(response => response.json())
  const target = all['windows-x64'][component][0]
  const destination = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'green-launcher', 'java', component)
  mkdirSync(destination, { recursive: true })
  console.log(`Installing ${target.version.name} to ${destination}`)
  await executeInstallWorkflow(createJavaRuntimeInstallWorkflow({ target, destination }), createDefaultNodeInstallRuntime({ maxConcurrency: 12 }), {
    onEvent: event => { if (event.type === 'task-end') console.log(`Completed ${event.task.id}`) }
  })
  const java = await resolveJava(join(destination, 'bin', 'javaw.exe'))
  if (java?.majorVersion !== 25) throw new Error('Java 25 verification failed')
  console.log(`Verified Java ${java.version}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
