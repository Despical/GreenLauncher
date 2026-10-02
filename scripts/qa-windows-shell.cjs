const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const {app,shell,nativeImage}=require('electron')
const root=path.join(__dirname,'..'),directory=fs.mkdtempSync(path.join(root,'build','qa-shell-'))
app.setPath('userData',directory)
app.setAppUserModelId('com.greenlauncher.shell-qa')
const tasks=[]
const fakeApp={isPackaged:true,getPath:()=>directory,getAppPath:()=>root,setUserTasks:value=>{tasks.push(...value);return app.setUserTasks(value)}}
const modules={electron:{app:fakeApp,shell,nativeImage}}
function load(file){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const mod={exports:{}}
 vm.runInNewContext(result,{exports:mod.exports,module:mod,require:name=>modules[name]||require(name),Buffer,console,process:{platform:'win32',resourcesPath:path.join(root,'build'),env:{PORTABLE_EXECUTABLE_FILE:path.join(root,'release','GreenLauncher.exe')}}})
 return mod.exports
}
app.whenReady().then(async()=>{
 modules['../renderer/src/i18n']=load('src/renderer/src/i18n.ts')
 const integration=load('src/main/windows-integration.ts')
 const pinned=path.join(directory,'Microsoft','Internet Explorer','Quick Launch','User Pinned','TaskBar')
 fs.mkdirSync(pinned,{recursive:true})
 const plain=path.join(pinned,'Green Launcher.lnk'),profile=path.join(pinned,'Green Launcher - profile.lnk')
 const old=path.join(root,'release','GreenLauncher-0.13.0.exe')
 shell.writeShortcutLink(plain,'create',{target:old,icon:path.join(root,'build','icon.ico')})
 shell.writeShortcutLink(profile,'create',{target:old,args:'--launch-profile=preserved'})
 integration.configureWindows('tr')
 const icon=integration.persistentIcon()
 assert.equal(fs.readFileSync(icon).equals(fs.readFileSync(path.join(root,'build','icon.ico'))),true)
 const start=path.join(directory,'Microsoft','Windows','Start Menu','Programs','Green Launcher.lnk')
 const details=shell.readShortcutLink(start)
 assert.equal(details.icon,icon);assert.equal(details.appUserModelId,integration.appId)
 assert.equal(details.target,path.join(root,'release','GreenLauncher.exe'))
 assert.equal(shell.readShortcutLink(plain).icon,icon)
 assert.equal(shell.readShortcutLink(profile).args,'--launch-profile=preserved')
 assert.equal(tasks.length,0)
 assert.ok(tasks.every(task=>fs.existsSync(task.iconPath)))
 assert.equal(integration.navigationArgument(['--open-page=gallery']),'gallery')
 assert.equal(integration.navigationArgument(['--open-page=invalid']),null)
 const fileIcon=await app.getFileIcon(start,{size:'normal'})
 assert.equal(fileIcon.isEmpty(),false)
 fs.writeFileSync(path.join(root,'build','qa-shell-shortcut-icon.png'),fileIcon.toPNG())
 fs.writeFileSync(path.join(root,'build','qa-shell-result.json'),JSON.stringify({details,tasks,iconSize:fileIcon.getSize()},null,2))
 console.log('PASS native Start Menu link, AppUserModelId, persistent icon, own pin repair, profile pin preserved, empty Windows task list, navigation parsing, shell icon extraction')
 app.setUserTasks([])
 app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
