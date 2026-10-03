const { readFile, stat } = require('node:fs/promises')
const path = require('node:path')

const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' }
function resolveAssetPath(root, pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Ruta fuera de la aplicación')
  return resolved
}
async function registerDesktopAssets(targetSession, distRoot) {
  // Preserve the existing HTTPS origin for Auth, IndexedDB and App Check.
  // Only the application's own static assets are provided by the installed build.
  await targetSession.clearStorageData({ origin: 'https://vape-pos.store', storages: ['serviceworkers', 'cachestorage'] })
  targetSession.protocol.handle('https', async request => {
    const url = new URL(request.url)
    if (url.hostname !== 'vape-pos.store' || request.method !== 'GET') return targetSession.fetch(request, { bypassCustomProtocolHandlers: true })
    try {
      let filePath = resolveAssetPath(distRoot, url.pathname)
      try {
        if (!(await stat(filePath)).isFile()) throw new Error('No es un archivo')
      } catch {
        if (path.extname(url.pathname)) return new Response('Archivo no encontrado', { status: 404 })
        filePath = path.join(distRoot, 'index.html')
      }
      return new Response(await readFile(filePath), { headers: {
        'Content-Type': `${mimeTypes[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8`,
        'Cache-Control': path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.google.com https://www.gstatic.com https://www.recaptcha.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://firebasestorage.googleapis.com; connect-src 'self' https://www.google.com https://www.recaptcha.net https://www.gstatic.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.cloudfunctions.net; frame-src https://www.google.com https://www.recaptcha.net; object-src 'none'; base-uri 'self'",
      } })
    } catch { return new Response('No se pudo cargar el archivo de la aplicación', { status: 403 }) }
  })
}
module.exports = { registerDesktopAssets, resolveAssetPath }
