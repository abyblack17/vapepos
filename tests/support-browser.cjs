const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '..')
let server, win
app.whenReady().then(async () => {
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Support from './src/components/common/BusinessSupportView.jsx';
      createRoot(document.getElementById('root')).render(<Support session={{sessionId:'test',business:{id:'test',name:'Tienda de prueba',plan:'pro',licenseType:'permanent',lastActivityAt:new Date(Date.now()-7200000).toISOString()}}} onExit={()=>{window.exited=true}}/>);`, loader: 'jsx', resolveDir: root },
    bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
    plugins: [{ name: 'isolated-firebase', setup(build) {
      build.onResolve({ filter: /config\/firebase$/ }, () => ({ path: 'config', namespace: 'mock' }))
      build.onResolve({ filter: /^firebase\/functions$/ }, () => ({ path: 'functions', namespace: 'mock' }))
      build.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'mock' }))
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ resolveDir: root, contents: args.path === 'config'
        ? `import {initializeApp} from 'firebase/app'; import {getFirestore} from '@firebase/firestore'; const app=initializeApp({projectId:'isolated-support-test',apiKey:'test',appId:'test'}); export const db=getFirestore(app); export const auth={currentUser:null}; export const functions={}; export const storage={}; export default app;`
        : args.path === 'functions' ? `export const getFunctions=()=>({}); export const httpsCallable=(_,name)=>async ({module})=>{if(name!=='readBusinessSupport')throw Error('Unexpected write'); const rows=module==='products'?[{id:'p1',name:'Producto visible',stock:10,minStock:2,price:500,cost:200,active:true,category:'Vapes'}]:module==='settings'?[{id:'config',businessName:'Tienda de prueba'}]:module==='users'?[{id:'owner',name:'Dueño',role:'Administrador',active:true}]:[];return {data:{rows,nextCursor:null}};};`
        : `export * from '@firebase/firestore'; export const onSnapshot=(query,next)=>{queueMicrotask(()=>next({docs:[]}));return ()=>{}};` }))
    } }],
  })
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const cssFile = index.match(/href="(\/assets\/[^" ]+\.css)"/)[1]
  server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'")
    if (req.url === '/test.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents) }
    else if (req.url === cssFile) { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(path.join(root, 'dist', cssFile))) }
    else res.end(`<!doctype html><link rel="stylesheet" href="${cssFile}"><div id="root"></div><script src="/test.js"></script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  const errors = []
  win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message) })
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  const wait = async text => {
    for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(`document.body.innerText.includes(${JSON.stringify(text)})`)) return; await new Promise(resolve => setTimeout(resolve, 100)) }
    throw Error('Missing screen: ' + text + ' / ' + await win.webContents.executeJavaScript('document.body.innerText'))
  }
  await wait('Dashboard')
  await wait('Solo lectura')
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Inventario')).click()`)
  await wait('Producto visible')
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Recargas')).click()`)
  await wait('Recargas de Liquidos')
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('aside button')].find(b=>b.textContent.includes('Configuracion')).click()`)
  await wait('Configuracion')
  assert.equal(errors.length, 0, errors.join('\n'))
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Salir de soporte').click()`)
  assert.equal(await win.webContents.executeJavaScript('window.exited'), true)
  console.log('Real customer Dashboard, Inventory, Refills, Settings and support exit verified; no external data accessed.')
  win.destroy(); server.close(); app.exit(0)
}).catch(error => { console.error(error); win?.destroy(); server?.close(); app.exit(1) })
