import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { newerRelease } from './updater'

const canonical = (path: string) => resolve(path).toLowerCase()
export async function activeLauncherPaths(): Promise<string[]> {
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'GreenLauncher.exe' } | ForEach-Object { $_.ExecutablePath }) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 })
  const paths = stdout.trim() ? JSON.parse(stdout) : []
  return (Array.isArray(paths) ? paths : [paths]).filter((path): path is string => typeof path === 'string')
}
export function cleanOldRuntimes(root: string, current: string, active: string[]): number {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) return 0
  root = realpathSync(root); current = realpathSync(current)
  if (canonical(dirname(current)) !== canonical(root) || !/^[a-f0-9]{24}$/.test(basename(current))) return 0
  if (readFileSync(join(current, '.complete'), 'utf8') !== basename(current)) return 0
  const inUse = new Set([canonical(current), ...active.map(path => canonical(dirname(path)))])
  let removed = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{24}$/.test(entry.name)) continue
    const path = join(root, entry.name)
    if (inUse.has(canonical(path)) || lstatSync(path).isSymbolicLink() || canonical(realpathSync(path)) !== canonical(path)) continue
    if (!existsSync(join(path, '.complete')) || readFileSync(join(path, '.complete'), 'utf8') !== entry.name) continue
    try { rmSync(path, { recursive: true }); removed++ } catch { /* A locked runtime is retried on the next successful launch. */ }
  }
  return removed
}
export function cleanUpdateCache(cache: string, currentVersion: string) {
  if (!existsSync(cache) || lstatSync(cache).isSymbolicLink()) return
  for (const entry of readdirSync(cache, { withFileTypes: true })) {
    const match = /^GreenLauncher-(\d+\.\d+\.\d+)\.exe(?:\.download)?$/.exec(entry.name)
    if (!entry.isFile() || !match || newerRelease(match[1], currentVersion)) continue
    try { rmSync(join(cache, entry.name)) } catch { /* Installer/helper may still be releasing this file. */ }
  }
}
