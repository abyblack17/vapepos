import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
if (isStandalone) document.documentElement.classList.add('standalone')
document.addEventListener('fullscreenchange', () => document.documentElement.classList.toggle('fullscreen', Boolean(document.fullscreenElement)))
if ('serviceWorker' in navigator && import.meta.env.PROD && !window.vapePosDesktop?.isDesktop) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Caché de aplicación pendiente:', error))
    navigator.storage?.persist?.().catch(() => {})
  })
}
const fonts = document.createElement('link')
fonts.rel = 'stylesheet'
fonts.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap'
document.head.appendChild(fonts)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
