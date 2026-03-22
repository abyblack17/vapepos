// ============================================================
// ProGate.jsx — Bloquea features Pro visualmente
//
// Uso básico (bloquea un bloque completo):
//   <ProGate feature="suppliers">
//     <Suppliers />
//   </ProGate>
//
// Uso como botón bloqueado:
//   <ProGate feature="exportReports" mode="button" label="Exportar PDF">
//     <button onClick={handleExport}>Exportar PDF</button>
//   </ProGate>
//
// Uso inline (sin children, solo muestra candado):
//   <ProGate feature="refillRendimiento" mode="inline" />
// ============================================================

import React, { useState } from 'react'
import { usePlan } from '../../hooks/usePlan'
import UpgradeModal from './UpgradeModal'

export default function ProGate({ feature, children, mode = 'block', label = '' }) {
  const { hasFeature, upgradeMessage } = usePlan()
  const [showUpgrade, setShowUpgrade]  = useState(false)

  const allowed = hasFeature(feature)

  if (allowed) return <>{children}</>

  const message = upgradeMessage(feature)

  // ── Modo block: reemplaza el contenido con un placeholder ─
  if (mode === 'block') {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center space-y-4 animate-fade-in">
          <div className="w-16 h-16 rounded-2xl bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center">
            <span className="text-3xl">🔒</span>
          </div>
          <div>
            <div className="font-display font-bold text-slate-100 text-lg mb-1">Función Pro</div>
            <div className="text-slate-400 text-sm max-w-xs">{message}</div>
          </div>
          <button
            onClick={() => setShowUpgrade(true)}
            className="btn-primary text-sm px-6"
          >
            ⚡ Actualizar a Pro
          </button>
        </div>
        {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      </>
    )
  }

  // ── Modo button: muestra el botón deshabilitado con candado ─
  if (mode === 'button') {
    return (
      <>
        <button
          onClick={() => setShowUpgrade(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium
                     bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b]
                     hover:bg-[#f59e0b]/20 transition-all"
          title={message}
        >
          <span>🔒</span>
          <span>{label || 'Pro'}</span>
        </button>
        {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      </>
    )
  }

  // ── Modo inline: solo el candado pequeño ──────────────────
  if (mode === 'inline') {
    return (
      <>
        <span
          onClick={() => setShowUpgrade(true)}
          className="inline-flex items-center gap-1 text-xs text-[#f59e0b] cursor-pointer hover:underline"
          title={message}
        >
          🔒 Pro
        </span>
        {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
      </>
    )
  }

  return null
}
