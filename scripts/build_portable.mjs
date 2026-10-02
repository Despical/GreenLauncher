import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pnpm = join(root, 'node_modules', '.pnpm')
const candidates = readdirSync(pnpm)
  .filter(name => name.startsWith('app-builder-lib@'))
  .map(name => join(pnpm, name, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'portable.nsi'))
const template = candidates.find(path => {
  try { return readFileSync(path, 'utf8').includes('Function .onInit') } catch { return false }
})
if (!template) throw new Error('electron-builder portable.nsi bulunamadı.')

const original = readFileSync(template, 'utf8')
// Key the extracted runtime by content, so rebuilding the same version cannot
// accidentally reuse an older executable. User data lives outside this cache.
const runtimeHash = createHash('sha256')
function hashPath(relative) {
  const entries = readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const child = join(relative, entry.name)
    if (entry.isDirectory()) hashPath(child)
    else { runtimeHash.update(child); runtimeHash.update(readFileSync(join(root, child))) }
  }
}
hashPath('out')
for (const name of ['package.json', 'pnpm-lock.yaml', 'scripts/build_portable.mjs', 'scripts/portable-manifest.cjs', 'scripts/splash-helper.cpp', 'build/update-helper.exe', 'scripts/update-helper.cpp', 'build/icon.png', 'build/icon.ico', 'build/tray-icon.ico', 'build/portable-splash.png', 'LICENSE']) {
  runtimeHash.update(name); runtimeHash.update(readFileSync(join(root, name)))
}
const runtimeId = runtimeHash.digest('hex').slice(0, 24)
const runtimeDirectory = `$LOCALAPPDATA\\GreenLauncher\\runtime\\${runtimeId}`
const init = /Function \.onInit\r?\n  !ifndef SPLASH_IMAGE\r?\n    SetSilent silent\r?\n  !endif\r?\n\r?\n  !insertmacro check64BitAndSetRegView\r?\nFunctionEnd/
if (!init.test(original)) throw new Error('electron-builder portable.nsi beklenen biçimde değil; güvenli biçimde değiştirilemedi.')

// Focus a running app before NSIS extracts any files. On a cold start a tiny native
// splash process stays visible until Electron signals that its main window is painted.
const replacement = `Function .onInit
  FindWindow $0 "Chrome_WidgetWin_1" "Green Launcher"
  StrCmp $0 0 newInstance
    System::Call 'user32::ShowWindow(p r0, i 9)i .r1'
    System::Call 'user32::SetForegroundWindow(p r0)i .r1'
    StrCpy $INSTDIR "${runtimeDirectory}"
    IfFileExists "$INSTDIR\\.complete" 0 newInstance
    IfFileExists "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" 0 newInstance
    IfFileExists "$INSTDIR\\resources\\app.asar" 0 newInstance
    IfFileExists "$INSTDIR\\icudtl.dat" 0 newInstance
    IfFileExists "$INSTDIR\\resources.pak" 0 newInstance
    IfFileExists "$INSTDIR\\v8_context_snapshot.bin" 0 newInstance
      InitPluginsDir
      \${StdUtils.GetAllParameters} $R0 0
      Exec '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" $R0'
    SetErrorLevel 0
    Quit
  newInstance:
  SetSilent silent
  !insertmacro check64BitAndSetRegView
FunctionEnd`

const source = join(root, 'scripts', 'splash-helper.cpp')
const helper = join(root, 'build', 'splash-helper.exe')
const splash = join(root, 'build', 'portable-splash.png')
const compile = spawnSync('g++', ['-std=c++17', '-O2', '-mwindows', '-o', helper, source, '-lgdiplus', '-lshell32', '-lole32'], { cwd: root, stdio: 'inherit' })
if (compile.error) throw compile.error
if (compile.status !== 0) throw new Error('Windows açılış yardımcısı derlenemedi.')

const section = /Section\r?\n  !ifdef SPLASH_IMAGE/
const startHelper = `Section
  InitPluginsDir
  File /oname=$PLUGINSDIR\\splash-helper.exe "${helper}"
  File /oname=$PLUGINSDIR\\splash.png "${splash}"
  StrCpy $R8 "$PLUGINSDIR\\splash-ready"
  Exec '"$PLUGINSDIR\\splash-helper.exe" "$PLUGINSDIR\\splash.png" "$R8"'
  !ifdef SPLASH_IMAGE`
if (!section.test(original)) throw new Error('portable.nsi Section bulunamadı.')
const launch = /  \$\{StdUtils\.GetAllParameters\} \$R0 0\r?\n\r?\n  !ifdef SPLASH_IMAGE/
const passReadyFile = `  \${StdUtils.GetAllParameters} $R0 0
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("GREEN_LAUNCHER_SPLASH_READY_FILE", "$R8").r0'

  !ifdef SPLASH_IMAGE`
