import React, { useState } from 'react'
import { useApp } from '../../contexts/AppContext'
import { useAuth } from '../../contexts/AuthContext'
import { canDo } from '../../utils/helpers'
import { usePlan } from '../../hooks/usePlan'
import UpgradeModal from '../ui/UpgradeModal'
import { APP_VERSION } from '../../version'

const NAV_ITEMS = [
  { id: 'dashboard',   icon: '◈',  label: 'Dashboard'     },
  { id: 'insights',    icon: '💡', label: 'Acciones'      },
  { id: 'pos',         icon: '⊞',  label: 'Ventas / POS'  },
  { id: 'refills',     icon: '◉',  label: 'Recargas'      },
  { id: 'history',     icon: '🧾', label: 'Recibos'       },
  { id: 'inventory',   icon: '▦',  label: 'Inventario'    },
  { id: 'purchases',   icon: '🛒', label: 'Compras'       },
  { id: 'customers',   icon: '◍',  label: 'Clientes'      },
  { id: 'suppliers',   icon: '⬡',  label: 'Proveedores'   },
  { id: 'reports',     icon: '◫',  label: 'Reportes'      },
  { id: 'fiscal',      icon: '▣',  label: 'Fiscal / NCF'  },
  { id: 'cash',        icon: '◎',  label: 'Caja'          },
  { id: 'users',       icon: '⊙',  label: 'Usuarios'      },
  { id: 'settings',    icon: '◈',  label: 'Configuracion' },
  { id: 'suggestions', icon: '💬', label: 'Sugerencias'   },
]

const PAGE_PERMISSION = {
  history:     'reports',
  purchases:   'inventory',
  suggestions: 'suggestions',
  suppliers:   'suppliers',
  fiscal:      'settings',
}

const PRO_ITEMS = ['suppliers']

