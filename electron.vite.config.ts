import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], define: { __CURSEFORGE_API_KEY__: JSON.stringify(process.env.GREEN_CURSEFORGE_API_KEY ?? '') } },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
