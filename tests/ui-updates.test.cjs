const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { stageUIUpdate, verifiedRoot, validateManifest } = require('../electron/uiUpdates.cjs')
const hash = data => createHash('sha256').update(data).digest('hex')
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vapepos-ui-test-'))
  const packagedRoot = path.join(root,'packaged'), store=path.join(root,'updates')
  await fs.mkdir(packagedRoot); await fs.writeFile(path.join(packagedRoot,'index.html'),'local')
  let contents={'index.html':'new','assets/app.js':'new-js','assets/lazy.js':'lazy'}
  let corrupt=false,offline=false,requested=[]
  const manifest=()=>{const files=Object.entries(contents).map(([name,data])=>({path:name,sha256:hash(data),size:Buffer.byteLength(data)}));return {schema:1,minDesktopVersion:'1.1.3',version:hash(JSON.stringify(files)),files}}
  const fetcher=async(url,options)=>{
    assert.equal(options.bypassCustomProtocolHandlers,true);requested.push(url)
    if(offline)throw Error('Offline')
    const name=new URL(url).pathname.slice(1)
    return new Response(name==='desktop-update.json'?JSON.stringify(manifest()):corrupt?'bad':contents[name])
  }
  return {store,packagedRoot,nativeVersion:'1.1.3',fetcher,manifest,setCorrupt:v=>corrupt=v,setOffline:v=>offline=v,setContents:v=>contents=v,requested}
}
test('complete update activates only on next startup; offline restart and unchanged releases work',async()=>{
 const f=await fixture();assert.equal(await verifiedRoot(f.store,f.nativeVersion),null)
 await stageUIUpdate(f);const active=await verifiedRoot(f.store,f.nativeVersion)
 assert.equal(await fs.readFile(path.join(active.root,'index.html'),'utf8'),'new')
 f.setOffline(true);await assert.rejects(stageUIUpdate(f));assert.equal((await verifiedRoot(f.store,f.nativeVersion)).root,active.root)
 f.setOffline(false);const before=f.requested.length;assert.equal(await stageUIUpdate(f),false);assert.equal(f.requested.length-before,1)
 f.setContents({'index.html':'new2','assets/app.js':'new-js','assets/lazy.js':'lazy'})
 await stageUIUpdate(f)
 assert.equal(await fs.readFile(path.join(active.root,'index.html'),'utf8'),'new')
 assert.notEqual((await verifiedRoot(f.store,f.nativeVersion)).root,active.root)
})
test('partial/corrupt update never replaces active release; tampering falls back to packaged UI',async()=>{
 const f=await fixture();await stageUIUpdate(f);const active=await verifiedRoot(f.store,f.nativeVersion)
 f.setContents({'index.html':'different','assets/app.js':'changed'});f.setCorrupt(true)
 await assert.rejects(stageUIUpdate(f));assert.equal((await verifiedRoot(f.store,f.nativeVersion)).root,active.root)
 await fs.writeFile(path.join(active.root,'index.html'),'tampered')
 assert.equal(await verifiedRoot(f.store,f.nativeVersion),null)
})
test('malformed paths, wrong integrity and incompatible native versions are rejected',async()=>{
 const f=await fixture(),m=f.manifest()
 assert.throws(()=>validateManifest({...m,minDesktopVersion:'2.0.0'},'1.1.3'))
 assert.throws(()=>validateManifest({...m,version:'f'.repeat(64)},'1.1.3'))
 const files=[{path:'../outside',size:1,sha256:hash('x')}]
 assert.throws(()=>validateManifest({...m,files,version:hash(JSON.stringify(files))},'1.1.3'))
})
