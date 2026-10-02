import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export type UpdateBlock = { size: number; sha256: string }
export type UpdateBlockMap = { format: 'green-blocks-v1'; size: number; blocks: UpdateBlock[] }
// Content-defined boundaries survive insertions and shifts in ZIP entries.
const gear = Uint32Array.from({ length: 256 }, (_, i) => Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(i + 17, 0x85ebca6b))
export async function updateBlocks(path: string, signal?: AbortSignal): Promise<UpdateBlockMap> {
  const blocks: UpdateBlock[] = []
  let rolling = 0, size = 0, total = 0, hash = createHash('sha256')
  for await (const buffer of createReadStream(path, { highWaterMark: 1024 * 1024, signal })) {
    const data = buffer as Buffer
    let start = 0
    for (let i = 0; i < data.length; i++) {
      rolling = ((rolling << 1) + gear[data[i]]) >>> 0; size++; total++
      if (size >= 8192 && ((rolling & 16383) === 0 || size >= 65536)) {
        hash.update(data.subarray(start, i + 1)); blocks.push({ size, sha256: hash.digest('hex') })
        hash = createHash('sha256'); size = 0; rolling = 0; start = i + 1
      }
    }
    hash.update(data.subarray(start))
  }
  if (size) blocks.push({ size, sha256: hash.digest('hex') })
  return { format: 'green-blocks-v1', size: total, blocks }
}
export function validateBlockMap(value: unknown, size: number): UpdateBlockMap {
  const map = value as UpdateBlockMap
  if (!map || map.format !== 'green-blocks-v1' || map.size !== size || !Array.isArray(map.blocks) || !map.blocks.length || map.blocks.length > 65536) throw new Error('Invalid portable block map')
  let total = 0
  for (const block of map.blocks) {
    if (!block || !Number.isSafeInteger(block.size) || block.size < 1 || block.size > 65536 || !/^[a-f0-9]{64}$/.test(block.sha256)) throw new Error('Invalid portable block map')
    total += block.size
  }
  if (total !== size) throw new Error('Invalid portable block map size')
  return map
}
export function planUpdate(old: UpdateBlockMap, next: UpdateBlockMap) {
  const offsets = new Map<string, { offset: number; size: number }>()
  let offset = 0
  for (const block of old.blocks) { offsets.set(block.sha256, { offset, size: block.size }); offset += block.size }
  const plan: Array<{ kind: 'copy' | 'download'; offset: number; size: number }> = []
  let position = 0, downloadBytes = 0
  for (const block of next.blocks) {
    const match = offsets.get(block.sha256)
    const copy = match?.size === block.size
    const entry = { kind: copy ? 'copy' as const : 'download' as const, offset: copy ? match.offset : position, size: block.size }
    const last = plan.at(-1)
    if (last && last.kind === entry.kind && last.offset + last.size === entry.offset && last.size + entry.size <= 8 * 1024 ** 2) last.size += entry.size
    else plan.push(entry)
    if (!copy) downloadBytes += block.size
    position += block.size
  }
  return { plan, downloadBytes }
}
