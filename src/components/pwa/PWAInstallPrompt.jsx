import React, { useEffect, useState } from 'react'

const isStandaloneMode = () => (
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  window.navigator.standalone === true
)

export default function PWAInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const dismissed = localStorage.getItem('vapepos-pwa-tip-dismissed') === '1'
    const updateModes = () => {
      setStandalone(isStandaloneMode())
      setFullscreen(Boolean(document.fullscreenElement))
    }

    updateModes()

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
      if (!dismissed && !isStandaloneMode()) setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener?.('change', updateModes)
    document.addEventListener('fullscreenchange', updateModes)

    const fallbackTimer = window.setTimeout(() => {
      if (!dismissed && !isStandaloneMode()) setVisible(true)
    }, 1500)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      media?.removeEventListener?.('change', updateModes)
      document.removeEventListener('fullscreenchange', updateModes)
      window.clearTimeout(fallbackTimer)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem('vapepos-pwa-tip-dismissed', '1')
    setVisible(false)
  }

  const install = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice.catch(() => null)
    setInstallPrompt(null)
    setVisible(false)
  }

  const requestFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
      } else {
        await document.exitFullscreen?.()
      }
    } catch {
      // Algunos navegadores solo permiten fullscreen tras instalar la PWA.
    }
  }

  if (standalone || !visible) return null

  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <div className="pwa-install-tip" role="dialog" aria-label="Instalar VapePOS">
      <div className="min-w-0">
        <div className="font-bold text-slate-100 text-sm">Usar VapePOS como app</div>
        <div className="text-xs text-slate-400 leading-snug">
          {isiOS
            ? 'En iPhone/iPad: Compartir → Agregar a pantalla de inicio para ocultar la barra del navegador.'
            : 'Instala la app para abrirla sin barra del navegador y con experiencia pantalla completa.'}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {installPrompt && (
          <button type="button" onClick={install} className="pwa-install-btn">
            Instalar
          </button>
        )}
        <button type="button" onClick={requestFullscreen} className="pwa-ghost-btn">
          {fullscreen ? 'Salir' : 'Full'}
        </button>
        <button type="button" onClick={dismiss} className="pwa-close-btn" aria-label="Cerrar">
          ×
        </button>
      </div>
    </div>
  )
}
