const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const folder=fs.readdirSync('node_modules/.pnpm').find(n=>n.startsWith('@electron+asar@'))
const asar=require(path.resolve('node_modules/.pnpm',folder,'node_modules/@electron/asar'))
const archive='release/win-unpacked/resources/app.asar'
const { createRequire } = require('node:module')
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml')
const updateConfig = yaml.load(fs.readFileSync('release/win-unpacked/resources/app-update.yml', 'utf8'))
assert.deepEqual(updateConfig, yaml.load(fs.readFileSync('src/main/app-update.yml', 'utf8')), 'every portable runtime must contain the public feed and download cache configuration')
assert.ok(fs.readFileSync('release/win-unpacked/resources/update-helper.exe').equals(fs.readFileSync('build/update-helper.exe')),'packaged native updater matches verified helper')
let verifiedFiles = 0
function verifyDirectory(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) verifyDirectory(file)
    else { assert.equal(asar.extractFile(archive,file).equals(fs.readFileSync(file)),true,file); verifiedFiles++ }
  }
}
verifyDirectory('out')
for(const name of ['out/main/index.js','out/renderer/index.html'])assert.equal(asar.extractFile(archive,path.normalize(name)).equals(fs.readFileSync(name)),true,name)
const html=fs.readFileSync('out/renderer/index.html','utf8')
for(const match of html.matchAll(/\.\/assets\/([^" ]+)/g)){const file='out/renderer/assets/'+match[1];assert.equal(asar.extractFile(archive,path.normalize(file)).equals(fs.readFileSync(file)),true,file)}
const main=asar.extractFile(archive,path.normalize('out/main/index.js')).toString()
const entries=asar.listPackage(archive).map(file=>file.replaceAll('\\','/'))
for(const module of ['@dnd-kit/core','@dnd-kit/sortable','@dnd-kit/utilities','@fontsource-variable/inter','@fontsource-variable/space-grotesk','lucide-react','react','react-dom','skinview3d','three']) {
  assert.equal(entries.some(file=>file===`/node_modules/${module}`||file.startsWith(`/node_modules/${module}/`)),false,`${module} is bundled into the renderer and must not be shipped twice`)
}
assert.equal(entries.some(file=>file.endsWith('.map')),false,'development source maps are excluded')
assert.equal(entries.some(file=>file.startsWith('/node_modules/prismarine-nbt/sample/')),false,'NBT samples are excluded')
const notices=asar.extractFile(archive,path.normalize('out/renderer/third-party-licenses.txt')).toString()+asar.extractFile(archive,path.normalize('out/renderer/font-licenses.txt')).toString()
for(const module of ['react','react-dom','lucide-react','skinview3d','three','@dnd-kit/core','@fontsource-variable/inter','@fontsource-variable/space-grotesk'])assert.ok(notices.includes(module),`bundled renderer license is preserved: ${module}`)
assert.deepEqual(fs.readdirSync('release/win-unpacked/locales').filter(file=>file.endsWith('.pak')).sort(),['de.pak','en-US.pak','fr.pak','pl.pak','ru.pak','tr.pak'])
for(const file of ['LICENSES.chromium.html','resources/LICENSE','ffmpeg.dll','dxcompiler.dll','vk_swiftshader.dll'])assert.ok(fs.statSync(path.join('release/win-unpacked',file)).size>0,`required runtime and notices are retained: ${file}`)
assert.match(main,/frames=\['','\.','\.\.','\.\.\.'\]/)
assert.match(main,/setAppDetails/)
assert.match(main,/api\.mojang\.com\/users\/profiles\/minecraft/)
console.log(`All ${verifiedFiles} packaged output files, including lazy skin/catalog/changelog chunks, exactly match the final build; splash, Windows app details and offline skins are included.`)
