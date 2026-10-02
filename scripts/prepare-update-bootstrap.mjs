import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
const version=JSON.parse(readFileSync('package.json','utf8')).version
const portable=resolve(`release/GreenLauncher-${version}.exe`),helper=resolve('build/update-helper.exe')
const bytes=readFileSync(portable),sha256=createHash('sha256').update(bytes).digest('hex')
writeFileSync('release/portable-update.json',JSON.stringify({version,file:`GreenLauncher-${version}.exe`,sha256,size:bytes.length},null,2)+'\n')
const nsisPath=p=>p.replace(/\$/g,'$$').replace(/"/g,'$\\"')
writeFileSync('build/update-bootstrap.nsh',`!macro customInit
  ReadEnvStr $R0 "PORTABLE_EXECUTABLE_FILE"
  StrCmp $R0 "" regularInstall
  IfFileExists "$R0" 0 regularInstall
  SetSilent silent
  StrCpy $R1 "$LOCALAPPDATA\\GreenLauncher\\updates\\bridge-${version}"
  ReadEnvStr $R3 "GREEN_LAUNCHER_UPDATE_QA_ROOT"
  StrCmp $R3 "" bridgeExtract
    StrCpy $R1 "$R3\\bridge-${version}"
  bridgeExtract:
  CreateDirectory "$R1"
  SetOutPath "$R1"
  File /oname=update-helper.exe "${nsisPath(helper)}"
  File /oname=launcher-update.exe "${nsisPath(portable)}"
  ReadEnvStr $R3 "GREEN_LAUNCHER_UPDATE_QA_ROOT"
  StrCmp $R3 "" regularReceipt
    StrCpy $R3 "$R3\\GreenLauncher\\update-result.json"
    Goto bridgeApply
  regularReceipt:
    StrCpy $R3 "$APPDATA\\GreenLauncher\\update-result.json"
  bridgeApply:
  \${GetFileVersion} "$R0" $R2
  Exec '"$R1\\update-helper.exe" "$R0" "$R1\\launcher-update.exe" "${sha256}" "$R3" "$R2" "${version}" "0"'
  SetErrorLevel 0
  Quit
  regularInstall:
!macroend
`)
console.log('Prepared portable update manifest and legacy silent handoff')
