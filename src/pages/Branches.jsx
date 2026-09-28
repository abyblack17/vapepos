import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { BRANCH_MONTHLY_PRICE, MAX_ADDITIONAL_BRANCHES, useBranches } from '../contexts/BranchContext'
import { useApp } from '../contexts/AppContext'

const money = value => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 0 }).format(value || 0)

export default function Branches() {
  const { state } = useApp()
  const { branches, selectedBranchId, selectBranch, createBranch, setBranchActive, transferStock, canManageBranches, activeAdditionalCount, monthlyBranchCost } = useBranches()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', phone: '' })
  const [transfer, setTransfer] = useState(null)

  const submit = async event => {
    event.preventDefault()
    setSaving(true)
    try {
      const created = await createBranch(form)
      setForm({ name: '', address: '', phone: '' })
      setShowForm(false)
      selectBranch(created.id)
      toast.success(`Sucursal “${created.name}” creada`)
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  const submitTransfer = async event => {
    event.preventDefault()
    setSaving(true)
    try {
      await transferStock({ ...transfer, sourceBranchId: selectedBranchId, quantity: Number(transfer.quantity) })
      toast.success('Transferencia completada y registrada')
      setTransfer(null)
      setTimeout(() => window.location.reload(), 700)
    } catch (error) { toast.error(error.message) }
    finally { setSaving(false) }
  }

  return <div className="space-y-5 max-w-6xl mx-auto">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-bold text-slate-100">Sucursales</h2>
        <p className="text-sm text-slate-500 mt-1">La principal está incluida. Cada sucursal adicional cuesta {money(BRANCH_MONTHLY_PRICE)} al mes.</p>
      </div>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={branches.filter(branch => branch.active !== false).length < 2} onClick={() => setTransfer({ itemType: 'product', itemId: '', targetBranchId: '', quantity: 1 })}>⇄ Transferir</button>
        <button className="btn-primary" disabled={activeAdditionalCount >= MAX_ADDITIONAL_BRANCHES} onClick={() => setShowForm(true)}>+ Nueva sucursal</button>
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="card p-4"><div className="text-xs text-slate-500">Locales activos</div><div className="text-2xl font-bold text-[#00e5a0] mt-1">{activeAdditionalCount + 1}</div><div className="text-xs text-slate-500">de {MAX_ADDITIONAL_BRANCHES + 1} máximo</div></div>
      <div className="card p-4"><div className="text-xs text-slate-500">Sucursales adicionales</div><div className="text-2xl font-bold text-[#00c4e8] mt-1">{activeAdditionalCount}</div><div className="text-xs text-slate-500">máximo {MAX_ADDITIONAL_BRANCHES}</div></div>
      <div className="card p-4"><div className="text-xs text-slate-500">Cargo mensual adicional</div><div className="text-2xl font-bold text-[#f59e0b] mt-1">{money(monthlyBranchCost)}</div><div className="text-xs text-slate-500">prueba sin cobro automático</div></div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {branches.map(branch => <div key={branch.id} className={`card p-4 border ${selectedBranchId === branch.id ? 'border-[#00e5a0]/50' : 'border-white/5'} ${branch.active === false ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xl">{branch.isMain ? '🏪' : '📍'}</span><h3 className="font-semibold text-slate-100 truncate">{branch.name}</h3></div><div className="text-xs text-slate-500 mt-1">{branch.code || (branch.isMain ? 'PRINCIPAL' : '')}</div></div>
          <span className={`text-xs px-2 py-1 rounded-full ${branch.active === false ? 'bg-red-500/10 text-red-400' : 'bg-[#00e5a0]/10 text-[#00e5a0]'}`}>{branch.active === false ? 'Suspendida' : 'Activa'}</span>
        </div>
        {(branch.address || branch.phone) && <div className="mt-3 text-xs text-slate-400 space-y-1">{branch.address && <div>📍 {branch.address}</div>}{branch.phone && <div>☎ {branch.phone}</div>}</div>}
        <div className="mt-4 flex gap-2">
          {branch.active !== false && <button className="btn-secondary flex-1" disabled={selectedBranchId === branch.id} onClick={() => selectBranch(branch.id)}>{selectedBranchId === branch.id ? 'Sucursal actual' : 'Entrar'}</button>}
          {canManageBranches && !branch.isMain && <button className="btn-secondary" onClick={async () => { try { await setBranchActive(branch.id, branch.active === false); toast.success(branch.active === false ? 'Sucursal activada' : 'Sucursal suspendida') } catch (error) { toast.error(error.message) } }}>{branch.active === false ? 'Activar' : 'Suspender'}</button>}
        </div>
      </div>)}
    </div>

    {showForm && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><form onSubmit={submit} className="w-full max-w-md bg-[#0c1424] border border-white/10 rounded-2xl p-5 space-y-4"><div className="flex justify-between"><h3 className="font-bold text-slate-100">Nueva sucursal</h3><button type="button" onClick={() => setShowForm(false)} className="text-slate-500">✕</button></div><div><label className="label">Nombre *</label><input autoFocus className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Sucursal Santiago" required /></div><div><label className="label">Dirección</label><input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div><div><label className="label">Teléfono</label><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div><div className="alert-info text-xs">Esta sucursal añadirá {money(BRANCH_MONTHLY_PRICE)} al costo mensual cuando el sistema de cobro esté habilitado.</div><div className="flex gap-2 justify-end"><button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button><button className="btn-primary" disabled={saving}>{saving ? 'Creando...' : 'Crear sucursal'}</button></div></form></div>}
    {transfer && <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><form onSubmit={submitTransfer} className="w-full max-w-md bg-[#0c1424] border border-white/10 rounded-2xl p-5 space-y-4"><div className="flex justify-between"><div><h3 className="font-bold text-slate-100">Transferir inventario</h3><div className="text-xs text-slate-500 mt-1">Origen: {branches.find(branch => branch.id === selectedBranchId)?.name}</div></div><button type="button" onClick={() => setTransfer(null)} className="text-slate-500">✕</button></div><div><label className="label">Tipo</label><select className="select" value={transfer.itemType} onChange={e => setTransfer({ ...transfer, itemType: e.target.value, itemId: '' })}><option value="product">Producto</option><option value="liquid">Líquido — botellas cerradas</option></select></div><div><label className="label">Artículo</label><select required className="select" value={transfer.itemId} onChange={e => setTransfer({ ...transfer, itemId: e.target.value })}><option value="">Seleccionar...</option>{(transfer.itemType === 'product' ? state.products : state.liquids).filter(item => Number(transfer.itemType === 'product' ? item.stock : item.closedBottles) > 0).map(item => <option key={item.id} value={item.id}>{item.name} — disponible: {transfer.itemType === 'product' ? item.stock : item.closedBottles}</option>)}</select></div><div><label className="label">Sucursal destino</label><select required className="select" value={transfer.targetBranchId} onChange={e => setTransfer({ ...transfer, targetBranchId: e.target.value })}><option value="">Seleccionar...</option>{branches.filter(branch => branch.id !== selectedBranchId && branch.active !== false).map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div><div><label className="label">Cantidad</label><input required min="1" step="1" type="number" className="input" value={transfer.quantity} onChange={e => setTransfer({ ...transfer, quantity: e.target.value })} /></div><div className="alert-info text-xs">La operación descontará del origen y sumará al destino. Quedará registrada en la bitácora.</div><div className="flex gap-2 justify-end"><button type="button" className="btn-secondary" onClick={() => setTransfer(null)}>Cancelar</button><button className="btn-primary" disabled={saving}>{saving ? 'Transfiriendo...' : 'Confirmar transferencia'}</button></div></form></div>}
  </div>
}
