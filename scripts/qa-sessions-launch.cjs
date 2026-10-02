// Isolated development UI fixture. Never included in the packaged application.
const {app,BrowserWindow,Menu,ipcMain}=require('electron')
const {join}=require('node:path')
const {createServer}=require('node:http')
const root=join(__dirname,'..')
app.setAppPath(root)
app.setPath('appData',join(root,'build','qa-accounts-data'))
let menu,instances=[],launches=[]
const build=Menu.buildFromTemplate
Menu.buildFromTemplate=function(template){menu=template;return build.call(this,template)}
require('../out/main/index.js')
const window=()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'))
app.whenReady().then(()=>{
 ipcMain.removeHandler('launcher:get-running-instances')
 ipcMain.handle('launcher:get-running-instances',()=>instances)
 for(const type of ['play','play-version']){
  ipcMain.removeHandler(`launcher:${type}`)
  ipcMain.handle(`launcher:${type}`,(_event,id,confirmed)=>{
   launches.push({type,id,confirmed})
   return instances.length && !confirmed ? {status:'confirmation-required',instances} : {status:'started'}
  })
 }
 const server=createServer(async(req,res)=>{
  try{
   let data='';for await(const chunk of req)data+=chunk
   const value=data?JSON.parse(data):null
   if(req.url==='/instances'){instances=value;window().webContents.send('launcher:instances',instances);window().webContents.send('launcher:activity',{kind:instances.length?'playing':'idle',label:instances.length?'Oyun çalışıyor':'Hazır'})}
   if(req.url==='/navigate')window().webContents.send('launcher:navigate',value)
   if(req.url==='/menu-click')menu.find(item=>item.label===value).click()
   if(req.url==='/quit')setTimeout(()=>app.quit(),50)
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({menu:menu?.map(({label,type})=>({label,type})),instances,launches}))
  }catch(error){res.statusCode=500;res.end(String(error))}
 }).listen(9224,'127.0.0.1')
 app.on('before-quit',()=>server.close())
})