if (!launch.test(original)) throw new Error('portable.nsi launch bloğu bulunamadı.')
const exit = /  SetErrorLevel \$0\r?\n\r?\n  SetOutPath \$EXEDIR/
const stopHelper = `  SetErrorLevel $0
  FileOpen $R7 "$R8" w
  FileClose $R7
  Sleep 150

  SetOutPath $EXEDIR`
if (!exit.test(original)) throw new Error('portable.nsi kapanış bloğu bulunamadı.')
const extractionStart = /  StrCpy \$INSTDIR "\$PLUGINSDIR\\app"[\s\S]*?  SetOutPath \$INSTDIR/
const extractionEnd = /  System::Call 'Kernel32::SetEnvironmentVariable\(t, t\)i \("PORTABLE_EXECUTABLE_DIR"/
const cleanup = /\tRMDir \/r \$INSTDIR\r?\nSectionEnd/
if (!extractionStart.test(original) || !extractionEnd.test(original) || !cleanup.test(original)) throw new Error('portable.nsi runtime cache blocks changed.')
const cachedExtraction = `  StrCpy $INSTDIR "${runtimeDirectory}"
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\\GreenLauncherRuntime-${runtimeId}")p .r0'
  StrCpy $runtimeMutex $0
  StrCmp $runtimeMutex 0 runtimeCacheFailed
  System::Call 'kernel32::WaitForSingleObject(p $runtimeMutex, i 120000)i .r0'
  StrCmp $0 0 runtimeCacheLocked
  StrCmp $0 128 runtimeCacheLocked runtimeCacheFailed
  runtimeCacheLocked:
  IfFileExists "$INSTDIR\\.complete" 0 runtimeCacheExtract
  IfFileExists "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" 0 runtimeCacheExtract
  IfFileExists "$INSTDIR\\icudtl.dat" 0 runtimeCacheExtract
  IfFileExists "$INSTDIR\\resources.pak" 0 runtimeCacheExtract
  IfFileExists "$INSTDIR\\v8_context_snapshot.bin" 0 runtimeCacheExtract
  IfFileExists "$INSTDIR\\resources\\app.asar" runtimeCacheReady runtimeCacheExtract
  runtimeCacheExtract:
  ; This is a fixed app-owned path derived from the build hash, never user data.
  RMDir /r $INSTDIR
  SetOutPath $INSTDIR
  ClearErrors`
const completeExtraction = `  IfErrors runtimeCacheFailed
  !insertmacro verifyGreenRuntime
  ClearErrors
  FileOpen $R7 "$INSTDIR\\.complete" w
  IfErrors runtimeCacheFailed
  FileWrite $R7 "${runtimeId}"
  FileClose $R7
  runtimeCacheReady:
  System::Call 'kernel32::ReleaseMutex(p $runtimeMutex)'
  System::Call 'kernel32::CloseHandle(p $runtimeMutex)'
  SetOutPath $INSTDIR
  Goto runtimeCacheLaunch
  runtimeCacheFailed:
  System::Call 'kernel32::ReleaseMutex(p $runtimeMutex)'
  System::Call 'kernel32::CloseHandle(p $runtimeMutex)'
  FileOpen $R7 "$R8" w
  FileClose $R7
  MessageBox MB_OK|MB_ICONSTOP "Green Launcher could not prepare its runtime. Please try again."
  Abort
  runtimeCacheLaunch:
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR"`
const patched = `Var runtimeMutex\n!include "${join(root, 'build', 'runtime-manifest.nsh')}"\n` + original.replace(init, replacement).replace(section, startHelper).replace(launch, passReadyFile).replace(exit, stopHelper)
  .replace(extractionStart, cachedExtraction).replace(extractionEnd, completeExtraction).replace(cleanup, '\t; Keep this completed runtime for the next launch.\nSectionEnd')
writeFileSync(join(root, 'build', 'portable-runtime.json'), JSON.stringify({ id: runtimeId, directory: `GreenLauncher/runtime/${runtimeId}` }, null, 2))

writeFileSync(template, patched, 'utf8')
try {
  const builder = join(root, 'node_modules', 'electron-builder', 'cli.js')
  const artifactName = process.env.GREEN_LAUNCHER_ARTIFACT_NAME
  if (artifactName && !/^[a-zA-Z0-9._-]+\.exe$/.test(artifactName)) throw new Error('Geçersiz taşınabilir dosya adı.')
  const prepare = spawnSync(process.execPath, [builder, '--win', '--dir'], { cwd: root, stdio: 'inherit' })
  if (prepare.error) throw prepare.error
  if (prepare.status !== 0) throw new Error('Windows runtime packaging failed.')
  const appOutDir = join(root, 'release', 'win-unpacked')
  const { default: writeManifest } = await import('./portable-manifest.cjs')
  await writeManifest({ appOutDir })
  const argumentsForBuilder = [builder, '--win', 'portable', '--prepackaged', appOutDir, ...(artifactName ? [`--config.portable.artifactName=${artifactName}`] : [])]
  const result = spawnSync(process.execPath, argumentsForBuilder, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  writeFileSync(template, original, 'utf8')
}
