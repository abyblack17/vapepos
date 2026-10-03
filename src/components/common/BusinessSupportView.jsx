import React, { useEffect, useMemo, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { Timestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { AppShell } from '../../App'
import { AuthContext } from '../../contexts/AuthContext'
import { AppContext, getInitialState, recalculateCustomerLoyalty } from '../../contexts/AppContext'
import { BranchContext } from '../../contexts/BranchContext'
import { NavigationProvider } from '../../contexts/NavigationContext'
import { enterSupportMode } from '../../services/supportMode'
import { lastActivityLabel } from '../../utils/businessSupport'

const MODULES = ['products', 'liquids', 'customers', 'suppliers', 'sales', 'users', 'purchases', 'cash_sessions', 'settings', 'branch_settings', 'branches', 'fiscalConfig', 'ncfSequences', 'fiscalInvoices']
const reject = () => { toast.error('Modo soporte: solo consulta. No puedes guardar cambios.'); return { success: false, error: 'Solo lectura' } }
const rejectAsync = async () => { reject(); throw new Error('Modo soporte: solo lectura') }
const revive = value => {
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /At$/.test(key) && typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(entry) ? Timestamp.fromDate(new Date(entry)) : revive(entry)]))
  return value
}

export default function BusinessSupportView({ session, onExit }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [branchId, setBranchId] = useState('main')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const leave = enterSupportMode()
    setReady(true)
    return leave
  }, [])
  useEffect(() => {
    let cancelled = false
    setError('')
    const read = httpsCallable(getFunctions(), 'readBusinessSupport')
    async function load(module) {
      let cursor = null, rows = []
      do {
        const result = await read({ sessionId: session.sessionId, module, cursor })
        if (cancelled) return []
        rows.push(...result.data.rows.map(revive))
        cursor = result.data.nextCursor
      } while (cursor)
      return rows
    }
    Promise.all(MODULES.map(async module => [module, await load(module)]))
      .then(entries => { if (!cancelled) setData(Object.fromEntries(entries)) })
      .catch(err => { if (!cancelled) setError(err.message || 'No se pudo cargar el negocio.') })
    return () => { cancelled = true }
  }, [session.sessionId, revision])
  const values = useMemo(() => {
    if (!data) return null
    const business = session.business
    const owner = data.users.find(user => user.active !== false && user.role === 'Administrador')
    const currentUser = { ...owner, id: owner?.id || business.ownerId, uid: owner?.id || business.ownerId, name: owner?.name || owner?.displayName || business.ownerName || 'Administrador', role: 'Administrador', businessId: business.id, active: true }
    const main = { id: 'main', name: 'Sucursal principal', isMain: true, active: true }
    const branches = data.branches.some(branch => branch.id === 'main') ? data.branches : [main, ...data.branches]
    const selectedBranch = branches.find(branch => branch.id === branchId) || main
    const matches = item => branchId === 'main' ? !item.branchId || item.branchId === 'main' : item.branchId === branchId
    const state = { ...getInitialState(), ...data, loading: false, dataLoaded: true, businessId: business.id, currentUser, branchesEnabled: true, branchId, selectedBranch }
    for (const key of ['products', 'liquids', 'sales', 'purchases', 'fiscalInvoices']) state[key] = data[key].filter(matches)
    state.products = state.products.filter(item => item.active === true).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    state.liquids.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    state.sales.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    state.customers = recalculateCustomerLoyalty(data.customers, data.sales)
    state.settings = { ...getInitialState().settings, ...data.settings.find(row => row.id === 'config'), ...(branchId !== 'main' ? data.branch_settings.find(row => row.id === branchId) : {}) }
    state.cashSessions = data.cash_sessions.filter(matches).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
    state.cashSession = state.cashSessions.find(row => row.open === true) || getInitialState().cashSession
    state.fiscalConfig = data.fiscalConfig.find(row => row.id === 'config') || null
    state.alerts = state.products.filter(item => item.stock <= item.minStock).map(item => ({ id: 'low-stock-' + item.id, type: 'danger', msg: item.name + ': Stock bajo (' + item.stock + ' uds)', module: 'inventory' }))
    for (const liquid of state.liquids.filter(item => item.hasActive)) {
      const pct = Math.round(liquid.activeSaldo / liquid.activeCapacity * 100)
      if (pct <= (state.settings.lowBottleAlert || 10)) state.alerts.push({ id: 'low-bottle-' + liquid.id, type: 'warning', msg: liquid.name + ': Botella al ' + pct + '%', module: 'refills' })
      if (liquid.activeSaldo <= 0) state.alerts.push({ id: 'empty-' + liquid.id, type: 'danger', msg: liquid.name + ': Botella agotada', module: 'refills' })
    }
    return {
      auth: { business, businessId: business.id, currentUser, userProfile: currentUser, authUser: null, loading: false, isAuthenticated: true, isSupport: true, accessNow: Date.now(), login: rejectAsync, logout: reject, registerBusiness: rejectAsync, addEmployee: rejectAsync, updateUserRole: rejectAsync, updateUserPermissions: rejectAsync, deactivateUser: rejectAsync, deleteUser: rejectAsync, resetPassword: rejectAsync, changeOwnPassword: rejectAsync, setError: reject },
      app: { state, dispatch: reject },
      branch: { branchesEnabled: true, loadingBranches: false, branches, allBranches: branches, selectedBranch, selectedBranchId: branchId, canManageBranches: true, selectBranch: setBranchId, createBranch: rejectAsync, setBranchActive: rejectAsync, assignUser: rejectAsync, setUserBranch: rejectAsync, transferStock: rejectAsync, activeAdditionalCount: branches.filter(item => !item.isMain && item.active !== false).length, monthlyBranchCost: branches.filter(item => !item.isMain && item.active !== false).length * 300 },
    }
  }, [data, branchId, session.business])
  const protect = event => {
    const button = event.target.closest('button, [role="button"]')
    const label = button ? (button.textContent || '') + ' ' + (button.title || '') + ' ' + (button.getAttribute('aria-label') || '') : ''
    if (/guardar|eliminar|borrar|restaurar|confirmar|cobrar|registrar venta|finalizar venta|abrir caja|cerrar caja|transferir|enviar|desactivar|activar usuario|cerrar sesi[oó]n/i.test(label)) {
      event.preventDefault(); event.stopPropagation(); reject()
    }
  }
  return <div className="flex flex-col bg-[#080d18] text-slate-200 overflow-hidden" style={{ height: '100dvh' }}>
    <div className="shrink-0 z-50 bg-[#0c1424] border-b border-amber-500/30 px-4 py-2 flex flex-wrap gap-2 items-center justify-between">
      <div><div className="font-bold">Soporte · {session.business.name}</div><div className="text-xs text-amber-300">Solo lectura · Última actividad: {lastActivityLabel(session.business.lastActivityAt)}</div></div>
      <div className="flex gap-2"><button className="btn-secondary" onClick={() => setRevision(value => value + 1)}>Actualizar datos</button><button className="btn-secondary" onClick={onExit}>Salir de soporte</button></div>
    </div>
    {error ? <div className="p-6" role="alert">{error}</div> : !values || !ready ? <div className="p-6">Cargando el negocio…</div> :
      <div className="flex-1 min-h-0 support-customer-view" onClickCapture={protect} onSubmitCapture={event => { event.preventDefault(); event.stopPropagation(); reject() }}>
        <AuthContext.Provider value={values.auth}><BranchContext.Provider value={values.branch}><AppContext.Provider value={values.app}><NavigationProvider><AppShell /></NavigationProvider></AppContext.Provider></BranchContext.Provider></AuthContext.Provider>
      </div>}
    <style>{'.support-customer-view .sidebar {height:100% !important}'}</style>
  </div>
}
