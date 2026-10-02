import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { availableParallelism, totalmem } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createDefaultNodeInstallRuntime, type InstallFile, type InstallRuntime } from '@xmcl/installer'
import type { DownloadJob, DownloadPhase, DownloadSnapshot, LauncherActivity, LauncherSettings } from '../shared/types'
import { diskSpace, isDiskSpaceError } from './disk-space'

type Job = DownloadJob & { action: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void; controllers: Set<AbortController>; transferPhases: Map<AbortController, DownloadPhase>; transferredBytes: number; lastBytes: number; lastAt: number; samples: Array<{ at: number; bytes: number }>; estimateAt: number; rateClock: number }
type Request = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<Response>
export interface ManagedFile { urls: string[]; destination: string; checksum?: { algorithm: string; value: string }; size?: number; maxBytes?: number; request?: Request; validate?: (path: string) => Promise<boolean>; replace?: boolean; registered?: boolean }
let shared: DownloadManager | undefined
export const getDownloadManager = () => shared

export class DownloadManager {
  private context = new AsyncLocalStorage<Job>()
  private jobs: Job[] = []
  private active?: Job
  private paused = false
  private playing = false
  private settings: LauncherSettings
  private rateRevision = 0
  private timer: NodeJS.Timeout
  private flights = new Map<string, Promise<void>>()
  private lastPublish = 0
  private history: DownloadJob[] = []

