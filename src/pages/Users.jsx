import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import ExcelDataActions from '../components/common/ExcelDataActions'
import UpgradeModal from '../components/ui/UpgradeModal'
import { defaultPermissions } from '../utils/helpers'
import { usePlan } from '../hooks/usePlan'
import toast from 'react-hot-toast'

const ROLE_INFO = {
  Administrador: { badge: 'badge-purple', desc: 'Acceso completo' },
  Encargado:     { badge: 'badge-blue',   desc: 'Ventas, inventario, caja' },
  Cajero:        { badge: 'badge-green',  desc: 'Ventas y recargas' },
}

const PERMISSION_GROUPS = [
  {
    label: 'Modulos visibles',
    items: [
      { key: 'dashboard',   label: 'Dashboard' },
      { key: 'inventory',   label: 'Inventario' },
      { key: 'purchases',   label: 'Compras' },
      { key: 'customers',   label: 'Clientes' },
      { key: 'suppliers',   label: 'Proveedores' },
      { key: 'reports',     label: 'Reportes' },
      { key: 'cash',        label: 'Caja' },
      { key: 'suggestions', label: 'Sugerencias' },
    ]
  },
  {
    label: 'Permisos especiales',
    items: [
      { key: 'viewProfit',      label: 'Ver ganancias' },
      { key: 'viewRendimiento', label: 'Ver rendimiento de liquidos' },
      { key: 'editInvoice',     label: 'Editar facturas' },
      { key: 'deleteInvoice',   label: 'Eliminar facturas' },
      { key: 'deleteProduct',   label: 'Eliminar productos' },
    ]
  },
]

