import React, { useState, useMemo } from 'react'
import { useApp } from '../contexts/AppContext'
import { useNavigation } from '../contexts/NavigationContext'
import { exportSalesReport, exportFiscalReport } from '../services/exportService'
import StatCard from '../components/ui/StatCard'
import ProGate from '../components/ui/ProGate'
import UpgradeModal from '../components/ui/UpgradeModal'
import Modal from '../components/ui/Modal'
import InvoiceModal from '../components/pos/InvoiceModal'
import { fmt, today } from '../utils/helpers'
import { aggregateByPayment, getTopProducts } from '../services/salesService'
import { getRendimientoReport } from '../services/liquidService'
import { usePlan } from '../hooks/usePlan'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import toast from 'react-hot-toast'
import { offlineCallable } from '../services/offlineSync'

const PIE_COLORS = ['#00e5a0', '#00c4e8', '#8b5cf6', '#f59e0b']

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#1a2848] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-slate-400 mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
      ))}
    </div>
  )
}

function getPeriodRange(period) {
  const now = new Date()
  const pad  = v => String(v).padStart(2, '0')
  const fmtD = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  if (period === 'daily')   { const t = fmtD(now); return { from: t, to: t, label: 'Hoy' } }
  if (period === 'weekly')  { const s = new Date(now); s.setDate(now.getDate()-6); return { from: fmtD(s), to: fmtD(now), label: 'Últimos 7 días' } }
  if (period === 'monthly') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return { from: fmtD(s), to: fmtD(now), label: 'Este mes' } }
  if (period === 'yearly')  { const s = new Date(now.getFullYear(), 0, 1); return { from: fmtD(s), to: fmtD(now), label: 'Este año' } }
  return { from: '', to: '', label: 'Todo el tiempo' }
}

const parseLocalDate = value => {
  const [year, month, day] = (value || '').split('-').map(Number)
  return year && month && day ? new Date(year, month - 1, day) : null
}

const shortDate = date => date.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }).replace('.', '')

