import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

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
