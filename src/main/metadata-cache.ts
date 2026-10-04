// Short-lived public catalog data only. Installation and account validation
// deliberately use the underlying providers directly.
export class MetadataCache {
  private values = new Map<string, { value: unknown; expires: number; bytes: number }>()
  private pending = new Map<string, Promise<unknown>>()
  private bytes = 0
  private generation = 0
  constructor(private readonly ttl = 120_000, private readonly capacity = 128, private readonly maxBytes = 8 * 1024 * 1024, private readonly now = Date.now) {}

  clear(): void { this.generation++; this.values.clear(); this.pending.clear(); this.bytes = 0 }

  async get<T>(key: string, fetchValue: () => Promise<T>, force = false): Promise<T> {
    const cached = this.values.get(key)
    if (!force && cached && cached.expires > this.now()) {
      this.values.delete(key); this.values.set(key, cached)
      return structuredClone(cached.value) as T
    }
    if (cached) { this.bytes -= cached.bytes; this.values.delete(key) }
    const existing = this.pending.get(key)
    if (existing) return structuredClone(await existing) as T
    const generation = this.generation
    const request = Promise.resolve().then(fetchValue).then(value => {
      const size = Buffer.byteLength(JSON.stringify(value) ?? '')
      if (generation === this.generation && size <= this.maxBytes) {
        this.values.set(key, { value: structuredClone(value), bytes: size, expires: this.now() + this.ttl })
        this.bytes += size
        while (this.values.size > this.capacity || this.bytes > this.maxBytes) {
          const oldest = this.values.keys().next().value!
          this.bytes -= this.values.get(oldest)!.bytes
          this.values.delete(oldest)
        }
      }
      return value
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key) })
    this.pending.set(key, request)
    return structuredClone(await request)
  }
}
