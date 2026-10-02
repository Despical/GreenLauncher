const { mkdirSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { MinecraftFolder, Version } = require('@xmcl/core')
const { getVersionList, createDefaultNodeInstallRuntime, resolveMinecraftVersionJsonInstallFile, resolveMinecraftJarInstallFile, resolveLibraryInstallFiles, resolveAssetMetadataInstallFiles } = require('@xmcl/installer')

async function main() {
  const root = resolve(__dirname, '..', 'tmp-installer-smoke')
  if (!root.startsWith(resolve(__dirname, '..') + require('node:path').sep)) throw new Error('Unsafe temp path')
  mkdirSync(root, { recursive: true })
  try {
    const latest = (await getVersionList()).versions.find(v => v.type === 'release')
    if (!latest) throw new Error('Release missing')
    const folder = new MinecraftFolder(root)
    mkdirSync(folder.getVersionRoot(latest.id), { recursive: true })
    await createDefaultNodeInstallRuntime().download([resolveMinecraftVersionJsonInstallFile(latest, folder)])
    const version = await Version.parse(folder, latest.id)
    const jar = resolveMinecraftJarInstallFile(version)
    const libraries = resolveLibraryInstallFiles(version.libraries, folder)
    const assets = resolveAssetMetadataInstallFiles(version, folder)
    if (!jar || !libraries.length || !assets.length) throw new Error('Incomplete install plan')
    console.log(JSON.stringify({ version: latest.id, java: version.javaVersion, libraries: libraries.length, metadataFiles: assets.length, jar: join('versions', latest.id, `${latest.id}.jar`) }))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
