const CACHE_NAME = 'vapepos-v1.5-pwa-fullscreen'

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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  // Forzar activacion sin esperar a que cierren las pestanas
  self.skipWaiting()
})

// Activar, limpiar caches viejos y tomar control de todos los clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
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

  // Firebase y APIs — siempre red
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('firebaseio') ||
    url.hostname.includes('firebasestorage') ||
    url.hostname.includes('fonts.g')
  ) {
    return
  }

  // HTML — siempre red primero para detectar updates
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          return response
        })
        .catch(() => caches.match('/index.html'))
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
