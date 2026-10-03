import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import yauzl from 'yauzl'

const noLink = (path: string) => { if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Paket yolu doğrulanamadı.') }
/** Inspect directory names only; no shader source is executed or extracted. */
export async function inspectShaderPack(path: string): Promise<{ description: string }> {
  noLink(path)
  if (statSync(path).isDirectory()) {
    const shaders = join(path, 'shaders'); noLink(shaders)
    if (!existsSync(shaders) || !statSync(shaders).isDirectory()) throw new Error('Paket dosyası doğrulanamadı.')
    return { description: '' }
  }
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('Paket dosyası doğrulanamadı.')); return }
      let count = 0, found = false, settled = false
      const fail = () => { if (settled) return; settled = true; zip.close(); reject(new Error('Paket dosyası doğrulanamadı.')) }
      zip.on('error', fail)
      zip.on('entry', entry => { if (++count > 50000) { fail(); return }; if (/^shaders\/.+\.(?:fsh|vsh|glsl|properties)$/i.test(entry.fileName)) found = true; zip.readEntry() })
      zip.on('end', () => { if (settled) return; settled = true; found ? resolve({ description: '' }) : reject(new Error('Paket dosyası doğrulanamadı.')) })
      zip.readEntry()
    })
  })
}

// Java Properties uses ISO-8859-1 and Unicode escapes, including for pack filenames.
const decode = (value: string) => value.replace(/\\u([a-f0-9]{4})|\\(.)/gi, (_, hex: string, char: string) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ t: '\t', n: '\n', r: '\r', f: '\f' }[char] ?? char))
const encode = (value: string) => [...value].map(char => /[\\:=#! ]/.test(char) ? `\\${char}` : char.charCodeAt(0) > 126 ? char.split('').map(unit => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`).join('') : char).join('')
function property(text: string, name: string): string { return decode(text.match(new RegExp(`^[ \t]*${name}[ \t]*[=:][ \t]*(.*)$`, 'm'))?.[1].trim() ?? '') }
export function shaderConfiguration(game: string, optifine: boolean): { path: string; engine: boolean; iris: boolean } {
  const config = join(game, 'config'), mods = join(game, 'mods'); noLink(config); noLink(mods)
  const files = existsSync(mods) ? readdirSync(mods).filter(name => /\.(jar|litemod)$/i.test(name) && !lstatSync(join(mods, name)).isSymbolicLink()) : []
  const iris = files.some(name => /iris/i.test(name)), oculus = files.some(name => /oculus/i.test(name))
  const optifineMod = optifine || files.some(name => /optifine/i.test(name))
  const irisPath = join(config, 'iris.properties'), optifinePath = join(game, 'optionsshaders.txt')
  for (const path of [irisPath, optifinePath]) noLink(path)
  if (iris || oculus || !optifineMod) return { path: irisPath, engine: iris || oculus, iris: true }
  return { path: optifinePath, engine: true, iris: false }
}
export function readShaderSelection(path: string): { text: string; packs: string[] } {
  noLink(path)
  const text = existsSync(path) ? readFileSync(path, 'latin1') : '', selected = property(text, 'shaderPack')
  return { text, packs: property(text, 'enableShaders') !== 'false' && selected && !['OFF', '(internal)'].includes(selected) ? [`file/${selected}`] : [] }
}
export function writeShaderSelection(path: string, text: string, packs: string[]) {
  noLink(dirname(path)); noLink(path); mkdirSync(dirname(path), { recursive: true })
  const newline = text.includes('\r\n') ? '\r\n' : '\n', selected = packs[0]?.replace(/^file\//, '') ?? ''
  let next = text
  for (const [key, value] of Object.entries({ shaderPack: selected ? encode(selected) : path.endsWith('optionsshaders.txt') ? 'OFF' : '', ...(path.endsWith('optionsshaders.txt') ? {} : { enableShaders: selected ? 'true' : 'false' }) })) {
    const regex = new RegExp(`^[ \t]*${key}[ \t]*[=:][^\\r\\n]*`, 'm'), line = `${key}=${value}`
    next = regex.test(next) ? next.replace(regex, () => line) : next + (next && !next.endsWith('\n') ? newline : '') + line + newline
  }
  const temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, next, 'latin1'); renameSync(temp, path)
}
