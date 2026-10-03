// Hidden Chromium integration test: real downloads under a self-only script CSP.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '..')
const output = path.resolve(process.env.VAPEPOS_TEST_OUTPUT || path.join(root, 'tests/.export-downloads'))
let server, win
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true })
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import InvoiceModal from './src/components/pos/InvoiceModal.jsx';
      import { exportSalesReport } from './src/services/exportService.js';
      const sale={saleNumber:'TEST-RECEIPT',date:'2026-10-02',time:'12:00',user:'Prueba',payment:'Efectivo',subtotal:850,total:850,
        items:Array.from({length:35},(_,i)=>({name:'Producto de prueba '+i,qty:1,price:10}))};
      window.testExcel=()=>exportSalesReport([sale],'excel','Prueba',false);
      window.testReportPDF=()=>exportSalesReport([sale],'pdf','Prueba',false);
      createRoot(document.getElementById('root')).render(React.createElement(InvoiceModal,{sale,onClose:()=>{}}));`, resolveDir: root, loader: 'jsx' },
    bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'test-context', setup(build) {
      build.onResolve({ filter: /contexts\/AppContext$/ }, () => ({ path: 'test-context', namespace: 'mock' }))
      build.onResolve({ filter: /bluetoothPrinterService$/ }, () => ({ path: 'test-bluetooth', namespace: 'mock' }))
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'test-context'
        ? 'export const useApp=()=>({state:{settings:{businessName:"Prueba",paperSize:"80mm",printLogo:false}}})'
        : 'export const isBluetoothPrinterSupported=()=>false; export const printSaleByBluetooth=async()=>{}' }))
    } }],
  })
  const index = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8')
  const cssFile = index.match(/href="(\/assets\/[^" ]+\.css)"/)[1]
  server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'")
    if (req.url === '/test.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].contents) }
    else if (req.url === cssFile) { res.setHeader('Content-Type', 'text/css'); res.end(fs.readFileSync(path.join(root, 'dist', cssFile))) }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><link rel="stylesheet" href="${cssFile}"><div id="root"></div><script src="/test.js"></script>`) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  win = new BrowserWindow({ show: false, width: 500, height: 650, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  const downloads = []
  win.webContents.session.on('will-download', (_, item) => {
    const target = path.join(output, item.getFilename())
    item.setSavePath(target)
    item.once('done', (_, state) => downloads.push({ name: item.getFilename(), target, state }))
  })
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  const wait = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await predicate()) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw Error('Download or UI timeout')
  }
  await wait(() => win.webContents.executeJavaScript('!!document.querySelector("button")'))
  for (const [trigger, name] of [
    ['window.testExcel()', 'Reporte-Ventas-'],
    ['window.testReportPDF()', 'Reporte-Ventas-'],
    ['[...document.querySelectorAll("button")].find(b=>b.textContent.includes("PDF")).click()', 'Factura-TEST-RECEIPT.pdf'],
    ['[...document.querySelectorAll("button")].find(b=>b.textContent.includes("JPG")).click()', 'Factura-TEST-RECEIPT.jpg'],
  ]) {
    const count = downloads.length
    await win.webContents.executeJavaScript(trigger)
    await wait(() => downloads.length > count)
    const result = downloads.at(-1)
    assert.equal(result.state, 'completed'); assert.ok(result.name.startsWith(name))
    assert.ok(fs.statSync(result.target).size > 100)
    console.log('Download OK:', result.name)
  }
  const image = nativeImage.createFromPath(path.join(output, 'Factura-TEST-RECEIPT.jpg')).getSize()
  assert.ok(image.height > 1000, 'Long receipt must include offscreen rows')
  console.log('Full receipt JPG dimensions:', image)
  win.destroy(); server.close(); app.exit(0)
}).catch(error => { console.error(error); win?.destroy(); server?.close(); app.exit(1) })
