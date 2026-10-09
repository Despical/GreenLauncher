import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
const version=JSON.parse(readFileSync('package.json','utf8')).version
const portable=resolve(`release/GreenLauncher-${version}.exe`),helper=resolve('build/update-helper.exe')
const bytes=readFileSync(portable),sha256=createHash('sha256').update(bytes).digest('hex')
const portableMetadata=JSON.parse(readFileSync('release/portable-update.json','utf8'))
if(portableMetadata.version!==version||portableMetadata.sha256!==sha256||portableMetadata.size!==bytes.length||!portableMetadata.blockmap)throw new Error('Build the versioned portable EXE and its differential metadata before the setup.')
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
  ; The portable payload already contains individually compressed files.
  ; Recompressing it as one NSIS stream destroys differential block reuse.
  SetCompress off
  File /oname=update-helper.exe "${nsisPath(helper)}"
  File /oname=launcher-update.exe "${nsisPath(portable)}"
  SetCompress auto
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
