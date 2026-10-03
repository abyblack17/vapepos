import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useNavigation } from '../contexts/NavigationContext'
import StatCard from '../components/ui/StatCard'
import UpgradeModal from '../components/ui/UpgradeModal'
import { fmt, today } from '../utils/helpers'
import { computeDailySummary, getTopProducts, getWeeklyChartData } from '../services/salesService'
import { usePlan } from '../hooks/usePlan'
import { useAnnouncements } from '../hooks/useAnnouncements'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a2848] border border-white/10 rounded-lg px-3 py-2 text-xs">
      <div className="text-slate-400 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { state }    = useApp()
  const { navigate } = useNavigation()
  const { isPro, isBasic, daysLeft, inGrace, usage, counts } = usePlan()
  const { sales, products, liquids, alerts, cashSession } = state
  const { announcements, error: announcementsError } = useAnnouncements()
  const [showUpgrade, setShowUpgrade]     = useState(false)

  const canViewProfit = state.currentUser?.role === 'Administrador' ||
    (state.currentUser?.permissions?.viewProfit ?? false)

  const summary      = computeDailySummary(sales)
  const topProducts  = getTopProducts(sales)
  const weeklyData   = getWeeklyChartData(sales)
  const lowStock     = products.filter(p => p.active && p.stock <= p.minStock)
  const cashTotal    = cashSession.openAmount + cashSession.sales - cashSession.expenses
  const todaySales   = sales.filter(s => s.date === today())

  // Uso de recursos para mostrar en dashboard
  const productUsage  = usage('products')
  const customerUsage = usage('customers')
  const userUsage     = usage('users')
  const salesUsage    = usage('monthlySales')

  const ANN_STYLES = {
    info:    'bg-[#00c4e8]/10 border-[#00c4e8]/20 text-[#00c4e8]',
    success: 'bg-[#00e5a0]/10 border-[#00e5a0]/20 text-[#00e5a0]',
    warning: 'bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b]',
    update:  'bg-[#8b5cf6]/10 border-[#8b5cf6]/20 text-[#a78bfa]',
  }
  const ANN_ICON = { info: '💡', success: '✅', warning: '⚠️', update: '🚀' }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Banner plan vencido ── */}
      {isPro && daysLeft !== null && daysLeft <= 0 && (
        <div className="flex items-start gap-3 rounded-xl border px-4 py-3 bg-red-500/10 border-red-500/20 text-red-400 cursor-pointer"
          onClick={() => setShowUpgrade(true)}>
          <span className="text-lg shrink-0">⚠️</span>
          <div className="flex-1">
            <div className="font-semibold text-sm">Tu plan Pro ha vencido</div>
            <div className="text-xs opacity-80 mt-0.5">
              Tu cuenta fue degradada al plan Básico. Algunos datos y funciones están limitados.
              Renueva para recuperar el acceso completo.
            </div>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 font-semibold whitespace-nowrap">
            Renovar Pro
          </button>
        </div>
      )}

      {/* ── Banner plan por vencer (7 días o menos) ── */}
      {isPro && daysLeft !== null && daysLeft > 0 && daysLeft <= 7 && (
        <div className="flex items-start gap-3 rounded-xl border px-4 py-3 bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b] cursor-pointer"
          onClick={() => setShowUpgrade(true)}>
          <span className="text-lg shrink-0">⚡</span>
          <div className="flex-1">
            <div className="font-semibold text-sm">Tu plan Pro vence en {daysLeft} día{daysLeft !== 1 ? 's' : ''}</div>
            <div className="text-xs opacity-80 mt-0.5">Renueva ahora para no perder el acceso a todas las funciones Pro.</div>
          </div>
          <button className="text-xs px-3 py-1.5 rounded-lg bg-[#f59e0b]/20 border border-[#f59e0b]/30 font-semibold whitespace-nowrap">
            Renovar
          </button>
        </div>
      )}

      {/* ── Banner límites cercanos en plan básico ── */}
      {isBasic && (
        <>
          {productUsage.nearLimit && (
            <div className="flex items-center gap-3 rounded-xl border px-4 py-3 bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b] cursor-pointer"
              onClick={() => setShowUpgrade(true)}>
              <span>⚠</span>
              <span className="text-xs flex-1">Tienes {productUsage.current}/{productUsage.limit} productos. Cerca del límite del plan Básico.</span>
              <span className="text-xs font-semibold underline">Actualizar a Pro</span>
            </div>
          )}
          {salesUsage.nearLimit && (
            <div className="flex items-center gap-3 rounded-xl border px-4 py-3 bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b] cursor-pointer"
              onClick={() => setShowUpgrade(true)}>
              <span>⚠</span>
              <span className="text-xs flex-1">Tienes {salesUsage.current}/{salesUsage.limit} ventas este mes. Cerca del límite del plan Básico.</span>
              <span className="text-xs font-semibold underline">Actualizar a Pro</span>
            </div>
          )}
          {salesUsage.atLimit && (
            <div className="flex items-center gap-3 rounded-xl border px-4 py-3 bg-red-500/10 border-red-500/20 text-red-400 cursor-pointer"
              onClick={() => setShowUpgrade(true)}>
              <span>🔒</span>
              <span className="text-xs flex-1">Has alcanzado el límite de {salesUsage.limit} ventas mensuales del plan Básico. No puedes registrar más ventas este mes.</span>
              <span className="text-xs font-semibold underline">Actualizar a Pro</span>
            </div>
          )}
        </>
      )}

      {/* Anuncios del sistema */}
      {announcementsError && <div className="alert-danger text-xs">{announcementsError}</div>}
      {announcements.map(a => (
        <button key={a.id} type="button" onClick={() => navigate('insights')}
          className={`w-full text-left flex items-center gap-3 rounded-xl border px-4 py-3 ${ANN_STYLES[a.type] || ANN_STYLES.info}`}>
          <span className="text-lg shrink-0">{ANN_ICON[a.type] || '📢'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider opacity-70">Nuevo anuncio</div>
            <div className="font-semibold text-sm truncate">{a.title}</div>
          </div>
          <span className="text-xs font-semibold whitespace-nowrap">Leer en Acciones →</span>
        </button>
      ))}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Ventas Hoy" value={fmt(summary.totalSales)} sub={`${summary.transactionCount} transacciones`} accent="green" icon="💵" onClick={() => navigate('history')} />
        <StatCard label="Recargas Hoy" value={summary.totalRefills} sub="operaciones de recarga" accent="blue" icon="💧" onClick={() => navigate('refills')} />
        {canViewProfit && <StatCard label="Ganancia Estimada" value={fmt(summary.totalProfit)} sub={`Ticket avg: ${fmt(summary.avgTicket)}`} accent="purple" icon="📈" onClick={() => navigate('reports')} />}
        <StatCard label="Caja Actual" value={fmt(cashTotal)} sub={`Apertura: ${fmt(cashSession.openAmount)}`} accent="amber" icon="💰" onClick={() => navigate('cash')} />
      </div>

      {/* Plan básico — resumen de uso de límites */}
      {isBasic && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-slate-300">Uso del plan Básico</div>
            <button onClick={() => setShowUpgrade(true)} className="text-xs text-[#00e5a0] hover:underline">⚡ Actualizar a Pro</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Productos',       u: productUsage  },
              { label: 'Clientes',        u: customerUsage },
              { label: 'Empleados',       u: userUsage     },
              { label: 'Ventas del mes',  u: salesUsage    },
            ].map(({ label, u }) => (
              <div key={label} className="bg-[#101c35] rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <div className="text-sm font-bold text-slate-200">
                  {u.current} <span className="text-slate-500 font-normal">/ {u.limit === Infinity ? '∞' : u.limit}</span>
                </div>
                {u.limit !== Infinity && (
                  <div className="mt-1.5 h-1 bg-[#1a2848] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${u.atLimit ? 'bg-red-500' : u.nearLimit ? 'bg-[#f59e0b]' : 'bg-[#00e5a0]'}`}
                      style={{ width: `${Math.min(100, u.pct)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <div className="col-span-1 md:col-span-2 card p-4 md:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title mb-0">Ventas esta semana</h3>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={weeklyData}>
              <defs>
                <linearGradient id="ventas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00e5a0" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#00e5a0" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ganancia" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `RD$${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="ventas" name="Ventas" stroke="#00e5a0" strokeWidth={2} fill="url(#ventas)" />
              <Area type="monotone" dataKey="ganancia" name="Ganancia" stroke="#8b5cf6" strokeWidth={2} fill="url(#ganancia)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h3 className="section-title">Alertas del Sistema</h3>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-[#00e5a0] text-xs bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded-lg p-3">
              ✓ Todo en orden
            </div>
          ) : (
            <div className="space-y-2 max-h-[180px] overflow-y-auto">
              {alerts.map(a => (
                <div key={a.id} className={`text-xs rounded-lg p-2.5 flex items-start gap-2 ${a.type === 'danger' ? 'alert-danger' : 'alert-warning'}`}>
                  <span className="flex-shrink-0">{a.type === 'danger' ? '🔴' : '⚠️'}</span>
                  <span>{a.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <div className="card p-5">
          <h3 className="section-title">Top Productos</h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-500">Sin ventas registradas</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-300 truncate max-w-[60%]">{p.name}</span>
                    <span className="font-mono font-bold text-[#00e5a0]">{p.qty} uds</span>
                  </div>
                  <div className="bottle-progress">
                    <div className="h-full bottle-fill-green rounded" style={{ width: `${Math.round(p.qty / (topProducts[0]?.qty || 1) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h3 className="section-title">Top Líquidos</h3>
          <div className="space-y-3">
            {liquids.sort((a, b) => b.totalRechargesAllTime - a.totalRechargesAllTime).slice(0, 4).map(l => (
              <div key={l.id}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300 truncate max-w-[60%]">{l.name}</span>
                  <span className="font-mono font-bold text-[#00c4e8]">{l.totalRechargesAllTime} rec</span>
                </div>
                <div className="bottle-progress">
                  <div className="h-full bottle-fill-green rounded" style={{ width: `${Math.min(100, Math.round(l.totalRechargesAllTime / 25 * 100))}%`, background: 'linear-gradient(90deg, #00c4e8, #0090b0)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h3 className="section-title">Últimas Ventas</h3>
          <div className="space-y-2">
            {sales.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-200 truncate">{s.customerName || 'Cliente general'}</div>
                  <div className="text-xs text-slate-500">{s.time} · {s.payment}</div>
                </div>
                <div className="text-sm font-mono font-bold text-[#00e5a0]">{fmt(s.total)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
