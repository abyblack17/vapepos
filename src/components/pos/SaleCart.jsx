import React, { useState } from 'react'
import { useApp } from '../../contexts/AppContext'
import { fmt } from '../../utils/helpers'
import InvoiceModal from './InvoiceModal'
import toast from 'react-hot-toast'

const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']

function TypePill({ type }) {
  if (type === 'refill')   return <span className="text-[8px] font-bold uppercase tracking-wider text-[#00c4e8] bg-[#00c4e8]/10 px-1.5 py-0.5 rounded-full">Recarga</span>
  if (type === 'bottle')   return <span className="text-[8px] font-bold uppercase tracking-wider text-[#a78bfa] bg-[#8b5cf6]/10 px-1.5 py-0.5 rounded-full">Frasco</span>
  if (type === 'service')  return <span className="text-[8px] font-bold uppercase tracking-wider text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded-full">Servicio</span>
  if (type === 'discount') return <span className="text-[8px] font-bold uppercase tracking-wider text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">Descuento</span>
  return null
}

export default function SaleCart({ onSaleComplete }) {
  const { state, dispatch } = useApp()
  const { cart, selectedPayment, customers, settings } = state
  const isAdmin   = state.currentUser?.role === 'Administrador'
  const isManager = ['Administrador','Encargado'].includes(state.currentUser?.role)

  const [customerSearch, setCustomerSearch]   = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [completedSale, setCompletedSale]     = useState(null)
  const [showPanel, setShowPanel]             = useState(null) // 'discount' | 'service'
  const [showCobrar, setShowCobrar]           = useState(false)
  const [amountReceived, setAmountReceived]   = useState('')
  const [creditAmount, setCreditAmount]       = useState('')

  // Discount/Service management state
  const [newDiscount, setNewDiscount]   = useState({ name: '', type: 'porcentaje', value: '' })
  const [newService, setNewService]     = useState({ name: '', price: '' })
  const [editDiscount, setEditDiscount] = useState(null)
  const [editService, setEditService]   = useState(null)

  const discounts = settings?.discounts || []
  const services  = settings?.services  || []

  const taxRate  = settings?.taxRate ?? 0
  const subtotal = cart.filter(i => i.type !== 'discount').reduce((a, i) => a + i.price * i.qty, 0)
  const discountTotal = cart.filter(i => i.type === 'discount').reduce((a, i) => a + Math.abs(i.price) * i.qty, 0)
  const tax      = Math.round((subtotal - discountTotal) * (taxRate / 100))
  const total    = subtotal - discountTotal + tax
  const change   = amountReceived ? Math.max(0, parseFloat(amountReceived) - total) : 0

  const filteredCustomers = customerSearch.length > 1
    ? customers.filter(c =>
        c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.phone?.includes(customerSearch) ||
        c.code?.toLowerCase().includes(customerSearch.toLowerCase())
      )
    : []

  // Credit balance of selected customer
  const customerCredit = selectedCustomer?.creditBalance || 0

  // ── Apply discount ──────────────────────────────────────
  const applyDiscount = (disc) => {
    const amount = disc.type === 'porcentaje'
      ? Math.round(subtotal * disc.value / 100)
      : disc.value
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: `disc_${disc.id}`, type: 'discount', name: `Descuento: ${disc.name}`, price: -Math.abs(amount), cost: 0, qty: 1 }
    })
    setShowPanel(null)
    toast.success(`Descuento "${disc.name}" aplicado`)
  }

  // ── Add service ─────────────────────────────────────────
  const addService = (svc) => {
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: `svc_${svc.id}_${Date.now()}`, type: 'service', name: svc.name, price: svc.price, cost: 0, qty: 1 }
    })
    setShowPanel(null)
    toast.success(`"${svc.name}" agregado`)
  }

  // ── Save discounts to settings ───────────────────────────
  const saveDiscounts = (newList) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { discounts: newList } })
  }
  const saveServices = (newList) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { services: newList } })
  }

  // ── Complete sale ────────────────────────────────────────
  const handleCobrar = () => {
    if (cart.length === 0) { toast.error('El carrito esta vacio'); return }
    const paid = amountReceived ? parseFloat(amountReceived) : total
    const credit = parseFloat(creditAmount) || 0
    const totalCredit = customerCredit + credit
    if (paid + totalCredit < total) {
      toast.error('El monto recibido mas el credito no cubre el total'); return
    }
    const now = new Date()
    const productItems  = cart.filter(i => i.type === 'product')
    const refillItems   = cart.filter(i => i.type === 'refill')
    const bottleItems   = cart.filter(i => i.type === 'bottle')
    const serviceItems  = cart.filter(i => i.type === 'service')
    const discountItems = cart.filter(i => i.type === 'discount')
    const profit = cart.filter(i => i.type !== 'discount').reduce((a, i) => a + (i.price - i.cost) * i.qty, 0)

    const sale = {
      date:         now.toISOString().split('T')[0],
      time:         now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      user:         state.currentUser?.name || 'Admin',
      userId:       state.currentUser?.id   || 'u1',
      customerId:   selectedCustomer?.id    || null,
      customerName: selectedCustomer?.name  || null,
      items: productItems.map(i => ({ productId: i.id, name: i.name, qty: i.qty, price: i.price, cost: i.cost })),
      refills: refillItems.flatMap(i =>
        Array.from({ length: i.qty }, () => ({
          liquidId: i.liquidId, liquidName: i.liquidName,
          type: `RD$${i.price}`, price: i.price, pointsConsumed: i.points,
        }))
      ),
      bottleSales: bottleItems.map(i => ({ liquidId: i.liquidId, liquidName: i.liquidName, qty: i.qty, price: i.price, cost: i.cost })),
      services: serviceItems.map(i => ({ name: i.name, price: i.price, qty: i.qty })),
      discounts: discountItems.map(i => ({ name: i.name, amount: Math.abs(i.price) })),
      subtotal, tax, discountTotal, total,
      payment:               selectedPayment,
      amountReceived:        amountReceived ? parseFloat(amountReceived) : (total - (parseFloat(creditAmount) || 0)),
      change:                Math.max(0, (amountReceived ? parseFloat(amountReceived) : total) - total),
      creditAdded:           parseFloat(creditAmount) || 0,
      creditPreviousBalance: customerCredit,
      profit,
      notes: '',
    }

    productItems.forEach(item => dispatch({ type: 'DEDUCT_STOCK', payload: { productId: item.id, qty: item.qty } }))
    refillItems.forEach(item => dispatch({ type: 'CONSUME_REFILL', payload: { liquidId: item.liquidId, points: item.points * item.qty, price: item.price * item.qty, qty: item.qty } }))
    bottleItems.forEach(item => dispatch({ type: 'SELL_CLOSED_BOTTLE', payload: { liquidId: item.liquidId, qty: item.qty } }))

    dispatch({ type: 'ADD_SALE', payload: sale })
    // Update customer stats and credit balance
    if (selectedCustomer) {
      const newCredit = customerCredit + (parseFloat(creditAmount) || 0)
      dispatch({ type: 'UPDATE_CUSTOMER', payload: {
        ...selectedCustomer,
        creditBalance:     newCredit,
        totalSpent:        (selectedCustomer.totalSpent || 0) + total,
        totalTransactions: (selectedCustomer.totalTransactions || 0) + 1,
        lastPurchase:      sale.date,
      }})
    }
    dispatch({ type: 'CLEAR_CART' })
    setSelectedCustomer(null)
    setCustomerSearch('')
    setAmountReceived('')
    setCreditAmount('')
    setShowCobrar(false)
    toast.success(`Venta completada — ${fmt(total)}`)
    setCompletedSale(sale)
    onSaleComplete?.(sale)
  }

  return (
    <>
      <div className="flex flex-col h-full bg-[#111e38] border border-white/5 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="text-sm font-display font-bold text-slate-200 mb-2">Carrito</div>
          <div className="relative">
            <input className="input text-xs py-2" placeholder="Buscar cliente (opcional)..."
              value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setSelectedCustomer(null) }} />
            {selectedCustomer && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2 px-2 py-1 bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded-lg">
                  <span className="text-xs text-[#00e5a0] font-semibold">{selectedCustomer.name}</span>
                  {selectedCustomer.code && <span className="text-xs font-mono text-slate-400">{selectedCustomer.code}</span>}
                  <button onClick={() => { setSelectedCustomer(null); setCustomerSearch('') }} className="text-slate-400 hover:text-red-400 ml-auto text-xs">x</button>
                </div>
                {customerCredit > 0 && (
                  <div className="flex items-center gap-2 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <span className="text-xs text-red-400">Deuda pendiente:</span>
                    <span className="text-xs font-mono font-bold text-red-400">{fmt(customerCredit)}</span>
                  </div>
                )}
              </div>
            )}
            {filteredCustomers.length > 0 && !selectedCustomer && (
              <div className="absolute top-full left-0 right-0 z-10 bg-[#1a2848] border border-white/10 rounded-lg mt-1 shadow-xl overflow-hidden">
                {filteredCustomers.slice(0, 4).map(c => (
                  <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(c.name) }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 border-b border-white/5 last:border-0">
                    {c.name} <span className="text-slate-500">— {c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
              <span className="text-3xl">🛒</span><span>Carrito vacio</span>
            </div>
          ) : cart.map((item, i) => (
            <div key={i} className={`flex items-center gap-2 border rounded-lg p-2.5 ${item.type === 'discount' ? 'bg-red-500/5 border-red-500/20' : 'bg-[#1a2848] border-white/5'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <TypePill type={item.type} />
                  <div className="text-xs font-semibold text-slate-200 truncate">{item.name}</div>
                </div>
                <div className={`text-xs font-mono font-bold ${item.type === 'discount' ? 'text-red-400' : 'text-[#00e5a0]'}`}>
                  {item.type === 'discount' ? `-${fmt(Math.abs(item.price))}` : fmt(item.price)}
                </div>
              </div>
              {item.type !== 'discount' && (
                <div className="flex items-center gap-1">
                  <button onClick={() => dispatch({ type: 'UPDATE_CART_QTY', payload: { index: i, delta: -1 } })}
                    className="w-6 h-6 rounded flex items-center justify-center border border-white/10 text-slate-400 hover:text-[#00e5a0] text-sm transition-all">-</button>
                  <span className="text-xs font-bold text-slate-200 min-w-[16px] text-center">{item.qty}</span>
                  <button onClick={() => dispatch({ type: 'UPDATE_CART_QTY', payload: { index: i, delta: 1 } })}
                    className="w-6 h-6 rounded flex items-center justify-center border border-white/10 text-slate-400 hover:text-[#00e5a0] text-sm transition-all">+</button>
                </div>
              )}
              <div className={`text-xs font-bold font-mono min-w-[60px] text-right ${item.type === 'discount' ? 'text-red-400' : 'text-slate-300'}`}>
                {item.type === 'discount' ? `-${fmt(Math.abs(item.price))}` : fmt(item.price * item.qty)}
              </div>
              <button onClick={() => dispatch({ type: 'REMOVE_FROM_CART', payload: i })}
                className="text-slate-500 hover:text-red-400 text-xs transition-colors">x</button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5 space-y-2">
          {/* Totals */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-400"><span>Subtotal</span><span className="font-mono">{fmt(subtotal)}</span></div>
            {discountTotal > 0 && <div className="flex justify-between text-xs text-red-400"><span>Descuento</span><span className="font-mono">-{fmt(discountTotal)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between text-xs text-slate-400"><span>ITBIS ({taxRate}%)</span><span className="font-mono">{fmt(tax)}</span></div>}
            <div className="flex justify-between text-sm font-bold text-slate-100 pt-1 border-t border-white/10">
              <span>Total</span>
              <span className="font-mono text-[#00e5a0] text-lg">{fmt(total)}</span>
            </div>
          </div>

          {/* Discount + Service buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => setShowPanel(showPanel === 'discount' ? null : 'discount')}
              className={`py-2 rounded-lg text-xs font-semibold border transition-all ${showPanel === 'discount' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-[#1a2848] border-white/10 text-slate-400 hover:border-white/25'}`}>
              % Descuento
            </button>
            <button onClick={() => setShowPanel(showPanel === 'service' ? null : 'service')}
              className={`py-2 rounded-lg text-xs font-semibold border transition-all ${showPanel === 'service' ? 'bg-[#f59e0b]/10 border-[#f59e0b]/30 text-[#f59e0b]' : 'bg-[#1a2848] border-white/10 text-slate-400 hover:border-white/25'}`}>
              + Servicios
            </button>
          </div>

          {/* Discount panel */}
          {showPanel === 'discount' && (
            <DiscountPanel
              discounts={discounts} isAdmin={isAdmin}
              onApply={applyDiscount}
              onSave={saveDiscounts}
              newDiscount={newDiscount} setNewDiscount={setNewDiscount}
              editDiscount={editDiscount} setEditDiscount={setEditDiscount}
            />
          )}

          {/* Service panel */}
          {showPanel === 'service' && (
            <ServicePanel
              services={services} isAdmin={isAdmin}
              onAdd={addService}
              onSave={saveServices}
              newService={newService} setNewService={setNewService}
              editService={editService} setEditService={setEditService}
            />
          )}

          {/* Payment methods */}
          <div className="grid grid-cols-2 gap-1.5">
            {PAYMENT_METHODS.map(m => (
              <button key={m} onClick={() => dispatch({ type: 'SET_PAYMENT', payload: m })}
                className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                  selectedPayment === m ? 'bg-[#00e5a0]/10 border-[#00e5a0]/30 text-[#00e5a0]' : 'bg-[#1a2848] border-white/10 text-slate-400 hover:border-white/25'
                }`}>{m}</button>
            ))}
          </div>

          {/* Amount received (efectivo) */}
          {selectedPayment === 'Efectivo' && cart.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm py-2 font-mono"
                  type="number" placeholder="Monto recibido..."
                  value={amountReceived} onChange={e => setAmountReceived(e.target.value)}
                />
              </div>
              {amountReceived && parseFloat(amountReceived) >= total && (
                <div className="flex justify-between text-sm font-bold px-1">
                  <span className="text-slate-400">Cambio:</span>
                  <span className="text-[#00e5a0] font-mono text-base">{fmt(change)}</span>
                </div>
              )}
              {amountReceived && parseFloat(amountReceived) < total && (
                <div className="text-xs text-red-400 text-center">Monto insuficiente — faltan {fmt(total - parseFloat(amountReceived))}</div>
              )}
            </div>
          )}

          {/* Credit field - shown when customer is selected */}
          {selectedCustomer && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-2">
              <div className="text-xs font-bold text-red-400 uppercase tracking-wider">Credito / Deuda</div>
              {customerCredit > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Deuda actual:</span>
                  <span className="text-red-400 font-mono font-bold">{fmt(customerCredit)}</span>
                </div>
              )}
              <input
                className="input w-full text-sm py-2 font-mono"
                type="number"
                placeholder="Monto a dejar a credito (RD$)..."
                value={creditAmount}
                onChange={e => setCreditAmount(e.target.value)}
              />
              {creditAmount && parseFloat(creditAmount) > 0 && (
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-400">Nueva deuda total:</span>
                  <span className="text-red-400 font-mono">{fmt(customerCredit + parseFloat(creditAmount))}</span>
                </div>
              )}
              {/* Pay existing debt */}
              {customerCredit > 0 && cart.length === 0 && (
                <div className="pt-1 border-t border-white/10">
                  <div className="text-xs text-slate-400 mb-1">Abonar a deuda existente:</div>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-sm py-1.5 font-mono"
                      type="number"
                      placeholder={`Max: ${customerCredit}`}
                      id="debt-payment"
                    />
                    <button
                      onClick={() => {
                        const payment = parseFloat(document.getElementById('debt-payment').value)
                        if (isNaN(payment) || payment <= 0) return toast.error('Monto invalido')
                        if (payment > customerCredit) return toast.error(`Maximo: ${fmt(customerCredit)}`)
                        const newBalance = customerCredit - payment
                        // Update customer credit balance
                        dispatch({ type: 'UPDATE_CUSTOMER', payload: { ...selectedCustomer, creditBalance: newBalance } })
                        // Register payment in cash session
                        dispatch({ type: 'UPDATE_CASH_SALES', payload: {
                          amount:     payment,
                          customerId: selectedCustomer.id,
                          customerName: selectedCustomer.name,
                          concept:    `Abono credito — ${selectedCustomer.name}`,
                          date:       new Date().toISOString().split('T')[0],
                          time:       new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
                        }})
                        toast.success(`Abono de ${fmt(payment)} registrado en caja. Deuda restante: ${fmt(newBalance)}`)
                        document.getElementById('debt-payment').value = ''
                      }}
                      className="btn-primary text-xs px-3 whitespace-nowrap"
                    >
                      Abonar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cobrar button */}
          <button onClick={handleCobrar} disabled={cart.length === 0}
            className={`w-full py-3 rounded-xl font-display font-bold text-sm transition-all duration-150 ${
              cart.length > 0 ? 'bg-neon-green text-[#080d18] hover:bg-emerald-400 active:scale-95' : 'bg-[#1a2848] text-slate-500 cursor-not-allowed'
            }`}>
            Cobrar {cart.length > 0 ? `— ${fmt(total)}` : ''}
          </button>
        </div>
      </div>

      {completedSale && (
        <InvoiceModal sale={completedSale} onClose={() => setCompletedSale(null)} onNewSale={() => setCompletedSale(null)} />
      )}
    </>
  )
}

// ── Discount Panel ────────────────────────────────────────────
function DiscountPanel({ discounts, isAdmin, onApply, onSave, newDiscount, setNewDiscount, editDiscount, setEditDiscount }) {
  const genId = () => `d_${Date.now()}`

  const handleAdd = () => {
    if (!newDiscount.name || !newDiscount.value) return toast.error('Completa nombre y valor')
    const list = [...discounts, { id: genId(), ...newDiscount, value: parseFloat(newDiscount.value) }]
    onSave(list)
    setNewDiscount({ name: '', type: 'porcentaje', value: '' })
    toast.success('Descuento creado')
  }

  const handleEdit = () => {
    const list = discounts.map(d => d.id === editDiscount.id ? { ...editDiscount, value: parseFloat(editDiscount.value) } : d)
    onSave(list)
    setEditDiscount(null)
    toast.success('Descuento actualizado')
  }

  const handleDelete = (id) => {
    onSave(discounts.filter(d => d.id !== id))
    toast.success('Descuento eliminado')
  }

  return (
    <div className="bg-[#0c1424] border border-red-500/20 rounded-xl p-3 space-y-2">
      <div className="text-xs font-bold text-red-400 uppercase tracking-wider">Descuentos disponibles</div>

      {discounts.length === 0 && <div className="text-xs text-slate-500 text-center py-2">Sin descuentos creados</div>}

      {discounts.map(d => (
        <div key={d.id} className="flex items-center gap-2">
          {editDiscount?.id === d.id ? (
            <>
              <input className="input flex-1 text-xs py-1" value={editDiscount.name} onChange={e => setEditDiscount(ed => ({ ...ed, name: e.target.value }))} />
              <input className="input w-16 text-xs py-1 font-mono" type="number" value={editDiscount.value} onChange={e => setEditDiscount(ed => ({ ...ed, value: e.target.value }))} />
              <select className="select text-xs py-1" value={editDiscount.type} onChange={e => setEditDiscount(ed => ({ ...ed, type: e.target.value }))}>
                <option value="porcentaje">%</option>
                <option value="fijo">RD$</option>
              </select>
              <button onClick={handleEdit} className="text-xs text-[#00e5a0] hover:underline">OK</button>
              <button onClick={() => setEditDiscount(null)} className="text-xs text-slate-500">x</button>
            </>
          ) : (
            <>
              <button onClick={() => onApply(d)} className="flex-1 text-left text-xs py-1.5 px-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-all">
                {d.name} — {d.type === 'porcentaje' ? `${d.value}%` : fmt(d.value)}
              </button>
              {isAdmin && (
                <>
                  <button onClick={() => setEditDiscount(d)} className="text-xs text-slate-400 hover:text-[#00e5a0]">✎</button>
                  <button onClick={() => handleDelete(d.id)} className="text-xs text-slate-400 hover:text-red-400">✕</button>
                </>
              )}
            </>
          )}
        </div>
      ))}

      {isAdmin && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-xs text-slate-500 font-semibold">Crear descuento</div>
          <input className="input w-full text-xs py-1.5" placeholder="Nombre del descuento" value={newDiscount.name} onChange={e => setNewDiscount(d => ({ ...d, name: e.target.value }))} />
          <div className="flex gap-1">
            <input className="input flex-1 text-xs py-1 font-mono" type="number" placeholder="Valor" value={newDiscount.value} onChange={e => setNewDiscount(d => ({ ...d, value: e.target.value }))} />
            <select className="select text-xs py-1 w-16" value={newDiscount.type} onChange={e => setNewDiscount(d => ({ ...d, type: e.target.value }))}>
              <option value="porcentaje">%</option>
              <option value="fijo">RD$</option>
            </select>
          </div>
          <button onClick={handleAdd} className="btn-primary w-full text-xs py-1.5">+ Crear Descuento</button>
        </div>
      )}
    </div>
  )
}

// ── Service Panel ─────────────────────────────────────────────
function ServicePanel({ services, isAdmin, onAdd, onSave, newService, setNewService, editService, setEditService }) {
  const genId = () => `s_${Date.now()}`

  const handleAdd = () => {
    if (!newService.name || !newService.price) return toast.error('Completa nombre y precio')
    const list = [...services, { id: genId(), name: newService.name, price: parseFloat(newService.price) }]
    onSave(list)
    setNewService({ name: '', price: '' })
    toast.success('Servicio creado')
  }

  const handleEdit = () => {
    const list = services.map(s => s.id === editService.id ? { ...editService, price: parseFloat(editService.price) } : s)
    onSave(list)
    setEditService(null)
    toast.success('Servicio actualizado')
  }

  const handleDelete = (id) => {
    onSave(services.filter(s => s.id !== id))
    toast.success('Servicio eliminado')
  }

  return (
    <div className="bg-[#0c1424] border border-[#f59e0b]/20 rounded-xl p-3 space-y-2">
      <div className="text-xs font-bold text-[#f59e0b] uppercase tracking-wider">Servicios disponibles</div>

      {services.length === 0 && <div className="text-xs text-slate-500 text-center py-2">Sin servicios creados</div>}

      {services.map(s => (
        <div key={s.id} className="flex items-center gap-2">
          {editService?.id === s.id ? (
            <>
              <input className="input flex-1 text-xs py-1" value={editService.name} onChange={e => setEditService(es => ({ ...es, name: e.target.value }))} />
              <input className="input w-20 text-xs py-1 font-mono" type="number" value={editService.price} onChange={e => setEditService(es => ({ ...es, price: e.target.value }))} />
              <button onClick={handleEdit} className="text-xs text-[#00e5a0] hover:underline">OK</button>
              <button onClick={() => setEditService(null)} className="text-xs text-slate-500">x</button>
            </>
          ) : (
            <>
              <button onClick={() => onAdd(s)} className="flex-1 text-left text-xs py-1.5 px-2 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#fbbf24] hover:bg-[#f59e0b]/20 transition-all">
                {s.name} — {fmt(s.price)}
              </button>
              {isAdmin && (
                <>
                  <button onClick={() => setEditService(s)} className="text-xs text-slate-400 hover:text-[#00e5a0]">✎</button>
                  <button onClick={() => handleDelete(s.id)} className="text-xs text-slate-400 hover:text-red-400">✕</button>
                </>
              )}
            </>
          )}
        </div>
      ))}

      {isAdmin && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-xs text-slate-500 font-semibold">Crear servicio</div>
          <div className="flex gap-1">
            <input className="input flex-1 text-xs py-1" placeholder="Nombre del servicio" value={newService.name} onChange={e => setNewService(s => ({ ...s, name: e.target.value }))} />
            <input className="input w-24 text-xs py-1 font-mono" type="number" placeholder="Precio" value={newService.price} onChange={e => setNewService(s => ({ ...s, price: e.target.value }))} />
          </div>
          <button onClick={handleAdd} className="btn-primary w-full text-xs py-1.5">+ Crear Servicio</button>
        </div>
      )}
    </div>
  )
}
