import { lstat, mkdir, readFile, readdir, rename, rm, copyFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const versionId = /^(?!\.\.?$)[a-zA-Z0-9._-]{1,90}$/
type Descriptor = { id: string; inheritsFrom?: string; jar?: string; mainClass?: string; assets?: string; assetIndex?: { id: string }; greenLauncherCustom?: boolean;
  libraries?: Array<{ name: string; downloads?: { artifact?: { path?: string }; classifiers?: Record<string, { path?: string }> } }> }
const exists = async (path: string) => { try { await lstat(path); return true } catch { return false } }
function within(root: string, name: string): string {
  if (!name || /[\\:]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('İstemci dosya yolu geçersiz.')
  const path = resolve(root, name), rel = relative(resolve(root), path)
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith(sep)) throw new Error('İstemci dosya yolu geçersiz.')
  return path
}
async function regular(path: string): Promise<boolean> { const info = await lstat(path); if (info.isSymbolicLink()) throw new Error('İstemci klasörü bağlantı dosyaları içeremez.'); return info.isFile() }
async function copyTree(source: string, target: string, budget: { files: number; bytes: number }, depth = 0): Promise<void> {
  const info = await lstat(source)
  if (info.isSymbolicLink() || !info.isDirectory() || depth > 32) throw new Error('İstemci klasörü geçersiz.')
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name), stat = await lstat(from)
    if (stat.isSymbolicLink()) throw new Error('İstemci klasörü bağlantı dosyaları içeremez.')
    if (stat.isDirectory()) await copyTree(from, to, budget, depth + 1)
    else if (stat.isFile()) {
      budget.files++; budget.bytes += stat.size
      if (budget.files > 75_000 || budget.bytes > 8 * 1024 ** 3) throw new Error('İstemci klasörü çok büyük.')
      await copyFile(from, to)
    }
  }
}
function coordinates(name: string): string | undefined {
  const match = name.match(/^([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.+-]+)(?::([a-zA-Z0-9_.-]+))?(?:@([a-zA-Z0-9]+))?$/)
  if (!match) return
  return `${match[1].replaceAll('.', '/')}/${match[2]}/${match[3]}/${match[2]}-${match[3]}${match[4] ? `-${match[4]}` : ''}.${match[5] ?? 'jar'}`
}