export default function Sidebar({ currentPage, onNavigate }) {
  const { state }    = useApp()
  const { business }   = useAuth()
  const { hasFeature, isPro, daysLeft, inGrace, isTrial } = usePlan()
  const { currentUser, alerts } = state
  const role = currentUser?.role || 'Cajero'
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showPlanInfo, setShowPlanInfo] = useState(false)

  const alertsByModule = alerts.reduce((acc, a) => {
    acc[a.module] = (acc[a.module] || 0) + 1
    return acc
  }, {})

  // Alertas de vencimiento
  const showExpiryWarning = isPro && daysLeft !== null && daysLeft <= 7 && daysLeft > 0
  const showGraceBanner   = inGrace  // durante el día de gracia (solo pago, no trial)
  const showExpiredBanner = isPro && daysLeft !== null && daysLeft < -1 // ya venció y pasó gracia

  // Fecha de vencimiento formateada
  const expiresDate = business?.planExpiresAt
    ? (business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)).toLocaleDateString('es-DO', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return (
    <>
    <aside className="w-56 bg-[#0c1424] border-r border-white/5 flex flex-col flex-shrink-0 overflow-hidden" style={{height: '100dvh'}}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/5">
        <div className="font-display text-2xl font-black gradient-neon tracking-tight">VapePOS</div>
        <div className="text-xs text-slate-500 uppercase tracking-widest mt-0.5 font-mono">Sistema POS Vape</div>
        <div className="text-xs text-slate-600 font-mono mt-0.5">{APP_VERSION}</div>
      </div>

      {/* Banner 7 días antes */}
      {showExpiryWarning && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 cursor-pointer hover:bg-[#f59e0b]/15 transition-all"
          onClick={() => setShowUpgrade(true)}>
          <div className="text-xs font-bold text-[#f59e0b]">⚡ Vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}</div>
          <div className="text-xs text-slate-400 mt-0.5">Toca para renovar</div>
        </div>
      )}

      {/* Banner día de gracia — solo planes de pago */}
      {showGraceBanner && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 cursor-pointer animate-pulse hover:animate-none hover:bg-red-500/15 transition-all"
          onClick={() => setShowUpgrade(true)}>
          <div className="text-xs font-bold text-red-400">🚨 Plan vencido — 1 día de gracia</div>
          <div className="text-xs text-slate-400 mt-0.5">Renueva hoy para no perder acceso</div>
        </div>
      )}

      {/* Banner plan vencido (pasó la gracia) */}
      {showExpiredBanner && !showGraceBanner && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 cursor-pointer"
          onClick={() => setShowUpgrade(true)}>
          <div className="text-xs font-bold text-red-400">⚠ Plan vencido</div>
          <div className="text-xs text-slate-400 mt-0.5">Tu cuenta volvió al plan Básico</div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-0.5">
        {NAV_ITEMS.map(item => {
          const permKey   = PAGE_PERMISSION[item.id] || item.id
          const isProItem = PRO_ITEMS.includes(item.id)

          // Configuración siempre está disponible para cuenta/sesión. La página
          // protege por separado los ajustes administrativos del negocio.
          if (item.id !== 'settings' && !canDo(currentUser, permKey) && !isProItem) return null
          if (isProItem && !canDo(currentUser, permKey)) return null

          const isActive   = currentPage === item.id
          const badgeCount = alertsByModule[item.id] || 0
          const isLocked   = isProItem && !hasFeature(permKey)

          if (isLocked) {
            return (
              <button key={item.id}
                onClick={() => setShowUpgrade(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                           transition-all duration-150 cursor-pointer text-left
                           text-slate-600 hover:bg-[#1a2848]/50 hover:text-slate-500">
                <span className="text-base font-mono opacity-50">{item.icon}</span>
                <span className="flex-1 opacity-50">{item.label}</span>
                <span className="text-[#f59e0b] text-xs">🔒</span>
              </button>
            )
          }

          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                          transition-all duration-150 cursor-pointer text-left ${
                isActive
                  ? 'bg-[#00e5a0]/10 text-[#00e5a0] border border-[#00e5a0]/20'
                  : 'text-slate-400 hover:bg-[#1a2848] hover:text-slate-200'
              }`}>
              <span className="text-base font-mono">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {badgeCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* User + Plan badge + Logout */}
      <div className="px-3 py-4 border-t border-white/5 space-y-2 pb-28 md:pb-4">
        {/* Plan badge — clickable para ver info */}
        <button
          onClick={() => setShowPlanInfo(true)}
          className={`w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition-all hover:bg-white/5 ${
            showGraceBanner ? 'animate-pulse' : ''
          }`}
        >
          <span className="text-xs text-slate-500">Plan actual</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            showGraceBanner
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : isPro
                ? 'bg-[#00e5a0]/10 text-[#00e5a0] border border-[#00e5a0]/20'
                : 'bg-slate-700/50 text-slate-400 border border-white/10'
          }`}>
            {showGraceBanner ? '🚨 Vencido' : isPro ? '⚡ Pro' : 'Básico'}
          </span>
        </button>

        {/* Upgrade button — solo en básico */}
        {!isPro && (
          <button onClick={() => setShowUpgrade(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold
                       bg-[#00e5a0]/10 border border-[#00e5a0]/20 text-[#00e5a0]
                       hover:bg-[#00e5a0]/20 transition-all">
            ⚡ Actualizar a Pro
          </button>
        )}

        {/* User info */}
        <div className="flex items-center gap-3 px-3 py-2.5 bg-[#101c35] rounded-lg overflow-hidden">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00e5a0] to-[#00c4e8] flex items-center justify-center text-xs font-bold text-[#080d18] flex-shrink-0">
            {(currentUser?.name || currentUser?.email || 'A')?.[0]?.toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-200 truncate leading-tight">{currentUser?.name || 'Admin'}</div>
            <div className="text-[11px] text-slate-500 truncate leading-tight">{currentUser?.email || ''}</div>
            <div className="text-xs text-[#00e5a0] truncate leading-tight">{role}</div>
          </div>
        </div>
      </div>
    </aside>

    {/* Modal info del plan */}
    {showPlanInfo && (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-[#0c1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-100 text-lg">Estado del Plan</div>
            <button onClick={() => setShowPlanInfo(false)} className="text-slate-500 hover:text-slate-300 text-xl">✕</button>
          </div>

          {/* Badge del plan */}
          <div className={`rounded-xl p-4 text-center ${
            showGraceBanner
              ? 'bg-red-500/10 border border-red-500/20'
              : isPro
                ? 'bg-[#00e5a0]/10 border border-[#00e5a0]/20'
                : 'bg-slate-700/20 border border-white/10'
          }`}>
            <div className="text-3xl mb-2">{showGraceBanner ? '🚨' : isPro ? '⚡' : '📦'}</div>
            <div className={`font-display font-black text-xl ${
              showGraceBanner ? 'text-red-400' : isPro ? 'text-[#00e5a0]' : 'text-slate-300'
            }`}>
              {showGraceBanner ? 'Plan Vencido' : isPro ? 'Plan Pro' : 'Plan Básico'}
            </div>
            {isTrial && isPro && !showGraceBanner && (
              <div className="text-xs text-[#a78bfa] mt-1">Período de prueba gratuita</div>
            )}
          </div>

          {/* Detalles */}
          <div className="space-y-2">
            {isPro && expiresDate && (
              <div className="flex justify-between items-center bg-[#101c35] rounded-lg px-3 py-2.5">
                <span className="text-xs text-slate-400">Fecha de vencimiento</span>
                <span className="text-xs font-semibold text-slate-200">{expiresDate}</span>
              </div>
            )}

            {isPro && daysLeft !== null && daysLeft > 0 && (
              <div className="flex justify-between items-center bg-[#101c35] rounded-lg px-3 py-2.5">
                <span className="text-xs text-slate-400">Tiempo restante</span>
                <span className={`text-xs font-bold ${daysLeft <= 7 ? 'text-[#f59e0b]' : 'text-[#00e5a0]'}`}>
                  {daysLeft} día{daysLeft !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {showGraceBanner && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-3 text-xs text-red-300 text-center leading-relaxed">
                Tu plan venció. Tienes <strong>1 día de gracia</strong> para renovar antes de que tu cuenta baje al plan Básico y se bloqueen los datos extra.
              </div>
            )}

            {!isPro && (
              <div className="bg-[#101c35] rounded-lg px-3 py-2.5 text-xs text-slate-400 text-center">
                Actualiza a Pro para desbloquear todas las funciones sin límites.
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex gap-2">
            <button onClick={() => setShowPlanInfo(false)} className="btn-secondary flex-1">Cerrar</button>
            {(!isPro || showGraceBanner || (isPro && daysLeft !== null && daysLeft <= 7)) && (
              <button onClick={() => { setShowPlanInfo(false); setShowUpgrade(true) }} className="btn-primary flex-1">
                {showGraceBanner ? '🚨 Renovar ahora' : isPro ? '⚡ Renovar' : '⚡ Actualizar a Pro'}
              </button>
            )}
          </div>
        </div>
      </div>
    )}

    {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </>
  )
}
