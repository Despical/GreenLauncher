import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import ts from 'typescript'

// Use exactly the same boundary algorithm as the shipped updater.
writeFileSync('build/update-blocks.cjs', ts.transpileModule(readFileSync('src/main/update-blocks.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)
const { updateBlocks } = (await import('../build/update-blocks.cjs')).default
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const file = `GreenLauncher-${version}.exe`, bytes = readFileSync(join('release', file))
const digest = data => createHash('sha256').update(data).digest('hex')
const blockmap = Buffer.from(JSON.stringify(await updateBlocks(resolve('release', file))) + '\n')
function unpackedSize(path) {
  return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? unpackedSize(join(path, entry.name)) : statSync(join(path, entry.name)).size), 0)
}
writeFileSync(join('release', file + '.blocks.json'), blockmap)
writeFileSync('release/portable-update.json', JSON.stringify({ version, file, sha256: digest(bytes), size: bytes.length, runtimeSize: unpackedSize('release/win-unpacked'), blockmap: { file: file + '.blocks.json', sha256: digest(blockmap), size: blockmap.length } }, null, 2) + '\n')
console.log(`Portable update metadata: ${blockmap.length} byte block map; independently compressed portable files`)
