import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import StatCard from '../components/ui/StatCard'
import Modal from '../components/ui/Modal'
import { fmt, today, formatTime, genId, canDo } from '../utils/helpers'
import { getSalesByPayment } from '../services/cashService'
import toast from 'react-hot-toast'

const TABS = ['Turno Actual', 'Historial']

export default function Cash() {
  const { state, dispatch } = useApp()
  const { cashSession, sales, currentUser } = state
  const [tab, setTab]               = useState('Turno Actual')
  const [modal, setModal]           = useState(null)
  const [counted, setCounted]       = useState('')
  const [closeNotes, setCloseNotes] = useState('')
  const [openAmount, setOpenAmount] = useState('2000')
  const [expenseForm, setExpenseForm] = useState({ amount: '', reason: '' })
  const [editingExpense, setEditingExpense] = useState(null)
  const [editingCreditPayment, setEditingCreditPayment] = useState(null)

  const isAdmin    = currentUser?.role === 'Administrador'
  const isEncargado = currentUser?.role === 'Encargado'
  const canSeeHistory = isAdmin || isEncargado

  const safeSales      = Array.isArray(sales) ? sales.filter(Boolean) : []
  const safeSession    = cashSession || {}
  const todaySales     = safeSales.filter(s => s?.date === today())
  const cashTotal      = (Number(safeSession.openAmount) || 0) + (Number(safeSession.sales) || 0) - (Number(safeSession.expenses) || 0)
  const byPayment      = getSalesByPayment(todaySales)
  const expenses       = Array.isArray(safeSession.expenseList) ? safeSession.expenseList.filter(Boolean) : []
  const creditPayments = Array.isArray(safeSession.creditPayments) ? safeSession.creditPayments.filter(Boolean) : []
  const totalCredits   = state.customers?.reduce((a, c) => a + (c.creditBalance || 0), 0) || 0
  const totalSalesAmount = todaySales.reduce((a, s) => a + s.total, 0)

  // Cash history — all sessions sorted by date
  const cashHistory = [...(state.cashSessions || [])].sort((a, b) =>
    new Date(b.createdAt?.seconds ? b.createdAt.seconds * 1000 : b.createdAt) -
    new Date(a.createdAt?.seconds ? a.createdAt.seconds * 1000 : a.createdAt)
  )

  const handleOpenCash = () => {
    const amount = parseFloat(openAmount)
    if (isNaN(amount) || amount < 0) return toast.error('Monto invalido')
    dispatch({
      type: 'OPEN_CASH',
      payload: { open: true, openTime: formatTime(), openAmount: amount, user: currentUser?.name || 'Admin', userId: currentUser?.id || 'u1', date: today(), sales: 0, expenses: 0, expenseList: [], creditPayments: [] },
    })
    toast.success(`Caja abierta con ${fmt(amount)}`)
    setModal(null)
  }

  const handleCloseCash = () => {
    const c = parseFloat(counted)
    if (isNaN(c)) return toast.error('Ingresa el monto contado')
    const diff = c - cashTotal
    dispatch({ type: 'CLOSE_CASH' })
    toast.success(`Caja cerrada. ${diff >= 0 ? 'Sobrante' : 'Faltante'}: ${fmt(Math.abs(diff))}`)
    setModal(null)
  }

  const handleAddExpense = () => {
    const amount = parseFloat(expenseForm.amount)
    if (isNaN(amount) || amount <= 0) return toast.error('Monto invalido')
    if (!expenseForm.reason.trim()) return toast.error('Debes indicar el motivo')
    const expense = { id: genId('exp'), amount, reason: expenseForm.reason.trim(), time: formatTime(), user: currentUser?.name || 'Admin', date: today() }
    dispatch({ type: 'ADD_EXPENSE_DETAIL', payload: expense })
    setExpenseForm({ amount: '', reason: '' })
    toast.success(`Egreso de ${fmt(amount)} registrado`)
    setModal(null)
  }

  const handleEditExpense = () => {
    if (!editingExpense) return
    const amount = parseFloat(editingExpense.amount)
    if (isNaN(amount) || amount <= 0) return toast.error('Monto invalido')
    if (!editingExpense.reason.trim()) return toast.error('Motivo requerido')
    dispatch({ type: 'EDIT_EXPENSE', payload: { ...editingExpense, amount } })
    setEditingExpense(null)
    toast.success('Egreso actualizado')
  }

  const handleDeleteExpense = (expense) => {
    dispatch({ type: 'DELETE_EXPENSE', payload: expense.id })
    toast.success('Egreso eliminado')
  }

  const handleEditCreditPayment = () => {
    if (!editingCreditPayment) return
    const amount = parseFloat(editingCreditPayment.amount)
    if (isNaN(amount) || amount <= 0) return toast.error('Monto invalido')

    const oldPayment = creditPayments.find(p => p?.id === editingCreditPayment.id)
    const oldAmount = Number(oldPayment?.amount) || 0

    if (editingCreditPayment.customerId) {
      const customer = state.customers?.find(c => c.id === editingCreditPayment.customerId)
      const maxAllowed = (Number(customer?.creditBalance) || 0) + oldAmount
      if (amount > maxAllowed) return toast.error(`Maximo permitido: ${fmt(maxAllowed)}`)
    }

    dispatch({ type: 'EDIT_CREDIT_PAYMENT', payload: { ...editingCreditPayment, amount } })
    setEditingCreditPayment(null)
    toast.success('Abono actualizado')
  }

  const handleDeleteCreditPayment = (payment) => {
    if (!payment?.id) return toast.error('No se pudo identificar el abono')
    dispatch({ type: 'DELETE_CREDIT_PAYMENT', payload: payment.id, customerId: payment.customerId })
    toast.success('Abono eliminado')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Tabs — only show historial to admin/encargado */}
      {canSeeHistory && (
        <div className="flex gap-1 bg-[#101c35] rounded-xl p-1 w-fit">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t ? 'bg-neon-green text-[#080d18]' : 'text-slate-400 hover:text-slate-200'
              }`}>{t}</button>
          ))}
        </div>
      )}

      {/* ── HISTORIAL TAB ── */}
      {tab === 'Historial' && canSeeHistory && (
        <div className="space-y-4">
          <div className="text-sm text-slate-400">{cashHistory.length} turnos registrados</div>
          {cashHistory.length === 0 ? (
            <div className="card p-8 text-center text-slate-500">No hay turnos registrados aun</div>
          ) : (
            <div className="table-container overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    {['Fecha', 'Apertura', 'Abrió', 'Hora', 'Vendido', 'Egresos', 'Total Cierre', 'Estado'].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cashHistory.map((session, i) => {
                    const total = (session.openAmount || 0) + (session.sales || 0) - (session.expenses || 0)
                    return (
                      <tr key={session.id || i} className="table-row">
                        <td className="table-cell text-slate-300 font-mono text-xs">{session.date || '—'}</td>
                        <td className="table-cell font-mono text-[#00c4e8]">{fmt(session.openAmount || 0)}</td>
                        <td className="table-cell text-slate-400 text-xs">{session.user || '—'}</td>
                        <td className="table-cell text-slate-500 text-xs">
                          <div>{session.openTime || '—'}</div>
                          {session.closeTime && <div className="text-slate-600">↓ {session.closeTime}</div>}
                        </td>
                        <td className="table-cell font-mono text-[#00e5a0]">{fmt(session.sales || 0)}</td>
                        <td className="table-cell font-mono text-amber-400">{fmt(session.expenses || 0)}</td>
                        <td className="table-cell font-mono font-bold text-slate-200">{fmt(total)}</td>
                        <td className="table-cell">
                          <span className={`badge ${session.open ? 'badge-green' : 'badge-gray'}`}>
                            {session.open ? 'Abierto' : 'Cerrado'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TURNO ACTUAL TAB ── */}
      {(tab === 'Turno Actual' || !canSeeHistory) && (
        <>
          {/* Status banner */}
          <div className={`rounded-xl border p-4 flex items-center gap-4 ${cashSession.open ? 'bg-[#00e5a0]/10 border-[#00e5a0]/20' : 'bg-red-500/5 border-red-500/20'}`}>
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${cashSession.open ? 'bg-neon-green animate-pulse' : 'bg-red-400'}`} />
            <div>
              <div className={`font-semibold text-sm ${cashSession.open ? 'text-[#00e5a0]' : 'text-red-400'}`}>
                {cashSession.open ? 'Caja Abierta — Turno Activo' : 'Caja Cerrada'}
              </div>
              <div className="text-xs text-slate-400">
                {cashSession.open ? `Abierta a las ${cashSession.openTime} por ${cashSession.user}` : 'No hay turno activo'}
              </div>
            </div>
            <div className="ml-auto flex gap-2">
              {cashSession.open && (
                <button onClick={() => setModal('expense')} className="btn-secondary text-sm">+ Egreso</button>
              )}
              {cashSession.open
                ? <button onClick={() => setModal('close')} className="btn-danger text-sm">Cerrar Caja</button>
                : <button onClick={() => setModal('open')} className="btn-primary text-sm">Abrir Caja</button>
              }
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard label="Apertura"         value={fmt(cashSession.openAmount || 0)} sub={cashSession.openTime}               accent="blue"   icon="🔓" />
            <StatCard label="Cobrado en turno" value={fmt(cashSession.sales || 0)}      sub={`${todaySales.length} transacciones`} accent="green"  icon="💵" />
            <StatCard label="Egresos"          value={fmt(cashSession.expenses || 0)}   sub={`${expenses.length} registrados`}    accent="amber"  icon="📤" />
            <StatCard label="Total en Caja"    value={fmt(cashTotal)}                   sub="esperado al cierre"                  accent="purple" icon="💰" />
          </div>

          {/* Creditos pendientes */}
          {totalCredits > 0 && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4 flex items-center gap-4">
              <div className="text-2xl">💳</div>
              <div className="flex-1">
                <div className="font-semibold text-red-400 text-sm">Creditos Pendientes de cobro</div>
                <div className="text-xs text-slate-400">Ventas facturadas pero no cobradas aun</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-red-400 text-xl">{fmt(totalCredits)}</div>
                <div className="text-xs text-slate-500">Ventas totales: {fmt(totalSalesAmount)}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Payment breakdown */}
            <div className="card p-5">
              <div className="section-title">Desglose por Metodo de Pago</div>
              <div className="space-y-3">
                {byPayment.map(bp => (
                  <div key={bp.method}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-slate-300">{bp.method}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">{bp.count} ventas</span>
                        <span className="font-mono font-bold text-[#00e5a0]">{fmt(bp.total)}</span>
                      </div>
                    </div>
                    <div className="bottle-progress">
                      <div className="h-full bottle-fill-green rounded"
                        style={{ width: `${cashSession.sales ? Math.round(bp.total / cashSession.sales * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-white/10 flex justify-between">
                <span className="font-semibold text-slate-200">Cobrado real</span>
                <span className="font-mono font-bold text-[#00e5a0] text-lg">{fmt(cashSession.sales || 0)}</span>
              </div>
            </div>

            {/* Expenses list */}
            <div className="card p-5">
              <div className="section-title">Egresos del Turno</div>
              {expenses.length === 0 ? (
                <div className="text-center text-slate-500 text-sm py-4">Sin egresos registrados</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {expenses.map((exp) => (
                    <div key={exp.id} className="bg-[#101c35] rounded-lg px-3 py-2">
                      {editingExpense?.id === exp.id ? (
                        <div className="space-y-2">
                          <input className="input text-xs py-1 w-full" value={editingExpense.reason}
                            onChange={e => setEditingExpense(ed => ({ ...ed, reason: e.target.value }))} />
                          <div className="flex gap-1">
                            <input className="input flex-1 text-xs py-1 font-mono" type="number" value={editingExpense.amount}
                              onChange={e => setEditingExpense(ed => ({ ...ed, amount: e.target.value }))} />
                            <button onClick={handleEditExpense} className="text-xs px-2 py-1 rounded bg-[#00e5a0]/20 text-[#00e5a0]">OK</button>
                            <button onClick={() => setEditingExpense(null)} className="text-xs px-2 py-1 rounded bg-white/10 text-slate-400">x</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm text-slate-200">{exp.reason}</div>
                            <div className="text-xs text-slate-500">{exp.time} — {exp.user}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="font-mono font-bold text-amber-400">{fmt(exp.amount)}</div>
                            <button onClick={() => setEditingExpense({ ...exp })} className="text-xs text-slate-400 hover:text-[#00e5a0] transition-colors">✎</button>
                            <button onClick={() => handleDeleteExpense(exp)} className="text-xs text-slate-400 hover:text-red-400 transition-colors">✕</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-white/10 flex justify-between">
                <span className="font-semibold text-slate-200">Total Egresos</span>
                <span className="font-mono font-bold text-amber-400">{fmt(cashSession.expenses || 0)}</span>
              </div>
            </div>
          </div>

          {/* Credit payments log */}
          {creditPayments.length > 0 && (
            <div className="card p-5">
              <div className="section-title">Abonos a Creditos Recibidos</div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {creditPayments.map((cp, i) => (
                  <div key={cp.id || i} className="bg-[#101c35] rounded-lg px-3 py-2">
                    {editingCreditPayment?.id && editingCreditPayment.id === cp.id ? (
                      <div className="space-y-2">
                        <div className="text-xs text-slate-400">{cp.concept || 'Abono a credito'}</div>
                        <div className="flex gap-1">
                          <input
                            className="input flex-1 text-xs py-1 font-mono"
                            type="number"
                            min="1"
                            value={editingCreditPayment.amount}
                            onChange={e => setEditingCreditPayment(ed => ({ ...ed, amount: e.target.value }))}
                          />
                          <button onClick={handleEditCreditPayment} className="text-xs px-2 py-1 rounded bg-[#00e5a0]/20 text-[#00e5a0]">OK</button>
                          <button onClick={() => setEditingCreditPayment(null)} className="text-xs px-2 py-1 rounded bg-white/10 text-slate-400">x</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-slate-200">{cp.concept || 'Abono a credito'}</div>
                          <div className="text-xs text-slate-500">{cp.time || '—'} — {cp.date || '—'}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="font-mono font-bold text-[#00e5a0]">{fmt(Number(cp.amount) || 0)}</div>
                          {isAdmin && cp.id && (
                            <>
                              <button onClick={() => setEditingCreditPayment({ ...cp, amount: Number(cp.amount) || 0 })} className="text-xs text-slate-400 hover:text-[#00e5a0] transition-colors" title="Editar abono">✎</button>
                              <button onClick={() => handleDeleteCreditPayment(cp)} className="text-xs text-slate-400 hover:text-red-400 transition-colors" title="Eliminar abono">✕</button>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-white/10 flex justify-between">
                <span className="font-semibold text-slate-200">Total abonos</span>
                <span className="font-mono font-bold text-[#00e5a0]">{fmt(creditPayments.reduce((a, c) => a + (Number(c?.amount) || 0), 0))}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Open modal */}
      {modal === 'open' && (
        <Modal title="Abrir Caja" onClose={() => setModal(null)} size="sm">
          <div className="space-y-4">
            <div>
              <label className="label">Monto de apertura (RD$)</label>
              <input className="input text-lg font-mono" type="number" value={openAmount} onChange={e => setOpenAmount(e.target.value)} />
            </div>
            <div className="alert-info text-xs">El monto de apertura es el efectivo con el que inicia el turno.</div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={handleOpenCash}>Abrir Turno</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Expense modal */}
      {modal === 'expense' && (
        <Modal title="Registrar Egreso" onClose={() => setModal(null)} size="sm">
          <div className="space-y-4">
            <div>
              <label className="label">Motivo / Razon *</label>
              <input className="input" placeholder="Ej: Compra de comida, consumo de liquido..."
                value={expenseForm.reason} onChange={e => setExpenseForm(f => ({ ...f, reason: e.target.value }))} />
            </div>
            <div>
              <label className="label">Monto (RD$) *</label>
              <input className="input text-lg font-mono" type="number" placeholder="0"
                value={expenseForm.amount} onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-primary" onClick={handleAddExpense}>Registrar Egreso</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Close modal */}
      {modal === 'close' && (
        <Modal title="Cerrar Caja" onClose={() => setModal(null)} size="sm">
          <div className="space-y-4">
            <div className="card p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-400">Total esperado</span><span className="font-mono font-bold text-[#00e5a0]">{fmt(cashTotal)}</span></div>
            </div>
            <div>
              <label className="label">Monto contado en caja (RD$)</label>
              <input className="input text-lg font-mono" type="number" value={counted} onChange={e => setCounted(e.target.value)} placeholder="0" />
            </div>
            {counted && !isNaN(parseFloat(counted)) && (
              <div className={`text-sm font-semibold text-center ${parseFloat(counted) >= cashTotal ? 'text-[#00e5a0]' : 'text-red-400'}`}>
                {parseFloat(counted) >= cashTotal ? 'Sobrante' : 'Faltante'}: {fmt(Math.abs(parseFloat(counted) - cashTotal))}
              </div>
            )}
            <div>
              <label className="label">Observaciones</label>
              <textarea className="input resize-none" rows={2} value={closeNotes} onChange={e => setCloseNotes(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-danger" onClick={handleCloseCash}>Cerrar Turno</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
