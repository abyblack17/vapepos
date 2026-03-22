import React, { useState, useEffect } from 'react'
import { useApp } from '../../contexts/AppContext'
import { usePlan } from '../../hooks/usePlan'

const PAGE_TITLES = {
  dashboard:   'Dashboard',
  pos:         'Punto de Venta',
  refills:     'Recargas de Liquidos',
  inventory:   'Inventario',
  purchases:   'Compras',
  customers:   'Clientes',
  suppliers:   'Proveedores',
  reports:     'Reportes',
  history:     'Recibos',
  insights:    'Acciones del Dia',
  cash:        'Caja',
  users:       'Usuarios',
  settings:    'Configuracion',
  suggestions: 'Sugerencias',
}

export default function TopBar({ currentPage, onMenuClick }) {
  const { state } = useApp()
  const { inGrace, daysLeft, isPro } = usePlan()
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const cashOpen = state.cashSession?.open

  return (
    <div className="flex-shrink-0">
      {/* Banner de gracia — rojo y llamativo, solo durante el día de gracia */}
      {inGrace && (
        <div className="bg-red-500/20 border-b border-red-500/30 px-4 py-2 flex items-center justify-center gap-2">
          <span className="text-red-400 text-sm font-bold animate-pulse">🚨</span>
          <span className="text-red-300 text-xs font-semibold text-center">
            Tu plan Pro ha vencido. Tienes 1 día de gracia para renovar — después tu cuenta bajará al plan Básico.
          </span>
          <span className="text-red-400 text-sm font-bold animate-pulse">🚨</span>
        </div>
      )}

      <header className="h-[56px] md:h-[60px] bg-[#0c1424] border-b border-white/5 flex items-center px-3 md:px-5 gap-3">

        {/* Boton hamburguesa — solo en movil */}
        <button
          onClick={onMenuClick}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        {/* Page title */}
        <h1 className="font-display text-base md:text-lg font-bold text-slate-100 truncate">
          {PAGE_TITLES[currentPage] || 'VapePOS'}
        </h1>

        <div className="flex-1" />

        {/* Cash status */}
        <div className={`flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 ${
          cashOpen
            ? 'bg-[#00e5a0]/10 text-[#00e5a0] border border-[#00e5a0]/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cashOpen ? 'bg-neon-green animate-pulse' : 'bg-red-400'}`} />
          <span className="hidden sm:inline">{cashOpen ? 'Caja Abierta' : 'Caja Cerrada'}</span>
          <span className="sm:hidden">{cashOpen ? 'Abierta' : 'Cerrada'}</span>
        </div>

        {/* Alerts */}
        {state.alerts.length > 0 && (
          <div className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-400/10 text-amber-400 border border-amber-400/20 flex-shrink-0">
            ⚠ {state.alerts.length}
          </div>
        )}

        {/* Clock - solo desktop */}
        <div className="text-xs text-slate-500 font-mono hidden lg:block flex-shrink-0">
          {time.toLocaleDateString('es-DO', { weekday: 'short', day: 'numeric', month: 'short' })}
          {' · '}
          {time.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </header>
    </div>
  )
}
