const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const mod={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/shared/release-notes.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports})
const {releaseNotesText,releaseNotesBlocks}=mod.exports
assert.equal(releaseNotesText('<h3>Playtime</h3><ul><li>Daily &amp; weekly</li><li>Fixed &#x2713;</li></ul><script>alert(1)</script>'),'### Playtime\n\n• Daily & weekly\n\n• Fixed ✓')
assert.equal(releaseNotesText('Plain text\n\n- Notes'),'Plain text\n\n- Notes')
assert.equal(releaseNotesText('<p>Hello</p><img src="https://example.com/x"><style>body{}</style><iframe src="x"></iframe>'),'Hello')
assert.equal(releaseNotesText('&#1114112; &#55296; &#65;').trim(),'A')
assert.ok(releaseNotesText('x'.repeat(40000)).length<=32000)
console.log('PASS remote HTML notes become inert readable text, entities decode, invalid codepoints/scripts/styles/embedded elements are removed, and note size is bounded')

assert.equal(JSON.stringify(releaseNotesBlocks('Intro\n\n### Updates\n- One\n- Two')),JSON.stringify([{kind:'paragraph',text:'Intro'},{kind:'heading',level:3,text:'Updates'},{kind:'list',items:['One','Two']}]));
assert.equal(JSON.stringify(releaseNotesBlocks('<h2>Fixes</h2><ul><li>First</li><li>Second</li></ul><script>bad()</script>')),JSON.stringify([{kind:'heading',level:2,text:'Fixes'},{kind:'list',items:['First','Second']}]));
console.log('PASS Markdown and Atom HTML heading/list structure is preserved as safe data');
