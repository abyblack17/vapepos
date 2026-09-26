const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('vapePosDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
}))
