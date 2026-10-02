const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
exports.createSourceLoader = (globals = {}) => {
  const modules = new Map()
  const load = file => {
    file = path.resolve(file)
    if (modules.has(file)) return modules.get(file).exports
    const mod = { exports: {} }; modules.set(file, mod)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(output, { module: mod, exports: mod.exports, require: load.requireFrom(file), process, Buffer, URL, URLSearchParams, Date, AbortController, AbortSignal, structuredClone, fetch, console, setInterval, clearInterval, setTimeout, clearTimeout, ...globals }, { filename: file })
    return mod.exports
  }
  load.requireFrom = file => id => globals.dependencies?.[id] ?? (id.startsWith('.') ? load(path.resolve(path.dirname(file), id) + '.ts') : require(id))
  return load
}
