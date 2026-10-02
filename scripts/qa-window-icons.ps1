Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LauncherIconQA {
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr word, IntPtr data);
}
"@
$qaProcess = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*qa-accounts-launch.cjs*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1
$qaWindow = (Get-Process -Id $qaProcess.ProcessId).MainWindowHandle
foreach ($iconKind in @(0,1)) {
 $iconHandle = [LauncherIconQA]::SendMessage($qaWindow, 0x7f, [IntPtr]$iconKind, [IntPtr]::Zero)
 if ($iconHandle -eq [IntPtr]::Zero) { throw "Missing native window icon $iconKind" }
 $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
 $bitmap = $icon.ToBitmap()
 $bitmap.Save((Join-Path $PWD "build/qa-window-icon-$iconKind.png"))
 Write-Output "Window icon $iconKind : $($bitmap.Width)x$($bitmap.Height)"
 $bitmap.Dispose()
}
$packagedIcon = [System.Drawing.Icon]::ExtractAssociatedIcon((Join-Path $PWD 'release/win-unpacked/GreenLauncher.exe'))
$packagedIcon.ToBitmap().Save((Join-Path $PWD 'build/qa-packaged-icon.png'))
Write-Output "Packaged executable icon extracted: $($packagedIcon.Size)"
