import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
const key=createHash('sha256').update(readFileSync('scripts/update-helper.cpp')).update(readFileSync('scripts/build_update_helper.mjs')).update(readFileSync('scripts/update-helper.manifest')).digest('hex')
mkdirSync('build',{recursive:true})
if(!existsSync('build/update-helper.exe')||!existsSync('build/update-helper.sha256')||readFileSync('build/update-helper.sha256','utf8')!==key){
 writeFileSync('build/update-helper.rc','1 24 "scripts/update-helper.manifest"\n')
 const resource=spawnSync('windres',['build/update-helper.rc','build/update-helper-resource.o'],{stdio:'inherit'})
 if(resource.status!==0)process.exit(resource.status||1)
 const result=spawnSync('g++',['-std=c++17','-O2','-mwindows','-static','-o','build/update-helper.exe','scripts/update-helper.cpp','build/update-helper-resource.o','-ladvapi32','-lshell32','-lshlwapi'],{stdio:'inherit'})
 if(result.status!==0)process.exit(result.status||1)
 writeFileSync('build/update-helper.sha256',key)
}
