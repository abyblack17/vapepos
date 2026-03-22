import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import Modal from '../components/ui/Modal'
import { fmt, genId, today, formatTime } from '../utils/helpers'
import toast from 'react-hot-toast'

export default function Purchases() {
  const { state, dispatch } = useApp()
  const purchases = state.purchases || []
  const [modal, setModal] = useState(null)
  const [items, setItems] = useState([{ name: '', qty: '', unitPrice: '' }])
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')

  const addItem = () => setItems(prev => [...prev, { name: '', qty: '', unitPrice: '' }])
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))
  const updateItem = (i, field, value) => setItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item))

  const total = items.reduce((a, i) => {
    const qty = parseFloat(i.qty) || 0
    const price = parseFloat(i.unitPrice) || 0
    return a + qty * price
  }, 0)

  const handleSave = () => {
    const validItems = items.filter(i => i.name && i.qty && i.unitPrice)
    if (validItems.length === 0) return toast.error('Agrega al menos un articulo valido')

    const purchase = {
      id:       genId('purch'),
      date:     today(),
      time:     formatTime(),
      supplier: supplier || 'Sin proveedor',
      notes:    notes,
      items:    validItems.map(i => ({
        name:      i.name,
        qty:       parseFloat(i.qty),
        unitPrice: parseFloat(i.unitPrice),
        total:     parseFloat(i.qty) * parseFloat(i.unitPrice),
      })),
      total,
      registeredBy: state.currentUser?.name || 'Admin',
      createdAt: new Date(),
    }

    dispatch({ type: 'ADD_PURCHASE', payload: purchase })
    toast.success('Compra registrada correctamente')
    setItems([{ name: '', qty: '', unitPrice: '' }])
    setSupplier('')
    setNotes('')
    setModal(null)
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display font-bold text-slate-100 text-lg">Compras</h2>
          <div className="text-xs text-slate-400">{purchases.length} compras registradas</div>
        </div>
        <button onClick={() => setModal('new')} className="btn-primary">+ Registrar Compra</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold font-mono text-[#00e5a0]">{purchases.length}</div>
          <div className="text-xs text-slate-400 mt-1">Total compras</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-lg font-bold font-mono text-[#00c4e8]">
            {fmt(purchases.filter(p => p.date === today()).reduce((a, p) => a + p.total, 0))}
          </div>
          <div className="text-xs text-slate-400 mt-1">Compras hoy</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-lg font-bold font-mono text-[#f59e0b]">
            {fmt(purchases.reduce((a, p) => a + p.total, 0))}
          </div>
          <div className="text-xs text-slate-400 mt-1">Total invertido</div>
        </div>
      </div>

      {/* Purchases list */}
      {purchases.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">🛒</div>
          <div className="text-slate-400">Sin compras registradas</div>
          <div className="text-xs text-slate-500 mt-1">Registra tus compras para llevar el control de gastos</div>
        </div>
      ) : (
        <div className="space-y-3">
          {[...purchases].reverse().map(p => (
            <div key={p.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold text-slate-200">{p.supplier}</div>
                  <div className="text-xs text-slate-500">{p.date} {p.time} — {p.registeredBy}</div>
                </div>
                <div className="font-mono font-bold text-[#f59e0b] text-lg">{fmt(p.total)}</div>
              </div>
              <div className="space-y-1">
                {p.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs text-slate-400 bg-[#101c35] rounded-lg px-3 py-2">
                    <span>{item.name}</span>
                    <span>{item.qty} u x {fmt(item.unitPrice)} = <span className="text-slate-200 font-mono font-semibold">{fmt(item.total)}</span></span>
                  </div>
                ))}
              </div>
              {p.notes && <div className="mt-2 text-xs text-slate-500 italic">{p.notes}</div>}
            </div>
          ))}
        </div>
      )}

      {/* New purchase modal */}
      {modal === 'new' && (
        <Modal title="Registrar Compra" onClose={() => setModal(null)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Proveedor</label>
                <input className="input" placeholder="Nombre del proveedor" value={supplier} onChange={e => setSupplier(e.target.value)} />
              </div>
              <div>
                <label className="label">Notas</label>
                <input className="input" placeholder="Observaciones opcionales..." value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label">Articulos comprados</label>
                <button onClick={addItem} className="text-xs text-[#00e5a0] hover:underline">+ Agregar articulo</button>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-slate-500 px-1">
                  <span className="col-span-5">Articulo</span>
                  <span className="col-span-2 text-center">Cantidad</span>
                  <span className="col-span-3 text-center">Precio unitario</span>
                  <span className="col-span-2 text-right">Total</span>
                </div>

                {items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="input col-span-5 text-sm py-2" placeholder="Nombre del articulo" value={item.name} onChange={e => updateItem(i, 'name', e.target.value)} />
                    <input className="input col-span-2 text-sm py-2 text-center font-mono" type="number" placeholder="0" value={item.qty} onChange={e => updateItem(i, 'qty', e.target.value)} />
                    <input className="input col-span-3 text-sm py-2 font-mono" type="number" placeholder="0" value={item.unitPrice} onChange={e => updateItem(i, 'unitPrice', e.target.value)} />
                    <div className="col-span-1 text-xs font-mono text-[#00e5a0] text-right">
                      {fmt((parseFloat(item.qty) || 0) * (parseFloat(item.unitPrice) || 0))}
                    </div>
                    {items.length > 1 && (
                      <button onClick={() => removeItem(i)} className="col-span-1 text-slate-500 hover:text-red-400 text-xs">x</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="bg-[#101c35] rounded-xl p-4 flex justify-between items-center">
              <span className="font-semibold text-slate-200">Total de la compra</span>
              <span className="font-display font-bold text-[#f59e0b] text-xl">{fmt(total)}</span>
            </div>

            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={handleSave}>Guardar Compra</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
