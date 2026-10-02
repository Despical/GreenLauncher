const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const folder=fs.readdirSync('node_modules/.pnpm').find(n=>n.startsWith('@electron+asar@'))
const asar=require(path.resolve('node_modules/.pnpm',folder,'node_modules/@electron/asar'))
const archive='release/win-unpacked/resources/app.asar'
const { createRequire } = require('node:module')
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml')
const updateConfig = yaml.load(fs.readFileSync('release/win-unpacked/resources/app-update.yml', 'utf8'))
assert.deepEqual(updateConfig, yaml.load(fs.readFileSync('src/main/app-update.yml', 'utf8')), 'every portable runtime must contain the public feed and download cache configuration')
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
assert.match(main,/frames=\['','\.','\.\.','\.\.\.'\]/)
assert.match(main,/setAppDetails/)
assert.match(main,/api\.mojang\.com\/users\/profiles\/minecraft/)
console.log(`All ${verifiedFiles} packaged output files, including lazy skin/catalog/changelog chunks, exactly match the final build; splash, Windows app details and offline skins are included.`)
