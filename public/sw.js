const CACHE_NAME = 'vapepos-offline-v1'

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
]

// Instalar y tomar control inmediatamente
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(STATIC_ASSETS)
      const html = await (await cache.match('/index.html')).text()
      const bundled = await (await fetch('/offline-assets.json', { cache: 'no-store' })).json()
      const assets = [...bundled.map(name => `/${name}`), ...[...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(match => match[1])]
      await cache.addAll([...new Set(assets)])
    })
  )
  // Forzar activacion sin esperar a que cierren las pestanas
  // Activate when the running checkout is closed.
})

// Activar, limpiar caches viejos y tomar control de todos los clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith('vapepos-') && name !== CACHE_NAME && !name.startsWith('vapepos-offline-'))
          .map((name) => caches.delete(name))
      )
    ).then(() => {
      // Tomar control de todas las pestanas/tabs abiertas inmediatamente
      return self.clients.claim()
    })
  )
})

// Estrategia: Network first para HTML, cache first para assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/sw.js') return

  // HTML — siempre red primero para detectar updates
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request, { signal: AbortSignal.timeout(2500) })
        .then((response) => {
          if (!response.ok) throw new Error('No se pudo cargar la aplicación')
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(() => caches.open(CACHE_NAME).then(cache => cache.match('/index.html')))
    )
    return
  }

  // Código y estilos — red primero para recibir cada deploy inmediatamente.
  if (event.request.destination === 'script' || event.request.destination === 'style') {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // Assets estaticos — cache first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
        return response
      }).catch(() => caches.match('/index.html'))
    })
  )
})
