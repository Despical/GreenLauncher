import { copyFileSync, cpSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function prepareDataPath(appDataPath: string): string {
  const legacy = join(appDataPath, 'green-launcher')
  const current = join(appDataPath, 'GreenLauncher')

  if (existsSync(legacy) && !existsSync(current)) {
    try { renameSync(legacy, current) } catch { /* A Windows process may hold the old directory open. */ }
  }

  mkdirSync(current, { recursive: true })
  if (existsSync(legacy)) {
    for (const name of ['launcher.json', 'auth-cache.bin', 'error-log.json', 'versions-cache.json', 'minecraft', 'profiles', 'java', 'Partitions']) {
      const source = join(legacy, name)
      const destination = join(current, name)
      if (!existsSync(source) || existsSync(destination)) continue
      try { renameSync(source, destination) } catch {
        const staging = join(current, `.migrating-${name}`)
        if (statSync(source).isDirectory()) cpSync(source, staging, { recursive: true, force: true })
        else copyFileSync(source, staging)
        renameSync(staging, destination)
      }
    }
  }
  return current
}