function getChartData(filteredSales, period, resolvedRange) {
  const salesByDate = filteredSales.reduce((acc, sale) => {
    if (!sale.date) return acc
    const item = acc[sale.date] || { ventas: 0, ganancia: 0 }
    item.ventas += Number(sale.total) || 0
    item.ganancia += Number(sale.profit) || 0
    acc[sale.date] = item
    return acc
  }, {})

  if (period === 'daily') {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      name: `${String(hour).padStart(2, '0')}:00`, ventas: 0, ganancia: 0,
    }))
    filteredSales.forEach(sale => {
      const hour = Number.parseInt(sale.time?.match(/(\d{1,2})/)?.[1], 10)
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
        hours[hour].ventas += Number(sale.total) || 0
        hours[hour].ganancia += Number(sale.profit) || 0
      }
    })
    return { data: hours, title: 'Ventas de hoy por hora', interval: 2 }
  }

  const from = parseLocalDate(resolvedRange.from)
  const to = parseLocalDate(resolvedRange.to)
  if (!from || !to) {
    const datedSales = filteredSales.filter(s => s.date).sort((a, b) => a.date.localeCompare(b.date))
    if (!datedSales.length) return { data: [], title: 'Ventas de todo el período', interval: 0 }
    return getChartData(filteredSales, 'custom', { from: datedSales[0].date, to: datedSales.at(-1).date })
  }

  const dayCount = Math.max(1, Math.round((to - from) / 86400000) + 1)
  if (period === 'yearly' || dayCount > 90) {
    const data = []
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
    const limit = new Date(to.getFullYear(), to.getMonth(), 1)
    while (cursor <= limit) {
      const year = cursor.getFullYear()
      const month = cursor.getMonth()
      const totals = Object.entries(salesByDate).reduce((sum, [date, values]) => {
        const parsed = parseLocalDate(date)
        return parsed?.getFullYear() === year && parsed?.getMonth() === month
          ? { ventas: sum.ventas + values.ventas, ganancia: sum.ganancia + values.ganancia }
          : sum
      }, { ventas: 0, ganancia: 0 })
      data.push({ name: cursor.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' }).replace('.', ''), ...totals })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return { data, title: 'Ventas por mes', interval: 0 }
  }

  const data = []
  const cursor = new Date(from)
  while (cursor <= to) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
    data.push({ name: shortDate(cursor), ...(salesByDate[key] || { ventas: 0, ganancia: 0 }) })
    cursor.setDate(cursor.getDate() + 1)
  }
  return {
    data,
    title: period === 'weekly' ? 'Ventas de los últimos 7 días' : 'Ventas por día',
    interval: dayCount > 16 ? Math.ceil(dayCount / 12) - 1 : 0,
  }
}

const PAYMENT_BADGE = {
  Efectivo: 'badge-green', Transferencia: 'badge-blue',
  Tarjeta: 'badge-purple', Mixto: 'badge-amber',
}

export default function Reports() {
  const { state, dispatch } = useApp()
  const { navigate }        = useNavigation()
  const { hasFeature, getLimit } = usePlan()
  const { sales, liquids, currentUser } = state
  const isAdmin       = currentUser?.role === 'Administrador'
  const canViewProfit = isAdmin || (currentUser?.permissions?.viewProfit ?? false)
  const canExport     = hasFeature('exportReports')
  const historyDays   = getLimit('historyDays') // 15 para básico, Infinity para pro

  const [period,        setPeriod]        = useState('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [payFilter,     setPayFilter]     = useState('Todos')
  const [fiscalFilter,  setFiscalFilter]  = useState('Todos')
  const [userFilter,    setUserFilter]    = useState('Todos')
  const [invoiceSale,   setInvoiceSale]   = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showUpgrade,   setShowUpgrade]   = useState(false)

  // Calcular fecha mínima permitida según plan
  const minDateAllowed = useMemo(() => {
    if (historyDays === Infinity) return null
    const d = new Date()
    d.setDate(d.getDate() - historyDays)
    return d.toISOString().split('T')[0]
  }, [historyDays])

  const resolvedRange = useMemo(() => {
    if (period !== 'custom') {
      const range = getPeriodRange(period)
      // Si el plan básico y el rango va más allá de los días permitidos, limitar
      if (minDateAllowed && range.from && range.from < minDateAllowed) {
        return { ...range, from: minDateAllowed }
      }
      return range
    }
    return { from: dateFrom, to: dateTo, label: 'Período personalizado' }
  }, [period, dateFrom, dateTo, minDateAllowed])

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const matchDate = (!resolvedRange.from || s.date >= resolvedRange.from)
                     && (!resolvedRange.to   || s.date <= resolvedRange.to)
      // Para plan básico, nunca mostrar ventas más antiguas que historyDays
      if (minDateAllowed && s.date < minDateAllowed) return false
      const matchPay  = payFilter  === 'Todos' || s.payment === payFilter
      const matchUser = userFilter === 'Todos' || s.user === userFilter
      const matchFiscal = fiscalFilter === 'Todos' || s.fiscal?.typeCode === fiscalFilter || (fiscalFilter === 'Sin NCF' && !s.fiscal?.ncf)
      return matchDate && matchPay && matchUser && matchFiscal
    })
  }, [sales, resolvedRange, payFilter, userFilter, fiscalFilter, minDateAllowed])

  const totalSales   = filteredSales.reduce((a, s) => a + s.total, 0)
  const totalProfit  = filteredSales.reduce((a, s) => a + (s.profit || 0), 0)
  const totalRefills = filteredSales.reduce((a, s) => a + s.refills.length, 0)
  const totalBottles = filteredSales.reduce((a, s) => a + (s.bottleSales || []).reduce((b, b2) => b + b2.qty, 0), 0)
  const marginPct    = totalSales ? Math.round(totalProfit / totalSales * 100) : 0

  const byPayment      = aggregateByPayment(filteredSales)
  const paymentPieData = Object.entries(byPayment).map(([name, value]) => ({ name, value }))
  const topProducts    = getTopProducts(filteredSales)
  const chart          = useMemo(() => getChartData(filteredSales, period, resolvedRange), [filteredSales, period, resolvedRange])
  const userNames      = ['Todos', ...new Set(sales.map(s => s.user).filter(Boolean))]
  const fiscalInvoices = state.fiscalInvoices.filter(i => filteredSales.some(s => s.id === i.saleId || s.id === i.id))

  const handleDeleteSale = async (sale) => {
    if (!isAdmin) { toast.error('Solo el administrador puede eliminar ventas'); return }
    try {
      await offlineCallable('reverseSale', { saleId: sale.id })
      dispatch({ type: 'DELETE_SALE', payload: sale.id, _sale: sale, _skipSync: true })
      toast.success(`Reversión de venta ${sale.saleNumber || sale.id} guardada para sincronizar`)
      setDeleteConfirm(null)
    } catch (error) { toast.error(error.message || 'No se pudo revertir la venta') }
  }

  const handleExport = async (format) => {
    if (!canExport) { setShowUpgrade(true); return }
    try {
      await exportSalesReport(filteredSales, format, state.settings?.businessName, canViewProfit)
    } catch (error) {
      console.error('Error exportando ventas:', error)
      toast.error('No se pudo descargar el reporte. Intenta nuevamente.')
    }
  }

  const handleFiscalExport = async (format) => {
    if (!isAdmin) { toast.error('Solo el administrador puede exportar reportes fiscales'); return }
    try {
      await exportFiscalReport(fiscalInvoices, format, state.settings?.businessName)
    } catch (error) {
      console.error('Error exportando facturas:', error)
      toast.error('No se pudo descargar el reporte fiscal. Intenta nuevamente.')
    }
  }

  return (
    <>
    <div className="space-y-5 animate-fade-in">

      {/* Banner plan básico — límite de historial */}
      {minDateAllowed && (
        <div className="alert-warning text-xs">
          🔒 Plan Básico: solo puedes ver los últimos {historyDays} días de ventas.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro para historial completo</button>
        </div>
      )}

      {/* Period selector + filters */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-[#101c35] rounded-lg p-1">
            {[
              { id: 'daily',   label: 'Hoy'    },
              { id: 'weekly',  label: 'Semana' },
              { id: 'monthly', label: 'Mes'    },
              { id: 'yearly',  label: 'Año'    },
              { id: 'all',     label: 'Todo'   },
              { id: 'custom',  label: 'Fechas' },
            ].map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                  period === p.id ? 'bg-neon-green text-[#080d18]' : 'text-slate-400 hover:text-slate-200'
                }`}>
                {p.label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" className="input text-xs py-1.5 w-36"
                min={minDateAllowed || undefined}
                value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
              <span className="text-slate-500 text-xs">→</span>
              <input type="date" className="input text-xs py-1.5 w-36"
                value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
          )}

          <select className="select text-xs py-1.5 w-36" value={payFilter}  onChange={e => setPayFilter(e.target.value)}>
            {['Todos','Efectivo','Transferencia','Tarjeta','Mixto'].map(m => <option key={m}>{m}</option>)}
          </select>
          <select className="select text-xs py-1.5 w-36" value={userFilter} onChange={e => setUserFilter(e.target.value)}>
            {userNames.map(u => <option key={u}>{u}</option>)}
          </select>
          <select className="select text-xs py-1.5 w-40" value={fiscalFilter} onChange={e => setFiscalFilter(e.target.value)}>
            {['Todos','Sin NCF','B01','B02','B03','B04','B14','B15'].map(u => <option key={u}>{u}</option>)}
          </select>

          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-500">{filteredSales.length} ventas · {resolvedRange.label}</span>
            {canExport ? (
              <>
                <button onClick={() => handleExport('excel')}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">
                  📊 Excel
                </button>
                <button onClick={() => handleExport('pdf')}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-[#a78bfa] hover:border-[#a78bfa]/30 transition-all">
                  📄 PDF
                </button>
              </>
            ) : (
              <>
                <ProGate feature="exportReports" mode="button" label="Excel" />
                <ProGate feature="exportReports" mode="button" label="PDF" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Ventas Totales"   value={fmt(totalSales)}   sub={`${filteredSales.length} transacciones`} accent="green"  icon="💵" onClick={() => navigate('history')} />
        {canViewProfit && <StatCard label="Ganancia Total" value={fmt(totalProfit)} sub={`${marginPct}% margen bruto`} accent="purple" icon="📈" onClick={() => navigate('history')} />}
        <StatCard label="Recargas"         value={totalRefills}      sub="operaciones de recarga"                  accent="blue"   icon="💧" onClick={() => navigate('refills')} />
        <StatCard label="Frascos Vendidos" value={totalBottles}      sub="frascos completos al cliente"            accent="amber"  icon="🍶" onClick={() => navigate('refills')} />
      </div>

      {isAdmin && fiscalInvoices.length > 0 && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="section-title">Reporte fiscal NCF</div>
              <div className="text-xs text-slate-500">{fiscalInvoices.length} facturas fiscales en el período · ITBIS {fmt(fiscalInvoices.reduce((a,i)=>a+(i.tax||0),0))}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleFiscalExport('excel')} className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">📊 Fiscal Excel</button>
              <button onClick={() => handleFiscalExport('pdf')} className="text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-[#a78bfa] hover:border-[#a78bfa]/30 transition-all">📄 Fiscal PDF</button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 border-b border-white/10"><tr><th className="text-left py-2">Fecha</th><th className="text-left">Tipo</th><th className="text-left">NCF</th><th className="text-left">Cliente</th><th className="text-right">ITBIS</th><th className="text-right">Total</th></tr></thead>
              <tbody>{fiscalInvoices.slice(0, 20).map(i => <tr key={i.id} className="border-b border-white/5 text-slate-300"><td className="py-2">{i.date}</td><td>{i.typeCode}</td><td className="font-mono">{i.ncf}</td><td>{i.customerName || 'Consumidor Final'}</td><td className="text-right font-mono">{fmt(i.tax)}</td><td className="text-right font-mono text-[#00e5a0]">{fmt(i.total)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <div className="col-span-2 card p-5">
          <div className="section-title mb-4">{chart.title}</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chart.data}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" interval={chart.interval} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="ventas"   name="Ventas"   fill="#00e5a0" radius={[4,4,0,0]} />
              {canViewProfit && <Bar dataKey="ganancia" name="Ganancia" fill="#8b5cf6" radius={[4,4,0,0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-5">
          <div className="section-title mb-4">Métodos de Pago</div>
          {paymentPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={paymentPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                  {paymentPieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % 4]} />)}
                </Pie>
                <Legend formatter={v => <span style={{ color: '#94a3b8', fontSize: 11 }}>{v}</span>} />
                <Tooltip formatter={v => fmt(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-slate-500 text-sm">Sin datos</div>
          )}
        </div>
      </div>

      {/* Operatives row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <div className="card p-5">
          <div className="section-title">Top Productos</div>
          {topProducts.length === 0
            ? <p className="text-sm text-slate-500">Sin datos</p>
            : <div className="space-y-3">
                {topProducts.map((p, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 truncate max-w-[60%]">#{i+1} {p.name}</span>
                      <span className="font-mono font-bold text-[#00e5a0]">{p.qty} uds</span>
                    </div>
                    <div className="bottle-progress">
                      <div className="h-full bottle-fill-green rounded" style={{ width: `${Math.round(p.qty/(topProducts[0]?.qty||1)*100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="card p-5">
          <div className="section-title">Desglose por Pago</div>
          <div className="space-y-3">
            {Object.entries(byPayment).map(([method, total]) => (
              <div key={method}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300">{method}</span>
                  <span className="font-mono font-bold text-[#00e5a0]">{fmt(total)}</span>
                </div>
                <div className="bottle-progress">
                  <div className="h-full bottle-fill-green rounded" style={{ width: `${totalSales ? Math.round(total/totalSales*100) : 0}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(byPayment).length === 0 && <p className="text-xs text-slate-500">Sin datos</p>}
          </div>
        </div>

        <div className="card p-5">
          <div className="section-title">Rendimiento Líquidos</div>
          <div className="space-y-3">
            {liquids.filter(l => l.totalRechargesAllTime > 0).map(l => (
              <div key={l.id}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 truncate max-w-[55%]">{l.name}</span>
                  <span className="font-mono font-bold text-[#00c4e8]">{l.totalRechargesAllTime} rec</span>
                </div>
                <div className="bottle-progress">
                  <div className="h-full rounded" style={{ width: `${Math.min(100, Math.round(l.totalRechargesAllTime/25*100))}%`, background: 'linear-gradient(90deg,#00c4e8,#0090b0)' }} />
                </div>
              </div>
            ))}
            {liquids.filter(l => l.totalRechargesAllTime > 0).length === 0 && <p className="text-xs text-slate-500">Sin datos</p>}
          </div>
        </div>
      </div>

      {/* Detail sales table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="font-display font-semibold text-slate-200">Detalle de Ventas del Período</div>
          <div className="text-xs text-slate-500">{filteredSales.length} ventas · {fmt(totalSales)}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {['Factura','Fecha','Hora','Cliente','Cajero','Detalle','Pago','Total',...(canViewProfit?['Ganancia']:[]),''].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSales.length === 0 ? (
                <tr><td colSpan={10} className="table-cell text-center text-slate-500 py-10">Sin ventas en este período</td></tr>
              ) : filteredSales.map(s => (
                <tr key={s.id} className="table-row">
                  <td className="table-cell font-mono font-bold text-[#00e5a0] text-xs">{s.saleNumber}</td>
                  <td className="table-cell text-slate-400 text-xs">{s.date}</td>
                  <td className="table-cell text-slate-400 text-xs">{s.time}</td>
                  <td className="table-cell text-xs">{s.customerName || <span className="text-slate-500 italic">General</span>}</td>
                  <td className="table-cell text-slate-400 text-xs">{s.user}</td>
                  <td className="table-cell text-xs max-w-[160px]">
                    {s.items?.length > 0    && <div className="text-slate-400 truncate">📦 {s.items.map(i=>`${i.name}×${i.qty}`).join(', ')}</div>}
                    {s.refills?.length > 0  && <div className="text-[#00c4e8] truncate">💧 {s.refills.map(r=>`${r.liquidName} ${r.type}`).join(', ')}</div>}
                    {s.bottleSales?.length > 0 && <div className="text-[#a78bfa] truncate">🍶 {s.bottleSales.map(b=>`${b.liquidName}×${b.qty}`).join(', ')}</div>}
                  </td>
                  <td className="table-cell"><span className={`badge ${PAYMENT_BADGE[s.payment]||'badge-gray'}`}>{s.payment}</span></td>
                  <td className="table-cell font-mono font-bold text-[#00e5a0] text-xs">{fmt(s.total)}</td>
                  {canViewProfit && <td className="table-cell font-mono text-[#a78bfa] text-xs">{fmt(s.profit||0)}</td>}
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button onClick={() => setInvoiceSale(s)}
                        className="text-xs px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">🧾</button>
                      {isAdmin && (
                        <button onClick={() => setDeleteConfirm(s)}
                          className="text-xs px-2 py-1 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {deleteConfirm && (
        <Modal title="Eliminar Venta" onClose={() => setDeleteConfirm(null)} size="sm">
          <div className="alert-danger text-sm mb-4">
            ¿Eliminar la venta <strong>{deleteConfirm.saleNumber}</strong> por {fmt(deleteConfirm.total)}? Esta acción no se puede deshacer.
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancelar</button>
            <button className="btn-danger" onClick={() => handleDeleteSale(deleteConfirm)}>Eliminar</button>
          </div>
        </Modal>
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>

    {invoiceSale && <InvoiceModal sale={invoiceSale} onClose={() => setInvoiceSale(null)} />}
  </>
  )
}
