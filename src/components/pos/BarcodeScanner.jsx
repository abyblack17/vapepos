import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef  = useRef(null)
  const streamRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError]       = useState(null)

  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setScanning(true)
        detectBarcode()
      }
    } catch (err) {
      setError('No se pudo acceder a la camara. Verifica los permisos.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
    }
  }

  const detectBarcode = async () => {
    // Use BarcodeDetector API (native in Chrome Android)
    if (!('BarcodeDetector' in window)) {
      // Fallback: manual input
      setError('Tu navegador no soporta el lector automatico. Ingresa el codigo manualmente.')
      return
    }

    const detector = new window.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e']
    })

    const scan = async () => {
      if (!videoRef.current || !streamRef.current) return
      try {
        const barcodes = await detector.detect(videoRef.current)
        if (barcodes.length > 0) {
          const code = barcodes[0].rawValue
          stopCamera()
          onDetected(code)
          return
        }
      } catch {}
      // Keep scanning
      if (streamRef.current?.active) {
        requestAnimationFrame(scan)
      }
    }
    videoRef.current?.addEventListener('playing', () => requestAnimationFrame(scan), { once: true })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <div className="w-full max-w-sm mx-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-white font-semibold">Escanear Codigo</div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        {error ? (
          <div className="space-y-3">
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl p-4">{error}</div>
            <ManualInput onDetected={(code) => { onDetected(code) }} onClose={onClose} />
          </div>
        ) : (
          <>
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              {/* Scanning overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 border-2 border-[#00e5a0] rounded-lg relative">
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-[#00e5a0] rounded-tl"></div>
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-[#00e5a0] rounded-tr"></div>
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-[#00e5a0] rounded-bl"></div>
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-[#00e5a0] rounded-br"></div>
                  {scanning && (
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-[#00e5a0] animate-bounce" style={{ animationDuration: '1.5s' }} />
                  )}
                </div>
              </div>
            </div>
            <div className="text-center text-slate-400 text-sm">Apunta la camara al codigo de barras</div>
            <ManualInput onDetected={(code) => { stopCamera(); onDetected(code) }} onClose={onClose} />
          </>
        )}
      </div>
    </div>
  )
}

function ManualInput({ onDetected, onClose }) {
  const [code, setCode] = useState('')
  return (
    <div className="flex gap-2">
      <input
        className="input flex-1 font-mono text-sm"
        placeholder="Ingresar codigo manualmente..."
        value={code}
        onChange={e => setCode(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && code.trim()) { onDetected(code.trim()); onClose() } }}
        autoFocus
      />
      <button
        onClick={() => { if (code.trim()) { onDetected(code.trim()); onClose() } }}
        className="btn-primary text-sm px-3"
      >Buscar</button>
    </div>
  )
}
