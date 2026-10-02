Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ShellIconsQA {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
 public struct FileInfo { public IntPtr Icon; public int Index; public uint Attributes; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string DisplayName; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=80)] public string TypeName; }
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SHGetFileInfo(string path,uint attributes,ref FileInfo info,uint size,uint flags);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
"@
$result = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../build/qa-shell-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$link = Join-Path (Split-Path (Split-Path $result.details.icon -Parent) -Parent) 'Microsoft/Windows/Start Menu/Programs/Green Launcher.lnk'
$targets = @{ resource=$result.details.icon; shortcut=$link; executable=(Join-Path $PSScriptRoot '../release/GreenLauncher.exe') }
foreach ($key in $targets.Keys) {
 $info=New-Object ShellIconsQA+FileInfo
 $return=[ShellIconsQA]::SHGetFileInfo([IO.Path]::GetFullPath($targets[$key]),0,[ref]$info,[Runtime.InteropServices.Marshal]::SizeOf($info),0x100)
 if($return -eq [IntPtr]::Zero -or $info.Icon -eq [IntPtr]::Zero){throw "Shell icon missing for $key"}
 $icon=[Drawing.Icon]::FromHandle($info.Icon)
 $bitmap=$icon.ToBitmap()
 $bitmap.Save((Join-Path $PSScriptRoot "../build/qa-native-shell-$key.png"))
 $bitmap.Dispose()
 [void][ShellIconsQA]::DestroyIcon($info.Icon)
 Write-Output "Native Shell icon extracted: $key"
}
