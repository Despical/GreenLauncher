import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const rendererDirectory = fileURLToPath(new URL('../src/renderer/src', import.meta.url))
const translationPath = join(rendererDirectory, 'i18n.ts')
const parse = path => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
const propertyName = node => ts.isIdentifier(node) ? node.text : literal(node)
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')
const keys = new Set()
const errors = []
const translations = parse(translationPath)

function inspectDictionary(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'dictionary' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
    for (const property of node.initializer.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const key = propertyName(property.name)
      if (key === null) continue
      keys.add(key)
      const values = ts.isArrayLiteralExpression(property.initializer) ? property.initializer.elements.map(literal) : []
      if (values.length !== 5 || values.some(value => typeof value !== 'string' || !value.trim())) {
        errors.push(`Incomplete translations: ${key}`)
      } else if (values.some(value => placeholders(value) !== placeholders(key))) {
        errors.push(`Translation placeholders differ: ${key}`)
      }
    }
  }
  ts.forEachChild(node, inspectDictionary)
}
inspectDictionary(translations)

function rendererFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? rendererFiles(path) : entry.name.endsWith('.tsx') ? [path] : []
  })
}

const files = rendererFiles(rendererDirectory)
const used = new Map()
function record(node, source) {
  const value = literal(node)
  if (value !== null) {
    if (!used.has(value)) used.set(value, `${relative(rendererDirectory, source.fileName)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
  } else if (node && ts.isConditionalExpression(node)) {
    record(node.whenTrue, source)
    record(node.whenFalse, source)
  }
}

for (const path of files) {
  const source = parse(path)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 't') record(node.arguments[0], source)
      if (node.expression.text === 'translate') record(node.arguments[1], source)
    }
    // Profile content pages translate their shared copy map at render time.
    if (source.fileName.endsWith('ResourcePacksPage.tsx') && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'copy' && node.initializer) {
      const inspectCopy = child => { if (ts.isPropertyAssignment(child)) record(child.initializer, source); ts.forEachChild(child, inspectCopy) }
      inspectCopy(node.initializer)
    }
    // Release titles and notes are translated through variables at render time.
    if (source.fileName.endsWith('Changelog.tsx') && ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name)
      if (name === 'title' || name === 'intro') record(node.initializer, source)
      if (name === 'changes' && ts.isArrayLiteralExpression(node.initializer)) {
        for (const change of node.initializer.elements) record(change, source)
      }
    }
    if (source.fileName.endsWith('Changelog.tsx') && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'releases' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const release of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(release)) continue
        for (const property of release.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const name = propertyName(property.name)
          if (name === 'title') record(property.initializer, source)
          if (name === 'changes' && ts.isArrayLiteralExpression(property.initializer)) {
            for (const change of property.initializer.elements) record(change, source)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

for (const [key, location] of used) {
  if (!keys.has(key)) errors.push(`Missing translation (${location}): ${key}`)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${used.size} translated UI strings across ${files.length} renderer components; all entries include five translations with matching placeholders.`)
}
