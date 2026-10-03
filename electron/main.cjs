const { app, BrowserWindow, dialog, shell, session } = require('electron')
const { registerDesktopAssets } = require('./desktopAssets.cjs')
const { autoUpdater } = require('electron-updater')
const path = require('node:path')
const { verifiedRoot, stageUIUpdate } = require('./uiUpdates.cjs')

const APP_NAME = 'VapePos'
const PRODUCTION_URL = 'https://vape-pos.store/'
const APP_HOSTS = new Set(['vape-pos.store', 'www.vape-pos.store'])
let mainWindow = null

function isExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return !['http:', 'https:'].includes(url.protocol) || !APP_HOSTS.has(url.hostname)
  } catch {
    return true
  }
}

function configureUpdates() {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-downloaded', async ({ version }) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Actualización disponible',
      message: `VapePos ${version} está listo para instalarse.`,
      detail: 'Esta actualización corresponde al motor de escritorio. Las pantallas se actualizan por separado. Puedes instalar ahora o dejarla para más tarde; no se instalará al cerrar Windows.',
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
  const packagedRoot = path.join(app.getAppPath(), 'dist')
  const store = path.join(app.getPath('userData'), 'ui-releases')
  const active = await verifiedRoot(store, app.getVersion())
  await registerDesktopAssets(session.defaultSession, active?.root || packagedRoot)
  // Download in the background. Activate only on the next launch, preserving sales in progress.
  const refresh = () => stageUIUpdate({ store, packagedRoot, nativeVersion: app.getVersion(), fetcher: session.defaultSession.fetch.bind(session.defaultSession) }).catch(error => console.warn('Se conserva la interfaz local:', error.message))
  setTimeout(refresh, 15000)
  let refreshing = false
  const interval = setInterval(async () => { if (refreshing) return; refreshing = true; try { await refresh() } finally { refreshing = false } }, 5 * 60 * 1000)
  app.once('before-quit', () => clearInterval(interval))
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
