$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'build\portable-runtime.json') -Raw | ConvertFrom-Json
$taskRuntime = Join-Path $env:LOCALAPPDATA $taskManifest.directory
$taskExecutable = Join-Path $taskRuntime 'GreenLauncher.exe'
$taskPortable = Join-Path $taskRoot 'release\GreenLauncher.exe'
if (Get-Process GreenLauncher -ErrorAction SilentlyContinue) { throw 'Close the launcher before measuring startup.' }

function Measure-LauncherStart {
    param([string]$Label)
    $taskHadCache = Test-Path -LiteralPath (Join-Path $taskRuntime '.complete')
    $taskWatch = [Diagnostics.Stopwatch]::StartNew()
    $taskWrapper = Start-Process -FilePath $taskPortable -WindowStyle Hidden -PassThru
    $taskMain = $null
    while ($taskWatch.ElapsedMilliseconds -lt 60000) {
        $taskMain = Get-Process GreenLauncher -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $taskExecutable -and $_.MainWindowTitle -eq 'Green Launcher' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($taskMain) { break }
        Start-Sleep -Milliseconds 100
    }
    if (!$taskMain) { throw "Launcher did not show its main window: $Label" }
    [PSCustomObject]@{label=$Label; cached=$taskHadCache; readyMs=$taskWatch.ElapsedMilliseconds; mainId=$taskMain.Id; wrapperId=$taskWrapper.Id; runtime=$taskManifest.id}
}

$taskCold = Measure-LauncherStart 'first-extraction'
if (!(Test-Path -LiteralPath (Join-Path $taskRuntime '.complete'))) { throw 'Runtime completion marker missing.' }
$taskExtractedAt = (Get-Item -LiteralPath $taskExecutable).LastWriteTimeUtc
Start-Sleep -Milliseconds 1000
# Stop only the launcher process this test created; never a game or other app.
Stop-Process -Id $taskCold.mainId
$taskColdWrapper = Get-Process -Id $taskCold.wrapperId -ErrorAction SilentlyContinue
if ($taskColdWrapper) { $null = $taskColdWrapper.WaitForExit(10000) }
$taskWarm = Measure-LauncherStart 'cached-runtime'
if ((Get-Item -LiteralPath $taskExecutable).LastWriteTimeUtc -ne $taskExtractedAt) { throw 'Cached launch unexpectedly re-extracted the runtime.' }
$taskSecond = Start-Process -FilePath $taskPortable -WindowStyle Hidden -PassThru
if (!$taskSecond.WaitForExit(15000)) { throw 'Second launch did not reuse the running application.' }
Start-Sleep -Milliseconds 750
$taskWindows = @(Get-Process GreenLauncher -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $taskExecutable -and $_.MainWindowTitle -eq 'Green Launcher' -and $_.MainWindowHandle -ne 0 })
if ($taskWindows.Count -ne 1 -or $taskWindows[0].Id -ne $taskWarm.mainId) { throw 'Second launch created another application window.' }
$taskResult = [PSCustomObject]@{cold=$taskCold; warm=$taskWarm; runtimeReused=$true; singleInstance=$true}
$taskResult | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskRoot 'build\startup-final.json')
$taskResult | ConvertTo-Json -Depth 4 -Compress