export class CustomClients {
  constructor(private readonly minecraftPath: string, private readonly installBase?: (id: string) => Promise<void>) {}
  async import(directory: string): Promise<string> {
    const source = resolve(directory), id = basename(source), sourceRoot = basename(dirname(source)).toLowerCase() === 'versions' ? dirname(dirname(source)) : undefined
    if (!versionId.test(id)) throw new Error('İstemci klasörünün adı geçerli bir sürüm kimliği olmalı.')
    const destination = join(this.minecraftPath, 'versions', id)
    if (await exists(destination)) throw new Error('Bu sürüm zaten yüklü. Önce başka bir istemci klasörü seçin.')
    const stage = join(this.minecraftPath, `.custom-import-${randomUUID()}`)
    const budget = { files: 0, bytes: 0 }, descriptors = new Map<string, Descriptor>(), missingBases = new Set<string>()
    await mkdir(stage, { recursive: true })
    try {
      const inspect = async (version: string, selected = false) => {
        if (!versionId.test(version)) throw new Error('İstemci sürüm bilgisi geçersiz.')
        if (descriptors.has(version)) throw new Error('İstemci sürüm bağımlılıkları döngü içeriyor.')
        if (descriptors.size > 16) throw new Error('İstemci çok fazla sürüm bağımlılığı içeriyor.')
        const folder = selected ? source : sourceRoot ? join(sourceRoot, 'versions', version) : ''
        const owned = join(this.minecraftPath, 'versions', version)
        const jsonPath = folder && join(folder, `${version}.json`)
        if (!jsonPath || !(await exists(jsonPath))) {
          if (await exists(join(owned, `${version}.json`))) return
          if (this.installBase) { missingBases.add(version); return }
          throw new Error('İstemci için gerekli temel Minecraft sürümü bulunamadı.')
        }
        if (!(await regular(jsonPath)) || (await lstat(jsonPath)).size > 2_000_000) throw new Error('İstemci sürüm bilgisi geçersiz.')
        const parsed = JSON.parse(await readFile(jsonPath, 'utf8')) as Descriptor
        if (!parsed || parsed.id !== version || (parsed.inheritsFrom && !versionId.test(parsed.inheritsFrom)) || (parsed.jar && !versionId.test(parsed.jar)) || (parsed.libraries && !Array.isArray(parsed.libraries))) throw new Error('İstemci sürüm bilgisi geçersiz.')
        if (!parsed.inheritsFrom && (!parsed.mainClass || typeof parsed.mainClass !== 'string' || !/^[\w.$]+$/.test(parsed.mainClass))) throw new Error('İstemci ana sınıfı bulunamadı.')
        descriptors.set(version, parsed)
        if (selected || !(await exists(owned))) await copyTree(folder, join(stage, 'versions', version), budget)
        if (parsed.inheritsFrom) await inspect(parsed.inheritsFrom)
        if (parsed.jar && parsed.jar !== version && parsed.jar !== parsed.inheritsFrom) await inspect(parsed.jar)
        if (!parsed.inheritsFrom && !(await exists(join(folder, `${parsed.jar ?? version}.jar`))) && !(parsed.jar && (await exists(join(sourceRoot ?? this.minecraftPath, 'versions', parsed.jar, `${parsed.jar}.jar`)) || await exists(join(this.minecraftPath, 'versions', parsed.jar, `${parsed.jar}.jar`))))) throw new Error('İstemci oyun dosyası bulunamadı.')
      }
      await inspect(id, true)
      const stagedJson = join(stage, 'versions', id, `${id}.json`)
      const selected = descriptors.get(id)!
      const { writeFile } = await import('node:fs/promises')
      await writeFile(stagedJson, JSON.stringify({ ...selected, greenLauncherCustom: true }, null, 2), 'utf8')
      const copyDependency = async (kind: 'libraries' | 'assets', path: string) => {
        const owned = within(join(this.minecraftPath, kind), path)
        if (!sourceRoot || await exists(owned)) return
        const from = within(join(sourceRoot, kind), path)
        if (!(await exists(from))) return
        // Reject symlinks/junctions in every parent, not only the final file.
        let ancestor = dirname(from)
        while (ancestor !== resolve(sourceRoot)) { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('İstemci klasörü bağlantı dosyaları içeremez.'); ancestor = dirname(ancestor) }
        if (!(await regular(from))) throw new Error('İstemci dosya yolu geçersiz.')
        budget.files++; budget.bytes += (await lstat(from)).size
        if (budget.files > 75_000 || budget.bytes > 8 * 1024 ** 3) throw new Error('İstemci klasörü çok büyük.')
        const to = within(join(stage, kind), path); await mkdir(dirname(to), { recursive: true }); await copyFile(from, to)
      }
      for (const metadata of descriptors.values()) {
        for (const library of metadata.libraries ?? []) {
          if (!library || typeof library.name !== 'string') throw new Error('İstemci kitaplık bilgisi geçersiz.')
          const path = library.downloads?.artifact?.path ?? coordinates(library.name)
          if (path) await copyDependency('libraries', path)
          for (const artifact of Object.values(library.downloads?.classifiers ?? {})) if (artifact.path) await copyDependency('libraries', artifact.path)
        }
        const assetId = metadata.assetIndex?.id ?? metadata.assets
        if (assetId && /^[\w.-]{1,90}$/.test(assetId) && sourceRoot) {
          const indexPath = within(join(sourceRoot, 'assets'), `indexes/${assetId}.json`)
          if (await exists(indexPath)) {
            if (!(await regular(indexPath)) || (await lstat(indexPath)).size > 20_000_000) throw new Error('İstemci varlık listesi geçersiz.')
            const index = JSON.parse(await readFile(indexPath, 'utf8')) as { objects?: Record<string, { hash: string }> }
            await copyDependency('assets', `indexes/${assetId}.json`)
            for (const asset of Object.values(index.objects ?? {})) { if (!asset || !/^[0-9a-f]{40}$/.test(asset.hash)) throw new Error('İstemci varlık listesi geçersiz.'); await copyDependency('assets', `objects/${asset.hash.slice(0, 2)}/${asset.hash}`) }
          }
        }
      }
      for (const base of missingBases) await this.installBase!(base)
      // Commit dependencies before the selected version becomes visible. Existing files stay intact.
      const merge = async (from: string, to: string) => {
        if (!(await exists(from))) return
        await mkdir(to, { recursive: true })
        for (const entry of await readdir(from, { withFileTypes: true })) {
          const sourcePath = join(from, entry.name), targetPath = join(to, entry.name)
          if (entry.isDirectory()) await merge(sourcePath, targetPath)
          else if (!(await exists(targetPath))) await copyFile(sourcePath, targetPath, 1)
        }
      }
      await merge(join(stage, 'libraries'), join(this.minecraftPath, 'libraries'))
      await merge(join(stage, 'assets'), join(this.minecraftPath, 'assets'))
      await mkdir(join(this.minecraftPath, 'versions'), { recursive: true })
      for (const version of descriptors.keys()) if (version !== id && await exists(join(stage, 'versions', version)) && !(await exists(join(this.minecraftPath, 'versions', version)))) await rename(join(stage, 'versions', version), join(this.minecraftPath, 'versions', version))
      if (await exists(destination)) throw new Error('Bu sürüm zaten yüklü. Önce başka bir istemci klasörü seçin.')
      await rename(join(stage, 'versions', id), destination)
      return id
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('İstemci sürüm bilgisi geçersiz.')
      throw error
    } finally {
      // The staging directory is generated under the owned Minecraft root.
      const rel = relative(resolve(this.minecraftPath), resolve(stage))
      if (rel.startsWith('.custom-import-') && !rel.includes(sep)) await rm(stage, { recursive: true, force: true })
    }
  }
}
