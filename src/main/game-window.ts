import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Leave space for the title bar/taskbar when a legacy profile uses monitor-sized
// dimensions. Keep a smaller custom window size exactly as the user saved it.
export function minecraftWindowSize(requested: { width: number; height: number }, workArea: { width: number; height: number }): { width: number; height: number } {
  const fits = requested.width < workArea.width && requested.height < workArea.height - 40
  if (fits) return { width: requested.width, height: requested.height }
  const maxWidth = Math.min(1280, Math.floor(workArea.width * .8))
  const maxHeight = Math.min(720, Math.floor((workArea.height - 40) * .8))
  const scale = Math.min(1, maxWidth / requested.width, maxHeight / requested.height)
  return { width: Math.max(1, Math.floor(requested.width * scale)), height: Math.max(1, Math.floor(requested.height * scale)) }
}

// Minecraft remembers fullscreen in options.txt even without --fullscreen.
// Change only this preference, retaining all other settings and their line endings.
export function saveMinecraftWindowPreference(gamePath: string, fullscreen: boolean): void {
  const file = join(gamePath, 'options.txt')
  const previous = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const newline = previous.includes('\r\n') ? '\r\n' : '\n'
  const value = `fullscreen:${fullscreen}`
  const next = /^fullscreen:[^\r\n]*/m.test(previous)
    ? previous.replace(/^fullscreen:[^\r\n]*/gm, value)
    : `${previous}${previous && !previous.endsWith('\n') ? newline : ''}${value}${newline}`
  if (next !== previous) writeFileSync(file, next, 'utf8')
}
