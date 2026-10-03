const { app, BrowserWindow, session } = require('electron')
const { createServer } = require('node:http')
const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
app.setPath('userData', path.resolve(__dirname, '../.test-desktop-profile'))
const root = path.resolve(__dirname, '../dist')
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  const file = path.join(root, pathname === '/' ? 'index.html' : pathname)
  if (!file.startsWith(root + path.sep) || !existsSync(file)) { response.statusCode = 404; return response.end() }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream'
  response.setHeader('Content-Type', type)
  response.end(readFileSync(file))
})
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(17821, '127.0.0.1', resolve))
  const target = session.fromPartition(`persist:pwa-test-${Date.now()}`)
  target.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (details, callback) => callback({ cancel: true }))
  const window = new BrowserWindow({ show: false, webPreferences: { session: target, nodeIntegration: false, contextIsolation: true, sandbox: true } })
  await window.loadURL('http://127.0.0.1:17821/')
  const cached = await window.webContents.executeJavaScript(`(async()=>{
    await navigator.serviceWorker.register('/sw.js');
    await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker installation timed out')),20000))]);
    const names=await caches.keys();const cache=await caches.open(names.find(name=>name.startsWith('vapepos-offline-')));
    return (await cache.keys()).map(request=>new URL(request.url).pathname);
  })()`)
  const assets = JSON.parse(readFileSync(path.join(root, 'offline-assets.json'), 'utf8'))
  assert.ok(assets.every(asset => cached.includes('/' + asset)), 'Not all lazy modules were precached')
  await new Promise(resolve => server.close(resolve))
  await window.loadURL('http://127.0.0.1:17821/')
  const offline = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const check=()=>{if(document.body.innerText.includes('Iniciar Sesion'))return resolve(document.body.innerText);if(Date.now()>deadline)return reject(new Error(document.body.innerText));setTimeout(check,100)};check()})`)
  assert.match(offline, /Entrar al Sistema/)
  const module = assets.find(asset => asset.includes('/Refills-'))
  const result = await window.webContents.executeJavaScript(`fetch(${JSON.stringify('/' + module)}).then(response=>response.ok)`)
  assert.equal(result, true)
  console.log(`PASS pwa-cache: ${assets.length} módulos guardados; reinicio sin servidor y carga del módulo de recargas verificados.`)
  window.destroy(); app.quit()
}).catch(error => { console.error(error); server.close(); app.exit(1) })
