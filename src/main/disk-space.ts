import { existsSync, realpathSync, statfsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const diskSpaceMessage = 'Diskte yeterli boş alan yok. Yer açıp yeniden dene.'
const margin = 32 * 1024 ** 2
type Probe = (path: string) => { volume: string; available: number }
const probe: Probe = path => {
  let parent = resolve(path)
  while (!existsSync(parent)) { const next = dirname(parent); if (next === parent) break; parent = next }
  parent = realpathSync(parent)
  const disk = statfsSync(parent, { bigint: true })
  return { volume: String(statSync(parent).dev), available: Number(disk.bavail * disk.bsize) }
}

export class DiskSpace {
  private reservations = new Set<{ path: string; volume: string; remaining: number }>()
  constructor(private inspect: Probe = probe, private report: (error: Error) => void = () => {}) {}
  private fail(): never {
    const error = Object.assign(new Error(diskSpaceMessage), { code: 'INSUFFICIENT_DISK_SPACE', diskSpaceReported: false })
    this.report(error)
    throw error
  }
  check(path: string, bytes: number) {
    let disk: ReturnType<Probe>
    try { disk = this.inspect(path) }
    catch {
      const error = Object.assign(new Error('Diskteki boş alan kontrol edilemedi. Yeniden dene.'), { code: 'DISK_SPACE_CHECK_FAILED', diskSpaceReported: false })
      this.report(error); throw error
    }
    const reserved = [...this.reservations].filter(item => item.volume === disk.volume).reduce((sum, item) => sum + item.remaining, 0)
    if (!Number.isFinite(bytes) || bytes < 0 || disk.available < bytes + reserved + margin) this.fail()
    return disk.volume
  }
  reserve(path: string, bytes: number) {
    const item = { path, volume: this.check(path, bytes), remaining: bytes }
    this.reservations.add(item)
    return {
      check: () => { this.check(path, 0) },
      consume: (bytes: number) => { item.remaining = Math.max(0, item.remaining - bytes) },
      ensure: (bytes: number) => {
        if (bytes > item.remaining) { this.check(path, bytes - item.remaining); item.remaining = bytes }
        else this.check(path, 0)
      },
      release: () => { this.reservations.delete(item) },
    }
  }
}
let space = new DiskSpace()
export const diskSpace = () => space
export function configureDiskSpace(report: (error: Error) => void) { space = new DiskSpace(probe, report) }
export const isDiskSpaceError = (error: unknown) => ['ENOSPC', 'INSUFFICIENT_DISK_SPACE', 'DISK_SPACE_CHECK_FAILED'].includes(String((error as { code?: string })?.code ?? ''))
