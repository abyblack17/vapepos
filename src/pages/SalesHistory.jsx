import React, { useState, useMemo } from 'react'
import { useApp } from '../contexts/AppContext'
import Modal from '../components/ui/Modal'
import InvoiceModal from '../components/pos/InvoiceModal'
import { fmt, formatDate } from '../utils/helpers'

export default function SalesHistory() {
  const { state } = useApp()
  const { sales, customers, users } = state

  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('Todos')
  const [userFilter, setUserFilter] = useState('Todos')
  const [invoiceSale, setInvoiceSale] = useState(null)

  const paymentMethods = ['Todos', 'Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']
  const userNames = ['Todos', ...new Set(sales.map(s => s.user).filter(Boolean))]

  const filtered = useMemo(() => {
    return sales.filter(s => {
      const matchSearch = !search ||
        (s.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.saleNumber || '').toLowerCase().includes(search.toLowerCase()) ||
        s.user.toLowerCase().includes(search.toLowerCase())
      const matchDate = (!dateFrom || s.date >= dateFrom) && (!dateTo || s.date <= dateTo)
      const matchPayment = paymentFilter === 'Todos' || s.payment === paymentFilter
      const matchUser = userFilter === 'Todos' || s.user === userFilter
      return matchSearch && matchDate && matchPayment && matchUser
    })
  }, [sales, search, dateFrom, dateTo, paymentFilter, userFilter])

  const totalFiltered = filtered.reduce((a, s) => a + s.total, 0)
  const totalProfit  = filtered.reduce((a, s) => a + (s.profit || 0), 0)

  const PAYMENT_COLORS = {
    Efectivo: 'badge-green', Transferencia: 'badge-blue',
    Tarjeta: 'badge-purple', Mixto: 'badge-amber',
  }

  return (
    <>
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-100">Historial de Ventas</h2>
          <div className="text-xs text-slate-500 mt-0.5">
            {filtered.length} ventas · {fmt(totalFiltered)} · ganancia {fmt(totalProfit)}
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card p-4 space-y-3">
        {/* Search */}
        <div className="flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2">
          <span className="text-slate-500">🔍</span>
          <input
            className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
            placeholder="Buscar por cliente, # factura o cajero..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
          )}
        </div>

        {/* Date + dropdowns */}
        <div className="flex flex-wrap gap-2 items-center">
          <input type="date" className="input text-sm py-1.5 w-36"
            value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="text-slate-500 text-sm">→</span>
          <input type="date" className="input text-sm py-1.5 w-36"
            value={dateTo} onChange={e => setDateTo(e.target.value)} />

          <select className="select text-sm py-1.5 w-36"
            value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
            {paymentMethods.map(m => <option key={m}>{m}</option>)}
          </select>

          <select className="select text-sm py-1.5 w-36"
            value={userFilter} onChange={e => setUserFilter(e.target.value)}>
            {userNames.map(u => <option key={u}>{u}</option>)}
          </select>

          {(dateFrom || dateTo || paymentFilter !== 'Todos' || userFilter !== 'Todos') && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setPaymentFilter('Todos'); setUserFilter('Todos') }}
              className="btn-secondary text-xs py-1.5">
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      <div className="table-container overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {['Factura', 'Fecha / Hora', 'Cliente', 'Cajero', 'Detalle', 'Pago', 'Total', 'Ganancia', ''].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-cell text-center text-slate-500 py-12">
                  Sin ventas para los filtros seleccionados
                </td>
              </tr>
            ) : filtered.map(s => (
              <tr key={s.id} className="table-row">
                <td className="table-cell">
                  <span className="font-mono font-bold text-[#00e5a0] text-xs">{s.saleNumber}</span>
                </td>
                <td className="table-cell text-slate-400 text-xs">
                  <div>{s.date}</div>
                  <div className="text-slate-500">{s.time}</div>
                </td>
                <td className="table-cell">
                  {s.customerName
                    ? <span className="text-slate-200 font-medium">{s.customerName}</span>
                    : <span className="text-slate-500 italic">General</span>}
                </td>
                <td className="table-cell text-slate-400 text-xs">{s.user}</td>
                <td className="table-cell text-xs">
                  {s.items?.length > 0 && (
                    <div className="text-slate-400">
                      📦 {s.items.map(i => `${i.name} ×${i.qty}`).join(', ')}
                    </div>
                  )}
                  {s.refills?.length > 0 && (
                    <div className="text-[#00c4e8]">
                      💧 {s.refills.map(r => `${r.liquidName} ${r.type}`).join(', ')}
                    </div>
                  )}
                  {s.bottleSales?.length > 0 && (
                    <div className="text-[#a78bfa]">
                      🍶 {s.bottleSales.map(b => `${b.liquidName} ×${b.qty}`).join(', ')}
                    </div>
                  )}
                </td>
                <td className="table-cell">
                  <span className={`badge ${PAYMENT_COLORS[s.payment] || 'badge-gray'}`}>
                    {s.payment}
                  </span>
                </td>
                <td className="table-cell font-mono font-bold text-[#00e5a0]">
                  {fmt(s.total)}
                </td>
                <td className="table-cell font-mono text-[#a78bfa] text-xs">
                  {fmt(s.profit || 0)}
                </td>
                <td className="table-cell">
                  <button
                    onClick={() => setInvoiceSale(s)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-white/10
                               text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30
                               transition-all whitespace-nowrap"
                  >
                    Ver factura
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>

    {/* Invoice modal - rendered outside main div to avoid z-index issues */}
    {invoiceSale && (
      <InvoiceModal
        sale={invoiceSale}
        onClose={() => setInvoiceSale(null)}
      />
    )}
  </>
  )
}