  constructor(settings: LauncherSettings, private emit: (snapshot: DownloadSnapshot) => void, private historyPath?: string) {
    this.settings = settings
    if (historyPath) {
      try {
        const saved = JSON.parse(readFileSync(historyPath, 'utf8'))
        if (Array.isArray(saved)) this.history = saved.filter((job: DownloadJob) => job && typeof job.id === 'string' && typeof job.title === 'string' && ['completed', 'failed'].includes(job.phase) && typeof job.createdAt === 'string' && (job.downloadedBytes > 0 || typeof job.launcherVersion === 'string' && /^\d+\.\d+\.\d+$/.test(job.launcherVersion))).slice(0, 5)
      } catch { /* A missing or damaged history never blocks downloads. */ }
    }
    shared = this
    this.timer = setInterval(() => this.publish(), 400)
    this.timer.unref()
  }
  dispose() { clearInterval(this.timer); for (const job of this.jobs) for (const controller of job.controllers) controller.abort(); if (shared === this) shared = undefined }
  get pending() { return this.jobs.some(job => !['completed', 'failed'].includes(job.phase)) }
  private blocked(job: Job) { return this.paused || job.paused || (this.playing && this.settings.pauseDownloadsWhilePlaying === true && !job.forLaunch) }
  snapshot(): DownloadSnapshot {
    const now = Date.now()
    return { jobs: [...this.history, ...this.jobs.filter(job => !['completed', 'failed'].includes(job.phase)).map(job => {
      const { action, resolve, reject, controllers, transferPhases, transferredBytes, lastBytes, lastAt, samples, estimateAt, rateClock, ...view } = job
      view.queued = job.phase === 'queued'
      if (this.blocked(job) && !['completed', 'failed'].includes(job.phase)) { view.phase = 'paused'; view.bytesPerSecond = 0; view.estimatedSeconds = undefined; job.bytesPerSecond = 0; job.estimatedSeconds = undefined; job.samples = []; job.lastAt = now; job.lastBytes = transferredBytes }
      else if (job === this.active && now - lastAt >= 350) {
        if (job.phase === 'downloading') {
          if (!samples.length) samples.push({ at: lastAt, bytes: lastBytes })
          samples.push({ at: now, bytes: transferredBytes })
          while (samples.length > 2 && samples[1].at < now - 8000) samples.shift()
          const first = samples[0], elapsed = now - first.at
          view.bytesPerSecond = Math.max(0, (transferredBytes - first.bytes) * 1000 / Math.max(1, elapsed))
          if (elapsed >= 2000) job.peakBytesPerSecond = Math.max(job.peakBytesPerSecond ?? 0, view.bytesPerSecond)
          view.peakBytesPerSecond = job.peakBytesPerSecond
          if (now - estimateAt >= 5000 || job.estimatedSeconds === undefined) {
            job.estimatedSeconds = elapsed >= 2500 && view.bytesPerSecond > 0 && job.totalBytes > job.downloadedBytes
              ? Math.ceil((job.totalBytes - job.downloadedBytes) / view.bytesPerSecond) : undefined
            job.estimateAt = now
          }
          view.estimatedSeconds = job.estimatedSeconds
        } else { view.bytesPerSecond = 0; view.estimatedSeconds = undefined; job.samples = []; job.estimatedSeconds = undefined }
        job.bytesPerSecond = view.bytesPerSecond; job.lastAt = now; job.lastBytes = transferredBytes
      }
      return view
    })], paused: this.paused, playing: this.playing, speedLimitKiB: this.settings.downloadSpeedLimitKiB ?? 0, concurrency: this.concurrency(), pauseWhilePlaying: this.settings.pauseDownloadsWhilePlaying === true }
  }
  private saveHistory() {
    if (!this.historyPath) return
    try {
      mkdirSync(dirname(this.historyPath), { recursive: true })
      writeFileSync(`${this.historyPath}.tmp`, JSON.stringify(this.history, null, 2), 'utf8')
      renameSync(`${this.historyPath}.tmp`, this.historyPath)
    } catch { /* Keep the active transfer usable if history cannot be saved. */ }
  }
  recordLauncherUpdate(version: string, at: string, totalBytes = 0, installed = false) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || !Number.isFinite(Date.parse(at))) return
    const id = `launcher-update-${version}`, previous = this.history.find(job => job.id === id)
    const detail = installed ? 'Güncelleme başarıyla tamamlandı.' : 'Yeniden başlatmaya hazır'
    if (previous?.detail === detail && previous.finishedAt === at) return
    const size = Math.max(0, Number.isFinite(totalBytes) ? totalBytes : 0, previous?.totalBytes ?? 0)
    const job: DownloadJob = { id, launcherVersion: version, title: `Green Launcher · v${version}`, phase: 'completed', detail, downloadedBytes: size, totalBytes: size, bytesPerSecond: 0, filesDone: 1, filesTotal: 1, paused: false, priority: 0, forLaunch: false, createdAt: previous?.createdAt ?? at, finishedAt: at }
    this.history = [job, ...this.history.filter(item => item.id !== id)].slice(0, 5)
    this.saveHistory(); this.publish()
  }
  private finishHistory(job: Job) {
    job.finishedAt = new Date().toISOString()
    if (job.transferredBytes <= 0) return
    const { action, resolve, reject, controllers, transferPhases, transferredBytes, lastBytes, lastAt, samples, estimateAt, rateClock, ...view } = job
    this.history = [view, ...this.history.filter(item => item.id !== job.id)].slice(0, 5)
    this.saveHistory()
  }
  private publish() { if (Date.now() - this.lastPublish < 100) return; this.lastPublish = Date.now(); this.emit(this.snapshot()) }
  configure(settings: LauncherSettings) { this.settings = settings; this.rateRevision++; for (const job of this.jobs) { job.rateClock = 0; job.samples = []; job.estimatedSeconds = undefined }; this.interruptBlocked(); this.publish(); this.pump() }
  setPlaying(playing: boolean) { this.playing = playing; this.interruptBlocked(); this.publish(); this.pump() }
  private interruptBlocked() { for (const job of this.jobs) if (this.blocked(job)) { job.rateClock = 0; for (const controller of job.controllers) controller.abort() } }
  private concurrency() {
    const hardware = Math.max(2, Math.min(8, availableParallelism(), Math.floor(totalmem() / 1024 ** 3)))
    const limit = this.settings.downloadSpeedLimitKiB ?? 0
    return limit ? Math.max(1, Math.min(hardware, Math.ceil(limit / 256))) : hardware
  }
  control(action: string, id?: string, beforeId?: string): DownloadSnapshot {
    const job = this.jobs.find(item => item.id === id)
    if (action === 'pause-all') this.paused = true
    else if (action === 'resume-all') { this.paused = false; for (const item of this.jobs) item.paused = false }
    else if (action === 'pause' && job) job.paused = true
    else if (action === 'resume' && job) { if (this.paused) for (const item of this.jobs) if (item !== job && !['completed', 'failed'].includes(item.phase)) item.paused = true; job.paused = false; this.paused = false }
    else if (action === 'prioritize' && job) job.priority = Math.max(10, ...this.jobs.map(item => item.priority)) + 1
    else if (action === 'reorder' && job && !['completed', 'failed'].includes(job.phase) && beforeId !== id) {
      const queue = this.jobs.filter(item => !['completed', 'failed'].includes(item.phase) && item !== job).sort((a, b) => b.priority - a.priority)
      const index = beforeId ? queue.findIndex(item => item.id === beforeId) : queue.length
      if (index < 0) throw new Error('Sıradaki indirme bulunamadı.')
      const previous = queue[index - 1], next = queue[index]
      job.priority = previous && next ? (previous.priority + next.priority) / 2 : next ? next.priority + 1 : previous ? previous.priority - 1 : 0
      // Equal priorities retain explicit drag order through the stable sort.
      this.jobs.splice(this.jobs.indexOf(job), 1)
      if (next) this.jobs.splice(this.jobs.indexOf(next), 0, job)
      else this.jobs.push(job)
    }
    else if (action === 'clear') { this.jobs = this.jobs.filter(item => !['completed', 'failed'].includes(item.phase)); this.history = this.history.filter(item => item.launcherVersion && item.id === id); this.saveHistory() }
    this.interruptBlocked(); this.publish(); this.pump()
    return this.snapshot()
  }
  enqueue<T>(title: string, action: () => Promise<T>, options: { profileId?: string; profileName?: string; forLaunch?: boolean; iconUrl?: string } = {}): Promise<T> {
    // Keep nested loader/Java downloads attached to their parent installation.
    if (this.context.getStore()) return action()
    const priority = options.forLaunch ? Math.max(100, ...this.jobs.filter(job => job.phase === 'queued').map(job => job.priority)) + 1 : 0
    const promise = new Promise<T>((resolve, reject) => {
      this.jobs.push({ id: randomUUID(), title, ...options, forLaunch: options.forLaunch === true, phase: 'queued', detail: '', downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, filesDone: 0, filesTotal: 0, paused: false, priority, createdAt: new Date().toISOString(), action, resolve: value => resolve(value as T), reject, controllers: new Set(), transferPhases: new Map(), transferredBytes: 0, lastBytes: 0, lastAt: Date.now(), samples: [], estimateAt: 0, rateClock: 0 })
    })
    this.publish(); this.pump(); return promise
  }
  private pump() {
    if (this.active) return
    const job = this.jobs.filter(item => item.phase === 'queued' && !this.blocked(item)).sort((a, b) => b.priority - a.priority)[0]
    if (!job) return
    this.active = job; job.phase = 'preparing'; job.lastAt = Date.now(); this.publish()
    void this.context.run(job, async () => {
      try { const value = await job.action(); job.phase = 'completed'; job.resolve(value) }
      catch (error) { job.phase = 'failed'; job.error = error instanceof Error ? error.message : String(error); job.reject(error) }
      finally { job.bytesPerSecond = 0; job.estimatedSeconds = undefined; this.finishHistory(job); this.jobs = this.jobs.filter(item => item !== job); this.active = undefined; this.publish(); this.pump() }
    })
  }
  activity(activity: LauncherActivity) {
    const job = this.context.getStore()
    if (!job) return
    job.detail = activity.detail || activity.label
    if ((activity.kind === 'installing' || activity.kind === 'launching') && job.controllers.size === 0) job.phase = 'preparing'
    this.publish()
  }
  private phase(job: Job | undefined, phase: DownloadPhase, detail?: string, controller?: AbortController) {
    if (!job) return
    if (controller) job.transferPhases.set(controller, phase)
    const phases = [...job.transferPhases.values()]
    job.phase = phases.includes('downloading') ? 'downloading' : phases.includes('retrying') ? 'retrying' : phases.includes('verifying') ? 'verifying' : phase
    if (detail && job.phase === phase) job.detail = detail
    this.publish()
  }
  private async gate(job?: Job) { while (job && this.blocked(job)) await delay(100) }
  private async throttle(bytes: number, signal: AbortSignal, clock: { rateClock: number }) {
    const rate = (this.settings.downloadSpeedLimitKiB ?? 0) * 1024
    if (!rate) return
    const now = Date.now()
    clock.rateClock = Math.max(now, clock.rateClock) + bytes * 1000 / rate
    const deadline = clock.rateClock, revision = this.rateRevision
    while (Date.now() < deadline && revision === this.rateRevision) await delay(Math.min(100, deadline - Date.now()), undefined, { signal })
  }
  private async valid(path: string, file: ManagedFile): Promise<boolean> {
    if (!existsSync(path)) return false
    if (file.size !== undefined && statSync(path).size !== file.size) return false
    if (file.checksum) {
      const hash = createHash(file.checksum.algorithm)
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      if (hash.digest('hex').toLowerCase() !== file.checksum.value.toLowerCase()) return false
    }
    return !file.validate || await file.validate(path)
  }
  async download(file: ManagedFile): Promise<void> {
    // XMCL uses -1 for an unknown Maven artifact size.
    if (file.size !== undefined && (!Number.isFinite(file.size) || file.size < 0)) file = { ...file, size: undefined }
    const existing = this.flights.get(file.destination)
    if (existing) return existing
    const task = this.transfer(file).finally(() => this.flights.delete(file.destination))
    this.flights.set(file.destination, task)
    return task
  }
  private async transfer(file: ManagedFile): Promise<void> {
    const job = this.context.getStore()
    const clock = job ?? { rateClock: 0 }
    if (job && !file.registered) { job.filesTotal++; job.totalBytes += file.size ?? 0 }
    await this.gate(job)
    this.phase(job, 'verifying', basename(file.destination))
    if (!file.replace && await this.valid(file.destination, file)) { if (job) { job.filesDone++; job.downloadedBytes += file.size ?? 0 } return }
    mkdirSync(dirname(file.destination), { recursive: true })
    const partial = `${file.destination}.green-part`
    const metadata = `${partial}.json`
    let counted = 0
    let knownSize = file.size ?? 0
    let failures = 0
    // Check the destination volume before issuing the payload request.
    diskSpace().check(file.destination, Math.max(0, (file.size ?? 8 * 1024 ** 2) - (existsSync(partial) ? statSync(partial).size : 0)))
    const request: Request = file.request ?? (async (url, headers, signal) => {
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Geçersiz indirme adresi.')
      return fetch(parsed, { headers: { 'User-Agent': 'GreenLauncher/0.14.0 (Despical)', ...headers }, signal })
    })
    for (let urlIndex = 0; urlIndex < file.urls.length;) {
      await this.gate(job)
      const url = file.urls[urlIndex]
      let saved: { url?: string; validator?: string } = {}
      try { saved = JSON.parse(readFileSync(metadata, 'utf8')) } catch {}
      if (saved.url !== url) { rmSync(partial, { force: true }); rmSync(metadata, { force: true }) }
      let offset = existsSync(partial) ? statSync(partial).size : 0
      if (offset && !file.checksum && !saved.validator) { rmSync(partial, { force: true }); offset = 0 }
      const controller = new AbortController()
      job?.controllers.add(controller)
      let stall: NodeJS.Timeout | undefined
      const arm = () => { clearTimeout(stall); stall = setTimeout(() => controller.abort(new Error('İndirme bağlantısı zaman aşımına uğradı.')), 30_000); stall.unref() }
      let output: Awaited<ReturnType<typeof open>> | undefined
      let permanentFailure = false
      let reservation: ReturnType<ReturnType<typeof diskSpace>['reserve']> | undefined
      try {
        this.phase(job, 'downloading', basename(file.destination), controller)
        const headers: Record<string, string> = { 'Accept-Encoding': 'identity' }
        if (offset) { headers.Range = `bytes=${offset}-`; if (saved.validator) headers['If-Range'] = saved.validator }
        arm()
        const response = await request(url, headers, controller.signal)
        clearTimeout(stall)
        if (response.status === 416) {
          await response.body?.cancel()
          const completeSize = /^bytes \*\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
          if (completeSize && Number(completeSize[1]) === offset && await this.valid(partial, file)) { renameSync(partial, file.destination); rmSync(metadata, { force: true }); if (job) { job.filesDone++; job.downloadedBytes += offset - counted } return }
          rmSync(partial, { force: true }); rmSync(metadata, { force: true }); failures++; if (failures > 3) throw new Error('İndirme aralığı doğrulanamadı.'); continue
        }
        if (!response.ok || !response.body) {
          permanentFailure = response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status)
          await response.body?.cancel()
          const address = new URL(url)
          throw new Error(`Dosya indirilemedi (${response.status}): ${basename(file.destination)} · ${address.hostname}${address.pathname}`)
        }
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '')
        if (response.status === 206 && (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[3]) <= Number(range[2]))) { await response.body.cancel(); rmSync(partial, { force: true }); throw new Error('İndirme aralığı geçersiz.') }
        if (offset && response.status !== 206) offset = 0
        const total = range ? Number(range[3]) : Number(response.headers.get('content-length') ?? 0)
        if (total > (file.maxBytes ?? 2 * 1024 ** 3)) { await response.body.cancel(); throw new Error('Dosya izin verilen boyutu aşıyor.') }
        if (file.size !== undefined && total && total !== file.size) { await response.body.cancel(); throw new Error('Dosyanın boyutu beklenen değerle uyuşmuyor.') }
        if (job) { job.totalBytes += Math.max(0, total - knownSize); job.downloadedBytes += offset - counted }
        counted = offset; knownSize = Math.max(knownSize, total)
        reservation = diskSpace().reserve(file.destination, total ? Math.max(0, total - offset) : 16 * 1024 ** 2)
        const etag = response.headers.get('etag')
        const validator = etag && !etag.startsWith('W/') ? etag : response.headers.get('last-modified') || undefined
        writeFileSync(metadata, JSON.stringify({ url, validator }), 'utf8')
        output = await open(partial, offset ? 'a' : 'w')
        const reader = response.body.getReader()
        try {
          for (;;) {
            arm(); const { done, value } = await reader.read(); clearTimeout(stall)
            if (done) break
            for (let start = 0; start < value.length; start += 16 * 1024) {
              const chunk = value.subarray(start, start + 16 * 1024)
              await this.throttle(chunk.length, controller.signal, clock)
              if (controller.signal.aborted) throw controller.signal.reason
              offset += chunk.length
              if (offset > (file.maxBytes ?? 2 * 1024 ** 3)) throw new Error('Dosya izin verilen boyutu aşıyor.')
              if (!total) reservation.ensure(16 * 1024 ** 2 + chunk.length)
              else if (offset % (1024 ** 2) < chunk.length) reservation.check()
              await output.write(chunk)
              reservation.consume(chunk.length)
              if (job) { job.downloadedBytes += chunk.length; job.transferredBytes += chunk.length }
              counted += chunk.length
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        await output.close(); output = undefined
        if (total && offset !== total) throw new Error('İndirme tamamlanmadan bağlantı kesildi.')
        this.phase(job, 'verifying', basename(file.destination), controller)
        if (!await this.valid(partial, file)) { rmSync(partial, { force: true }); rmSync(metadata, { force: true }); throw new Error('Dosyanın bütünlük kontrolü başarısız.') }
        renameSync(partial, file.destination); rmSync(metadata, { force: true })
        if (job) job.filesDone++
        this.phase(job, 'installing', undefined, controller)
        return
      } catch (error) {
        if (isDiskSpaceError(error)) throw error
        if (job && this.blocked(job)) { failures = 0; continue }
        if (permanentFailure) {
          failures = 0; urlIndex++
          if (urlIndex >= file.urls.length) throw error
          this.phase(job, 'preparing', 'Alternatif indirme kaynağı deneniyor', controller)
          continue
        }
        if (++failures > 3) { failures = 0; urlIndex++; if (urlIndex >= file.urls.length) throw error }
        this.phase(job, 'retrying', 'Bağlantı yeniden kuruluyor', controller)
        await delay(Math.min(4000, 500 * 2 ** failures))
      } finally { reservation?.release(); clearTimeout(stall); await output?.close().catch(() => {}); job?.controllers.delete(controller); if (job) { job.transferPhases.delete(controller); this.phase(job, job.phase) } }
    }
    throw new Error('İndirme adresi bulunamadı.')
  }
  runtime(): InstallRuntime {
    const base = createDefaultNodeInstallRuntime()
    return { ...base, download: async (files: InstallFile[]) => {
      const volumes = new Map<string, { path: string; bytes: number }>()
      for (const file of files) {
        if (!file.replace && existsSync(file.path)) continue
        const bytes = Math.max(0, file.size ?? 0), volume = diskSpace().check(file.path, 0)
        const group = volumes.get(volume) ?? { path: file.path, bytes: 0 }; group.bytes += bytes; volumes.set(volume, group)
      }
      for (const group of volumes.values()) diskSpace().check(group.path, group.bytes)
      const job = this.context.getStore()
      if (job) { job.filesTotal += files.length; job.totalBytes += files.reduce((sum, file) => sum + Math.max(0, file.size ?? 0), 0) }
      let next = 0
      let failure: unknown
      const worker = async () => {
        while (next < files.length && !failure) {
          const file = files[next++]
          try { await this.download({ urls: file.urls, destination: file.path, checksum: file.checksum, size: file.size, replace: file.replace, registered: true, validate: file.validator ? path => base.validate(path, file.validator!) : undefined }) }
          catch (error) { failure = error }
        }
      }
      await Promise.all(Array.from({ length: Math.min(this.concurrency(), files.length) }, worker))
      if (failure) throw failure
    }, java: async command => { await this.gate(this.context.getStore()); this.phase(this.context.getStore(), 'installing', 'Kurulum çalıştırılıyor'); return base.java(command) } }
  }
}
