import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { __CURSEFORGE_API_KEY__: JSON.stringify(process.env.GREEN_CURSEFORGE_API_KEY ?? '') } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react(), {
      name: 'bundled-font-licenses',
      generateBundle() {
        const source = ['@fontsource-variable/inter', '@fontsource-variable/space-grotesk'].map(name =>
          `${name}\n\n${readFileSync(join(dirname(require.resolve(`${name}/package.json`)), 'LICENSE'), 'utf8')}`
        ).join('\n\n')
        this.emitFile({ type: 'asset', fileName: 'font-licenses.txt', source })
      }
    }],
    build: { license: { fileName: 'third-party-licenses.txt' } }
  }
})
