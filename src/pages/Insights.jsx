import React, { useMemo } from 'react'
import { useApp } from '../contexts/AppContext'
import { useNavigation } from '../contexts/NavigationContext'
import { fmt, today } from '../utils/helpers'

export default function Insights() {
  const { state }    = useApp()
  const { navigate } = useNavigation()
  const { products, customers, sales, liquids } = state

  const todayStr = today()

  const insights = useMemo(() => {
    const actions = []

    // 1. Productos con stock bajo
    const lowStock = products.filter(p => p.active && p.stock <= (p.minStock || 5) && p.stock > 0)
    if (lowStock.length > 0) {
      actions.push({
        type:     'warning',
        icon:     '📦',
        title:    `${lowStock.length} producto${lowStock.length > 1 ? 's' : ''} con stock bajo`,
        desc:     lowStock.slice(0, 3).map(p => `${p.name} (${p.stock} uds)`).join(', ') + (lowStock.length > 3 ? '...' : ''),
        action:   'Ver Inventario',
        navigate: 'inventory',
        priority: 1,
      })
    }

    // 2. Productos sin stock
    const noStock = products.filter(p => p.active && p.stock === 0)
    if (noStock.length > 0) {
      actions.push({
        type:     'danger',
        icon:     '🚫',
        title:    `${noStock.length} producto${noStock.length > 1 ? 's' : ''} sin stock`,
        desc:     noStock.slice(0, 3).map(p => p.name).join(', ') + (noStock.length > 3 ? '...' : ''),
        action:   'Ver Inventario',
        navigate: 'inventory',
        priority: 0,
      })
    }

    // 3. Productos de baja rotacion (menos de 2 ventas en 30 dias)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const recentSales = sales.filter(s => new Date(s.date) >= thirtyDaysAgo)
    const productSales = {}
    recentSales.forEach(s => {
      s.items?.forEach(i => {
        productSales[i.productId] = (productSales[i.productId] || 0) + (i.qty || 1)
      })
    })
    const slowProducts = products.filter(p =>
      p.active && p.stock > 0 && (productSales[p.id] || 0) < 2
    )
    if (slowProducts.length > 0) {
      actions.push({
        type:     'info',
        icon:     '🐢',
        title:    `${slowProducts.length} producto${slowProducts.length > 1 ? 's' : ''} de baja rotacion`,
        desc:     `Menos de 2 ventas en 30 dias: ${slowProducts.slice(0, 3).map(p => p.name).join(', ')}${slowProducts.length > 3 ? '...' : ''}`,
        tip:      'Considera hacer una promocion para moverlos',
        action:   'Ver Inventario',
        navigate: 'inventory',
        priority: 3,
      })
    }

    // 4. Clientes inactivos +20 dias
    const twentyDaysAgo = new Date()
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20)
    const inactiveCustomers = customers.filter(c => {
      if (!c.lastPurchase) return false
      return new Date(c.lastPurchase) < twentyDaysAgo
    })
    if (inactiveCustomers.length > 0) {
      actions.push({
        type:     'info',
        icon:     '👤',
        title:    `${inactiveCustomers.length} cliente${inactiveCustomers.length > 1 ? 's' : ''} inactivo${inactiveCustomers.length > 1 ? 's' : ''}`,
        desc:     `Sin compras en mas de 20 dias: ${inactiveCustomers.slice(0, 3).map(c => c.name).join(', ')}${inactiveCustomers.length > 3 ? '...' : ''}`,
        tip:      'Podrias contactarlos con una oferta especial',
        action:   'Ver Clientes',
        navigate: 'customers',
        priority: 4,
      })
    }

    // 5. Creditos pendientes
    const totalCredits = customers.reduce((a, c) => a + (c.creditBalance || 0), 0)
    if (totalCredits > 0) {
      const debtors = customers.filter(c => c.creditBalance > 0)
      actions.push({
        type:     'warning',
        icon:     '💳',
        title:    `${fmt(totalCredits)} en creditos pendientes`,
        desc:     `${debtors.length} cliente${debtors.length > 1 ? 's' : ''} con deuda: ${debtors.slice(0,2).map(c => `${c.name} (${fmt(c.creditBalance)})`).join(', ')}`,
        action:   'Ver Clientes',
        navigate: 'customers',
        priority: 2,
      })
    }

    // Sort by priority
    return actions.sort((a, b) => a.priority - b.priority)
  }, [products, customers, sales])

  const typeStyles = {
    danger:  { card: 'bg-red-500/5 border-red-500/20',    icon: 'bg-red-500/10',    text: 'text-red-400',    badge: 'Urgente'    },
    warning: { card: 'bg-amber-500/5 border-amber-500/20', icon: 'bg-amber-500/10',  text: 'text-amber-400',  badge: 'Atencion'   },
    info:    { card: 'bg-[#00c4e8]/5 border-[#00c4e8]/20', icon: 'bg-[#00c4e8]/10',  text: 'text-[#00c4e8]',  badge: 'Sugerencia' },
    success: { card: 'bg-[#00e5a0]/5 border-[#00e5a0]/20', icon: 'bg-[#00e5a0]/10',  text: 'text-[#00e5a0]',  badge: 'Bien'       },
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-slate-400">Resumen de acciones recomendadas para hoy</div>
          <div className="text-xs text-slate-600 mt-0.5">{todayStr}</div>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
          insights.length === 0
            ? 'bg-[#00e5a0]/10 text-[#00e5a0]'
            : 'bg-amber-500/10 text-amber-400'
        }`}>
          {insights.length === 0 ? '✓ Todo en orden' : `${insights.length} acciones pendientes`}
        </div>
      </div>

      {insights.length === 0 ? (
        <div className="card p-12 text-center space-y-3">
          <div className="text-5xl">🎉</div>
          <div className="font-display font-bold text-slate-200 text-lg">Todo esta bajo control</div>
          <div className="text-sm text-slate-500">No hay acciones pendientes por ahora. El negocio va bien.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {insights.map((item, i) => {
            const style = typeStyles[item.type]
            return (
              <div key={i} className={`card border p-4 ${style.card}`}>
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${style.icon}`}>
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`font-semibold text-sm ${style.text}`}>{item.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${style.icon} ${style.text}`}>
                        {style.badge}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mb-1">{item.desc}</div>
                    {item.tip && (
                      <div className="text-xs text-slate-500 italic">💡 {item.tip}</div>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(item.navigate)}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-all flex-shrink-0 ${style.icon} ${style.text} border-current/20 hover:opacity-80`}
                  >
                    {item.action}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Productos activos', value: products.filter(p => p.active).length, icon: '📦' },
          { label: 'Stock bajo',        value: products.filter(p => p.active && p.stock <= (p.minStock || 5)).length, icon: '⚠️' },
          { label: 'Clientes activos',  value: customers.length, icon: '👥' },
          { label: 'Creditos pendientes', value: fmt(customers.reduce((a, c) => a + (c.creditBalance || 0), 0)), icon: '💳' },
        ].map((stat, i) => (
          <div key={i} className="card p-4">
            <div className="text-2xl mb-2">{stat.icon}</div>
            <div className="font-display font-bold text-xl text-slate-200">{stat.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
