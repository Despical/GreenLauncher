import { copyFile, lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { LaunchPrecheck, Version, type MinecraftFolder, type ResolvedVersion, type LaunchOption } from '@xmcl/core'
import { open } from 'yauzl'

export async function customResolvedVersion(version: ResolvedVersion, folder: MinecraftFolder): Promise<ResolvedVersion> {
  const libraries = [...version.libraries]
  // Some custom descriptors combine a Java artifact and native classifiers in
  // one library entry. XMCL selects only the native classifier for that shape.
  // Keep the Java artifact on the classpath as well.
  for (const id of version.inheritances) {
    const descriptor = JSON.parse(await readFile(folder.getVersionJson(id), 'utf8')) as { libraries?: Version.Library[] }
    for (const library of descriptor.libraries ?? []) {
      if (!('natives' in library) || !library.downloads?.artifact) continue
      const { natives: _natives, ...artifact } = library
      const resolved = Version.resolveLibrary(artifact)
      if (resolved && !libraries.some(item => !item.isNative && item.groupId === resolved.groupId && item.artifactId === resolved.artifactId && item.classifier === resolved.classifier)) libraries.push(resolved)
    }
  }
  return { ...version, libraries }
}

async function classJavaVersion(jar: string, mainClass: string): Promise<number | undefined> {
  return new Promise(resolve => {
    open(jar, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) { resolve(undefined); return }
      let settled = false
      const finish = (value?: number) => { if (settled) return; settled = true; zip.close(); resolve(value) }
      zip.on('error', () => finish()); zip.on('end', () => finish())
      zip.on('entry', entry => {
        if (entry.fileName !== `${mainClass.replaceAll('.', '/')}.class`) { zip.readEntry(); return }
        if (entry.uncompressedSize > 2_000_000) { finish(); return }
        zip.openReadStream(entry, (reason, stream) => {
          if (reason || !stream) { finish(); return }
          let header = Buffer.alloc(0)
          stream.on('error', () => finish()); stream.on('data', chunk => { if (header.length < 8) header = Buffer.concat([header, chunk.subarray(0, 8 - header.length)]) })
          stream.on('end', () => { finish(header.length === 8 && header.readUInt32BE(0) === 0xcafebabe ? header.readUInt16BE(6) - 44 : undefined) })
        })
      })
      zip.readEntry()
    })
  })
}

export async function customJavaVersion(version: ResolvedVersion, folder: MinecraftFolder): Promise<ResolvedVersion> {
  let required = await classJavaVersion(folder.getVersionJar(version.minecraftVersion), version.mainClass)
  if (!required) for (const library of version.libraries.filter(item => !item.isNative)) {
    required = await classJavaVersion(folder.getLibraryByPath(library.download.path), version.mainClass)
    if (required) break
  }
  if (!required || required <= (version.javaVersion?.majorVersion ?? 8)) return version
  const components: Record<number, string> = { 8: 'jre-legacy', 16: 'java-runtime-alpha', 17: 'java-runtime-gamma', 21: 'java-runtime-delta', 25: 'java-runtime-epsilon' }
  return { ...version, javaVersion: { majorVersion: required, component: components[required] ?? '' } }
}

// Imported clients can deliberately replace Mojang libraries. Check that their
// files exist, without replacing a working client with upstream SHA-1 versions.
export async function customRuntime(version: ResolvedVersion, folder: MinecraftFolder): Promise<{ nativeRoot: string; providedNatives: Set<string>; prechecks: LaunchPrecheck[] }> {
  const source = join(folder.getVersionRoot(version.id), 'natives')
  const nativeRoot = join(folder.getVersionRoot(version.id), '.greenlauncher-natives')
  const files = new Map<string, string>()
  const walk = async (directory: string, depth = 0): Promise<void> => {
    if (depth > 8) return
    const info = await lstat(directory).catch(() => undefined)
    if (!info?.isDirectory() || info.isSymbolicLink()) return
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink() || item.name === 'META-INF') continue
      if (item.isDirectory()) {
        if (['x86', 'ia32', 'x64', 'arm64'].includes(item.name) && item.name !== process.arch && !(item.name === 'x86' && process.arch === 'ia32')) continue
        if (['windows', 'linux', 'macos'].includes(item.name) && item.name !== ({ win32: 'windows', darwin: 'macos', linux: 'linux' } as Record<string, string>)[process.platform]) continue
        await walk(join(directory, item.name), depth + 1)
      } else if (item.isFile() && /\.(dll|so|dylib|jnilib)$/i.test(item.name)) {
        const path = join(directory, item.name)
        if ((await lstat(path)).size > 0 && !files.has(item.name.toLowerCase())) files.set(item.name.toLowerCase(), path)
      }
    }
  }
  await walk(source)
  const has = (...names: string[]) => names.some(name => files.has(name.toLowerCase()))
  const supplied = (name: string) => {
    if (process.platform !== 'win32') return false
    if (/^org.lwjgl:lwjgl:3\./.test(name)) return has('lwjgl.dll')
    if (/^org.lwjgl:lwjgl-(glfw|opengl|openal|stb):/.test(name)) return has(({ glfw: 'glfw.dll', opengl: 'lwjgl_opengl.dll', openal: 'OpenAL.dll', stb: 'lwjgl_stb.dll' } as Record<string, string>)[name.split(':')[1].slice(6)])
    if (/^org.lwjgl.lwjgl:lwjgl-platform:/.test(name)) return has(process.arch === 'x64' ? 'lwjgl64.dll' : 'lwjgl.dll') && has(process.arch === 'x64' ? 'OpenAL64.dll' : 'OpenAL32.dll')
    if (/^net.java.jinput:jinput-platform:/.test(name)) return has(process.arch === 'x64' ? 'jinput-raw_64.dll' : 'jinput-raw.dll')
    if (/^tv.twitch:twitch-platform:/.test(name)) return has('twitchsdk.dll')
    if (/^tv.twitch:twitch-external-platform:/.test(name)) return has('avutil-ttv-51.dll', 'libmfxsw64.dll')
    return false
  }
  const providedNatives = new Set(version.libraries.filter(library => library.isNative && supplied(library.name)).map(library => library.name))
  const requireFile = async (path: string) => { const info = await lstat(path).catch(() => undefined); if (!info?.isFile() || !info.size || info.isSymbolicLink()) throw new Error(`İstemci dosyası bulunamadı: ${basename(path)}`) }
  const prechecks: LaunchPrecheck[] = [
    async resource => { await requireFile(resource.getVersionJar(version.minecraftVersion)) },
    async resource => { await Promise.all(version.libraries.filter(library => !providedNatives.has(library.name)).map(library => requireFile(resource.getLibraryByPath(library.download.path)))) },
    async (resource, resolved, options: LaunchOption) => {
      const missing = resolved.libraries.filter(library => library.isNative && !providedNatives.has(library.name))
      if (missing.length) await LaunchPrecheck.checkNatives(resource, { ...resolved, libraries: missing }, { ...options, nativeRoot })
      await mkdir(nativeRoot, { recursive: true })
      for (const path of files.values()) {
        const destination = join(nativeRoot, basename(path)), existing = await lstat(destination).catch(() => undefined)
        // Windows locks DLLs loaded by another session. Identical files need no rewrite.
        if (existing?.isFile() && existing.size === (await lstat(path)).size) {
          const digest = async (file: string) => createHash('sha256').update(await readFile(file)).digest('hex')
          if (await digest(path) === await digest(destination)) continue
        }
        await copyFile(path, destination)
      }
    },
    LaunchPrecheck.linkAssets
  ]
  return { nativeRoot, providedNatives, prechecks }
}
