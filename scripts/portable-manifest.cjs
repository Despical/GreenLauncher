const { readdirSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

// Invoked after packaging/signing and before compiling the portable wrapper.
module.exports = async context => {
  const checks = ['!macro verifyGreenRuntime']
  function visit(relative = '') {
    for (const entry of readdirSync(join(context.appOutDir, relative), { withFileTypes: true })) {
      const child = join(relative, entry.name)
      if (entry.isDirectory()) { visit(child); continue }
      if (!entry.isFile()) continue
      const escaped = child.replace(/\$/g, () => '$$').replace(/"/g, '$\\"')
      checks.push(`  ClearErrors`, `  FileOpen $R7 "$INSTDIR\\${escaped}" r`, '  IfErrors runtimeCacheFailed', '  FileSeek $R7 0 END $R6', '  FileClose $R7', `  StrCmp $R6 ${statSync(join(context.appOutDir, child)).size} 0 runtimeCacheFailed`)
    }
  }
  visit()
  checks.push('!macroend')
  writeFileSync(join(__dirname, '..', 'build', 'runtime-manifest.nsh'), checks.join('\n'))
}