export default function Users() {
  const { state, dispatch }    = useApp()
  const { currentUser, addEmployee, updateUserRole, updateUserPermissions, deleteUser } = useAuth()
  const { canAdd, usage, upgradeMessage } = usePlan()
  const [modal, setModal]      = useState(null)
  const [loading, setLoading]  = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const isAdmin = currentUser?.role === 'Administrador'

  const activeUsers  = state.users.filter(u => !u.planLocked)
  const lockedUsers  = state.users.filter(u => u.planLocked)
  const userUsage    = usage('users')
  const canAddUser   = canAdd('users')

  const handleAddEmployee = async (data) => {
    if (!canAddUser) { setShowUpgrade(true); return }
    setLoading(true)
    const result = await addEmployee({ email: data.email, password: data.password, displayName: data.name, role: data.role })
    setLoading(false)
    if (result.success) {
      dispatch({ type: 'ADD_USER', payload: { id: result.uid, name: data.name, email: data.email, role: data.role, active: true, createdAt: new Date() } })
      toast.success(`Empleado "${data.name}" agregado`)
      setModal(null)
    } else {
      toast.error(result.error || 'Error al crear empleado')
    }
  }

  const handleUpdateRole = async (data) => {
    setLoading(true)
    const result = await updateUserRole(data.id, data.role)
    setLoading(false)
    if (result.success) {
      dispatch({ type: 'UPDATE_USER', payload: data })
      toast.success('Rol actualizado')
      setModal(null)
    } else {
      toast.error(result.error || 'Error al actualizar rol')
    }
  }

  const handleDelete = async (user) => {
    setLoading(true)
    const result = await deleteUser(user.id)
    setLoading(false)
    if (result.success) {
      dispatch({ type: 'DELETE_USER', payload: user.id })
      toast.success(`"${user.name}" eliminado`)
      setModal(null)
    } else {
      toast.error(result.error || 'Error al eliminar usuario')
    }
  }

  const handleSavePermissions = async (user, permissions) => {
    setLoading(true)
    const result = await updateUserPermissions(user.id, permissions)
    if (result.success) {
      dispatch({ type: 'UPDATE_USER', payload: { ...user, permissions: result.permissions } })
      toast.success('Permisos actualizados')
      setModal(null)
    } else {
      toast.error(result.error || 'Error al guardar permisos')
    }
    setLoading(false)
  }

  const handleImportUsers = async (rows) => {
    if (!isAdmin) return toast.error('Solo el administrador puede importar usuarios')
    setLoading(true)
    let imported = 0
    let skipped = 0
    for (const row of rows) {
      const existing = state.users.find(u => u.email?.toLowerCase() === row.email?.toLowerCase() || u.id === row.id)
      if (existing) {
        const updated = { ...existing, name: row.name || existing.name, role: row.role || existing.role, active: row.active !== false }
        const result = await updateUserRole(existing.id, updated.role)
        if (result.success) {
          dispatch({ type: 'UPDATE_USER', payload: updated })
          imported += 1
        } else skipped += 1
        continue
      }
      if (!row.password || row.password.length < 8) {
        skipped += 1
        continue
      }
      const result = await addEmployee({ email: row.email, password: row.password, displayName: row.name, role: row.role })
      if (result.success) {
        dispatch({ type: 'ADD_USER', payload: { id: result.uid, name: row.name, email: row.email, role: row.role, active: row.active !== false, createdAt: new Date() } })
        imported += 1
      } else {
        skipped += 1
      }
    }
    setLoading(false)
    if (imported) toast.success(`${imported} usuario(s) importado(s)/actualizado(s) desde Excel`)
    if (skipped) toast.error(`${skipped} usuario(s) no se importaron. Para usuarios nuevos el Excel debe tener una contraseña de mínimo 8 caracteres.`)
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Banners de límite */}
      {userUsage.nearLimit && !userUsage.atLimit && (
        <div className="alert-warning text-xs">
          ⚠ Tienes {userUsage.current} de {userUsage.limit} empleado(s) del plan Básico.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro</button>
        </div>
      )}
      {userUsage.atLimit && (
        <div className="alert-danger text-xs">
          🔒 Has alcanzado el límite de {userUsage.limit} empleado del plan Básico. No puedes agregar más.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-400">
          {activeUsers.length} usuarios registrados
          {!userUsage.isUnlimited && (
            <span className="ml-2 text-slate-500">({userUsage.current} / {userUsage.limit} empleados en plan Básico)</span>
          )}
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap justify-end">
            <ExcelDataActions entity="users" rows={activeUsers.map(u => ({ ...u, password: '' }))} onImport={handleImportUsers} disabled={loading} />
            <button
              onClick={() => canAddUser ? setModal({ type: 'new' }) : setShowUpgrade(true)}
              className="btn-primary"
            >
              + Nuevo Empleado
            </button>
          </div>
        )}
      </div>

      {/* Tabla de usuarios activos */}
      <div className="table-container overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {['Usuario', 'Email', 'Rol', 'Estado', 'Permisos', 'Acciones'].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeUsers.map(u => (
              <tr key={u.id} className="table-row">
                <td className="table-cell">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-[#8b5cf6]/15 border border-[#8b5cf6]/20 flex items-center justify-center text-xs font-bold text-[#a78bfa] flex-shrink-0">
                      {(u.name || u.displayName || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-200 text-sm">{u.name || u.displayName}</div>
                      {u.id === currentUser?.id && <div className="text-xs text-[#00e5a0]">Tu cuenta</div>}
                    </div>
                  </div>
                </td>
                <td className="table-cell text-slate-400 text-xs">{u.email}</td>
                <td className="table-cell">
                  <span className={`badge ${ROLE_INFO[u.role]?.badge || 'badge-gray'}`}>{u.role}</span>
                </td>
                <td className="table-cell">
                  <span className={`badge ${u.active ? 'badge-green' : 'badge-red'}`}>
                    {u.active ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="table-cell">
                  {u.permissions
                    ? <span className="text-xs text-[#f59e0b]">Personalizados</span>
                    : <span className="text-xs text-slate-500">Por rol</span>}
                </td>
                <td className="table-cell">
                  {isAdmin && u.id !== currentUser?.id && (
                    <div className="flex gap-1">
                      <button onClick={() => setModal({ type: 'permissions', data: u })}
                        className="text-xs px-2.5 py-1 rounded-lg border border-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/10 transition-all">
                        Permisos
                      </button>
                      <button onClick={() => setModal({ type: 'edit', data: u })}
                        className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">
                        Rol
                      </button>
                      <button onClick={() => setModal({ type: 'delete', data: u })}
                        className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                        Eliminar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {activeUsers.length === 0 && (
              <tr><td colSpan={6} className="table-cell text-center text-slate-500 py-10">No hay usuarios registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Usuarios bloqueados por plan */}
      {lockedUsers.length > 0 && (
        <div className="card p-4 border-[#f59e0b]/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[#f59e0b]">🔒</span>
              <span className="text-sm font-semibold text-[#f59e0b]">
                {lockedUsers.length} empleado(s) bloqueado(s) — Plan Básico
              </span>
            </div>
            <button onClick={() => setShowUpgrade(true)} className="text-xs text-[#00e5a0] hover:underline">
              Actualizar a Pro →
            </button>
          </div>
          <div className="space-y-2">
            {lockedUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/10 opacity-60">
                <div className="w-7 h-7 rounded-full bg-[#f59e0b]/20 flex items-center justify-center text-xs font-bold text-[#f59e0b]">
                  {(u.name || u.displayName || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-400">{u.name || u.displayName}</div>
                  <div className="text-xs text-slate-500">{u.email} · {u.role}</div>
                </div>
                <span className="text-xs text-[#f59e0b]">🔒 Bloqueado</span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Estos usuarios no pueden iniciar sesión. Actualiza a Pro para reactivarlos todos.
          </div>
        </div>
      )}

      {/* Modals */}
      {modal?.type === 'new' && (
        <AddEmployeeModal onClose={() => setModal(null)} onSave={handleAddEmployee} loading={loading} />
      )}
      {modal?.type === 'edit' && (
        <EditRoleModal user={modal.data} onClose={() => setModal(null)} onSave={handleUpdateRole} loading={loading} />
      )}
      {modal?.type === 'permissions' && (
        <PermissionsModal user={modal.data} onClose={() => setModal(null)} onSave={handleSavePermissions} loading={loading} />
      )}
      {modal?.type === 'delete' && (
        <Modal title="Eliminar Usuario" onClose={() => setModal(null)} size="sm">
          <div className="bg-red-400/10 border border-red-400/20 text-red-300 text-sm rounded-lg p-3 mb-4">
            Eliminar a <strong>{modal.data.name || modal.data.displayName}</strong>? Esta accion no se puede deshacer.
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn-danger" disabled={loading} onClick={() => handleDelete(modal.data)}>
              {loading ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}

function PermissionsModal({ user, onClose, onSave, loading }) {
  const [perms, setPerms] = useState(user.permissions || defaultPermissions(user.role))
  const toggle = (key) => setPerms(p => ({ ...p, [key]: !p[key] }))
  const resetToRole = () => setPerms(defaultPermissions(user.role))
  return (
    <Modal title={`Permisos: ${user.name || user.displayName}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">Rol base: <span className="font-semibold text-slate-200">{user.role}</span></div>
          <button onClick={resetToRole} className="text-xs text-[#00c4e8] hover:underline">Restablecer a permisos del rol</button>
        </div>
        {PERMISSION_GROUPS.map(group => (
          <div key={group.label} className="space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">{group.label}</div>
            <div className="grid grid-cols-2 gap-2">
              {group.items.map(item => (
                <button key={item.key} onClick={() => toggle(item.key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all ${
                    perms[item.key]
                      ? 'bg-[#00e5a0]/10 border-[#00e5a0]/30 text-[#00e5a0]'
                      : 'bg-[#101c35] border-white/10 text-slate-400 hover:border-white/20'
                  }`}>
                  <span className="text-base">{perms[item.key] ? '✓' : '○'}</span>
                  <span className="text-xs font-semibold">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="alert-info text-xs">Los permisos personalizados reemplazan los del rol.</div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={loading} onClick={() => onSave(user, perms)}>
            {loading ? 'Guardando...' : 'Guardar Permisos'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function AddEmployeeModal({ onClose, onSave, loading }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'Cajero' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal title="Agregar Empleado" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div><label className="label">Nombre completo *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
        <div><label className="label">Correo electronico *</label>
          <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        <div><label className="label">Contrasena temporal *</label>
          <input className="input" type="password" minLength={8} maxLength={128} placeholder="Min. 8 caracteres" value={form.password} onChange={e => set('password', e.target.value)} /></div>
        <div>
          <label className="label">Rol</label>
          <select className="select" value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="Cajero">Cajero — Ventas y recargas</option>
            <option value="Encargado">Encargado — Ventas, inventario, reportes</option>
          </select>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={loading} onClick={() => {
            if (!form.name || !form.email || !form.password) return toast.error('Completa todos los campos')
            if (form.password.length < 8) return toast.error('Contraseña mínimo 8 caracteres')
            onSave(form)
          }}>
            {loading ? 'Creando...' : 'Crear Empleado'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function EditRoleModal({ user, onClose, onSave, loading }) {
  const [role, setRole] = useState(user.role)
  return (
    <Modal title={`Editar Rol: ${user.name || user.displayName}`} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="label">Nuevo rol</label>
          <select className="select" value={role} onChange={e => setRole(e.target.value)}>
            <option value="Cajero">Cajero</option>
            <option value="Encargado">Encargado</option>
            <option value="Administrador">Administrador</option>
          </select>
        </div>
        {role === 'Administrador' && (
          <div className="alert-warning text-xs">Este usuario tendra acceso total al sistema.</div>
        )}
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={loading} onClick={() => onSave({ ...user, role })}>
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
