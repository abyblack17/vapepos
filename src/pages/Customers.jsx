import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import UpgradeModal from '../components/ui/UpgradeModal'
import ExcelDataActions from '../components/common/ExcelDataActions'
import { bizAdd, bizUpdate, bizDelete, bizSet } from '../services/firestoreService'
import { fmt, genId, formatDate } from '../utils/helpers'
import { findExistingByNameOrCode, hasDuplicateName, hasDuplicateCode, makeCustomerCode } from '../utils/recordGuards'
import { usePlan } from '../hooks/usePlan'
import toast from 'react-hot-toast'

export default function Customers() {
  const { state, dispatch } = useApp()
  const { businessId }      = useAuth()
  const { canAdd, usage, isLocked } = usePlan()
  const [search, setSearch]   = useState('')
  const [modal, setModal]     = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)

  const activeCustomers = state.customers.filter(c => !c.planLocked)
  const lockedCustomers = state.customers.filter(c => c.planLocked)

  const filtered = activeCustomers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.code || '').toLowerCase().includes(search.toLowerCase())
  )

  const customerUsage  = usage('customers')
  const canAddCustomer = canAdd('customers')

  const handleSave = async (data, isEdit) => {
    if (savingCustomer) return
    if (!isEdit && !canAddCustomer) { setShowUpgrade(true); return }

    const name = data.name?.trim()
    if (!name) { toast.error('Nombre requerido'); return }
    const code = data.code?.trim() || makeCustomerCode(state.customers)

    if (hasDuplicateName(state.customers, name, isEdit ? data.id : null)) {
      toast.error(`Ya existe un cliente llamado "${name}"`)
      return
    }
    if (hasDuplicateCode(state.customers, code, isEdit ? data.id : null)) {
      toast.error(`Ya existe un cliente con el código ${code}`)
      return
    }

    setSavingCustomer(true)
    try {
      if (isEdit) {
        const payload = { ...data, name, code }
        dispatch({ type: 'UPDATE_CUSTOMER', payload })
        if (businessId) await bizUpdate(businessId, 'customers', payload.id, payload)
        toast.success('Cliente actualizado')
      } else {
        const newCustomer = {
          ...data,
          name,
          code,
          totalSpent: 0,
          totalTransactions: 0,
          creditBalance: 0,
          refillRewards: 0,
          totalRefills: 0,
          rewardPoints: 0,
          lastPurchase: null,
        }
        if (businessId) {
          const saved = await bizAdd(businessId, 'customers', newCustomer)
          if (saved?.id) {
            dispatch({ type: 'ADD_CUSTOMER', payload: { ...newCustomer, id: saved.id, createdAt: new Date() } })
            toast.success(`Cliente "${name}" registrado`)
            setModal(null)
            return
          }
        }
        dispatch({ type: 'ADD_CUSTOMER', payload: { id: genId('c'), ...newCustomer, createdAt: new Date() } })
        toast.success(`Cliente "${name}" registrado`)
      }
      setModal(null)
    } finally {
      setSavingCustomer(false)
    }
  }

  const handleDelete = async (customer) => {
    dispatch({ type: 'DELETE_CUSTOMER', payload: customer.id })
    if (businessId) await bizDelete(businessId, 'customers', customer.id)
    toast.success(`Cliente "${customer.name}" eliminado`)
    setModal(null)
  }

  const handleImportCustomers = async (rows) => {
    let imported = 0
    let skipped = 0
    const working = [...state.customers]
    for (const row of rows) {
      if (!row.name?.trim()) { skipped += 1; continue }
      const existing = findExistingByNameOrCode(working, row, 'code')
      const id = existing?.id || row.id || genId('c')
      const payload = {
        ...existing,
        ...row,
        id,
        name: row.name.trim(),
        code: row.code?.trim() || existing?.code || makeCustomerCode(working),
      }
      dispatch({ type: existing ? 'UPDATE_CUSTOMER' : 'ADD_CUSTOMER', payload })
      const pos = working.findIndex(c => c.id === id)
      if (pos >= 0) working[pos] = payload
      else working.push(payload)
      if (businessId) {
        const { id: customerId, ...data } = payload
        await bizSet(businessId, 'customers', customerId, data)
      }
      imported += 1
    }
    toast.success(`${imported} cliente(s) importado(s)/actualizado(s)${skipped ? `, ${skipped} omitido(s)` : ''}`)
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Banners de límite */}
      {customerUsage.nearLimit && !customerUsage.atLimit && (
        <div className="alert-warning text-xs">
          ⚠ Tienes {customerUsage.current} de {customerUsage.limit} clientes. Cerca del límite del plan Básico.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro</button>
        </div>
      )}
      {customerUsage.atLimit && (
        <div className="alert-danger text-xs">
          🔒 Has alcanzado el límite de {customerUsage.limit} clientes del plan Básico.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro</button>
        </div>
      )}

      {/* Summary */}
      <div className="flex gap-3 flex-wrap">
        <div className="card px-4 py-2.5 flex items-center gap-2">
          <span className="text-[#00e5a0] font-bold font-mono text-lg">{activeCustomers.length}</span>
          <span className="text-xs text-slate-400">
            clientes registrados
            {!customerUsage.isUnlimited && <span className="ml-1 text-slate-500">/ {customerUsage.limit}</span>}
          </span>
        </div>
        <div className="card px-4 py-2.5 flex items-center gap-2">
          <span className="text-[#00c4e8] font-bold font-mono text-sm">{fmt(activeCustomers.reduce((a, c) => a + (c.totalSpent || 0), 0))}</span>
          <span className="text-xs text-slate-400">facturación total</span>
        </div>
        {lockedCustomers.length > 0 && (
          <div className="card px-4 py-2.5 flex items-center gap-2 border-[#f59e0b]/20 cursor-pointer" onClick={() => setShowUpgrade(true)}>
            <span className="text-[#f59e0b] font-bold font-mono">🔒 {lockedCustomers.length}</span>
            <span className="text-xs text-slate-400">bloqueados por plan</span>
          </div>
        )}
      </div>

      {/* Search + Add */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2.5 min-w-[220px]">
          <span className="text-slate-500">🔍</span>
          <input className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
            placeholder="Buscar por nombre o teléfono..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <ExcelDataActions entity="customers" rows={activeCustomers} onImport={handleImportCustomers} />
        <button onClick={() => canAddCustomer ? setModal({ type: 'new' }) : setShowUpgrade(true)} className="btn-primary">
          + Nuevo Cliente
        </button>
      </div>

      {/* Table */}
      <div className="table-container overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {['Código', 'Cliente', 'Teléfono', 'Email', 'Total Comprado', 'Deuda', 'Recargas Acum.', 'Puntos', 'Transacciones', 'Última Compra', 'Notas', ''].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className="table-row">
                <td className="table-cell font-mono text-xs text-[#00c4e8]">{c.code || '—'}</td>
                <td className="table-cell">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-[#00e5a0]/10 border border-[#00e5a0]/20 flex items-center justify-center text-xs font-bold text-[#00e5a0] flex-shrink-0">
                      {c.name[0]}
                    </div>
                    <span className="font-semibold text-slate-200">{c.name}</span>
                  </div>
                </td>
                <td className="table-cell font-mono text-slate-300">{c.phone}</td>
                <td className="table-cell text-slate-400 text-xs">{c.email || '—'}</td>
                <td className="table-cell font-mono font-bold text-[#00e5a0]">{fmt(c.totalSpent || 0)}</td>
                <td className={`table-cell font-mono font-bold ${(c.creditBalance || 0) > 0 ? 'text-red-400' : 'text-slate-500'}`}>{fmt(c.creditBalance || 0)}</td>
                <td className="table-cell text-center">
                  <span className="badge badge-blue">{c.refillRewards ?? c.totalRefills ?? 0}</span>
                </td>
                <td className="table-cell text-center">
                  <span className="badge badge-green">{c.rewardPoints ?? Math.floor((c.totalSpent || 0) / 50)}</span>
                </td>
                <td className="table-cell text-center"><span className="badge badge-blue">{c.totalTransactions || 0}</span></td>
                <td className="table-cell text-slate-400 text-xs">{c.lastPurchase ? formatDate(c.lastPurchase) : '—'}</td>
                <td className="table-cell text-slate-500 text-xs max-w-[160px] truncate">{c.notes || '—'}</td>
                <td className="table-cell">
                  <div className="flex gap-1">
                    <button onClick={() => setModal({ type: 'edit', data: c })}
                      className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">
                      Editar
                    </button>
                    <button onClick={() => setModal({ type: 'delete', data: c })}
                      className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="table-cell text-center text-slate-500 py-10">Sin clientes encontrados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Clientes bloqueados */}
      {lockedCustomers.length > 0 && (
        <div className="card p-4 border-[#f59e0b]/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[#f59e0b]">🔒</span>
              <span className="text-sm font-semibold text-[#f59e0b]">{lockedCustomers.length} clientes bloqueados — Plan Básico</span>
            </div>
            <button onClick={() => setShowUpgrade(true)} className="text-xs text-[#00e5a0] hover:underline">Actualizar a Pro →</button>
          </div>
          <div className="space-y-1">
            {lockedCustomers.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/10 opacity-60">
                <span className="text-[#f59e0b] text-sm">🔒</span>
                <span className="text-sm text-slate-400 truncate">{c.name}</span>
                <span className="text-xs text-slate-500 ml-auto">{c.phone || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {modal?.type === 'delete' && (
        <Modal title="Eliminar Cliente" onClose={() => setModal(null)} size="sm">
          <div className="bg-red-400/10 border border-red-400/20 text-red-300 text-sm rounded-lg p-3 mb-4">
            ¿Eliminar a <strong>{modal.data.name}</strong>? Se perderá su historial de compras registrado.
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn-danger" onClick={() => handleDelete(modal.data)}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal && modal.type !== 'delete' && (
        <CustomerModal
          data={modal.type === 'edit' ? modal.data : null}
          onClose={() => setModal(null)}
          onSave={(d) => handleSave(d, modal.type === 'edit')}
          saving={savingCustomer}
          customers={state.customers}
        />
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}

function CustomerModal({ data, onClose, onSave, saving = false, customers = [] }) {
  const [form, setForm] = useState({
    id: data?.id || '', name: data?.name || '',
    phone: data?.phone || '', email: data?.email || '', notes: data?.notes || '',
    code: data?.code || (!data ? makeCustomerCode(customers) : ''),
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal title={data ? `Editar: ${data.name}` : 'Nuevo Cliente'} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div><label className="label">Nombre completo *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Juan Pérez" /></div>
        <div className="form-row">
          <div><label className="label">Teléfono</label><input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="809-555-0000" /></div>
          <div><label className="label">Email (opcional)</label><input className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        </div>
        <div><label className="label">Código de cliente</label><input className="input font-mono" value={form.code} onChange={e => set('code', e.target.value)} placeholder="Se genera automático" /></div>
        <div><label className="label">Notas</label><textarea className="input resize-none" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Preferencias, observaciones..." /></div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saving} onClick={async () => { if (!form.name) return toast.error('Nombre requerido'); await onSave(form) }}>
            {saving ? 'Guardando...' : (data ? 'Guardar' : 'Registrar Cliente')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
