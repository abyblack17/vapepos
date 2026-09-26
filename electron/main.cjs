const { app, BrowserWindow, dialog, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const { createServer } = require('node:http')
const { readFile, stat } = require('node:fs/promises')
const path = require('node:path')

const APP_NAME = 'VapePos'
const APP_ORIGIN_HOST = '127.0.0.1'
const PRODUCTION_URL = 'https://vape-pos.store/'
const APP_HOSTS = new Set(['vape-pos.store', 'www.vape-pos.store', APP_ORIGIN_HOST])
let mainWindow = null
let localServer = null

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function isExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return !['http:', 'https:'].includes(url.protocol) || !APP_HOSTS.has(url.hostname)
  } catch {
    return true
  }
}

async function startLocalServer() {
  const distRoot = path.join(app.getAppPath(), 'dist')

  localServer = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `http://${APP_ORIGIN_HOST}`)
      const decodedPath = decodeURIComponent(requestUrl.pathname)
      const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
      let filePath = path.resolve(distRoot, relativePath)

      if (!filePath.startsWith(`${path.resolve(distRoot)}${path.sep}`) && filePath !== path.join(distRoot, 'index.html')) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      try {
        const fileInfo = await stat(filePath)
        if (fileInfo.isDirectory()) filePath = path.join(filePath, 'index.html')
      } catch {
        filePath = path.join(distRoot, 'index.html')
      }

      const body = await readFile(filePath)
      response.writeHead(200, {
        'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(body)
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('No se pudo iniciar VapePos.')
      console.error(error)
    }
  })

  return new Promise((resolve, reject) => {
    localServer.once('error', reject)
    localServer.listen(0, APP_ORIGIN_HOST, () => {
      const address = localServer.address()
      resolve(`http://${APP_ORIGIN_HOST}:${address.port}`)
    })
  })
}

function configureUpdates() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', async ({ version }) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Actualización disponible',
      message: `VapePos ${version} está listo para instalarse.`,
      detail: 'Puedes reiniciar ahora o continuar trabajando. La actualización también se instalará cuando cierres la aplicación.',
      buttons: ['Reiniciar e instalar', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response === 0) autoUpdater.quitAndInstall(false, true)
  })

  autoUpdater.on('error', (error) => console.warn('Actualización no disponible:', error.message))
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000)
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#080d18',
    icon: path.join(__dirname, '..', 'resources', 'icon_1024.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (['http:', 'https:'].includes(new URL(url).protocol)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    configureUpdates()
  })

  mainWindow.on('closed', () => { mainWindow = null })
  await mainWindow.loadURL(PRODUCTION_URL)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(createMainWindow).catch((error) => {
    dialog.showErrorBox('VapePos', `No se pudo iniciar la aplicación.\n\n${error.message}`)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (localServer) localServer.close()
})
