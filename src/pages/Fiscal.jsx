import React, { useMemo, useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { FISCAL_TYPE_OPTIONS, fiscalConfigFromSettings, fiscalTypeLabel, sequenceRemaining, isSequenceExpired } from '../utils/fiscalHelpers'
import { saveFiscalConfig, saveNCFSequence, deleteNCFSequence } from '../services/fiscalService'
import toast from 'react-hot-toast'

const emptySeq = { typeCode: 'B02', prefix: 'B02', startNumber: 1, endNumber: 100, nextNumber: 1, expiresAt: '', active: true, alertThreshold: 10 }

export default function Fiscal() {
  const { state, dispatch } = useApp()
  const isAdmin = state.currentUser?.role === 'Administrador'
  const baseConfig = useMemo(() => ({ ...fiscalConfigFromSettings(state.settings), ...(state.fiscalConfig || {}) }), [state.settings, state.fiscalConfig])
  const [config, setConfig] = useState(baseConfig)
  const [seq, setSeq] = useState(emptySeq)
  const [editingId, setEditingId] = useState(null)

  if (!isAdmin) {
    return (
      <div className="card p-6 max-w-2xl">
        <div className="text-xl font-display font-bold text-slate-100 mb-2">Módulo Fiscal</div>
        <p className="text-sm text-slate-400">Solo el administrador puede configurar datos fiscales y secuencias NCF.</p>
      </div>
    )
  }

  const saveConfig = async () => {
    if (!config.businessName || !config.rnc) return toast.error('Completa nombre comercial y RNC')
    const payload = { ...config, enabled: !!config.enabled }
    dispatch({ type: 'UPDATE_FISCAL_CONFIG', payload })
    dispatch({ type: 'UPDATE_SETTINGS', payload: {
      businessName: payload.businessName,
      legalName: payload.legalName,
      rnc: payload.rnc,
      address: payload.address,
      phone: payload.phone,
      email: payload.email,
      fiscalRegime: payload.fiscalRegime,
      fiscalEnabled: payload.enabled,
    }})
    try { await saveFiscalConfig(state.businessId, payload) } catch {}
    toast.success('Configuración fiscal guardada')
  }

  const resetSeq = () => { setSeq(emptySeq); setEditingId(null) }

  const saveSeq = async () => {
    if (!seq.typeCode || !seq.prefix) return toast.error('Selecciona tipo y prefijo')
    const startNumber = Number(seq.startNumber || 1)
    const endNumber = Number(seq.endNumber || 1)
    const nextNumber = Number(seq.nextNumber || startNumber)
    if (endNumber < startNumber) return toast.error('Número final debe ser mayor o igual al inicial')
    if (nextNumber < startNumber || nextNumber > endNumber) return toast.error('Próximo número fuera del rango')
    const type = FISCAL_TYPE_OPTIONS.find(t => t.code === seq.typeCode)
    const payload = {
      ...seq,
      id: editingId || seq.id || `${seq.typeCode}_${Date.now()}`,
      label: type?.label || seq.typeCode,
      startNumber, endNumber, nextNumber,
      alertThreshold: Number(seq.alertThreshold || 10),
      active: seq.active !== false,
    }
    dispatch({ type: editingId ? 'UPDATE_NCF_SEQUENCE' : 'ADD_NCF_SEQUENCE', payload })
    try { await saveNCFSequence(state.businessId, payload) } catch {}
    resetSeq()
    toast.success('Secuencia NCF guardada')
  }

  const editSeq = (s) => { setSeq({ ...s }); setEditingId(s.id) }
  const removeSeq = async (s) => {
    if (!confirm(`¿Eliminar secuencia ${s.label || s.typeCode}?`)) return
    dispatch({ type: 'DELETE_NCF_SEQUENCE', payload: s.id })
    try { await deleteNCFSequence(state.businessId, s.id) } catch {}
    toast.success('Secuencia eliminada')
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold text-slate-100">Facturación Fiscal RD</h1>
        <p className="text-sm text-slate-500">Configura datos fiscales y rangos NCF autorizados por DGII.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <div className="section-title">Datos fiscales del negocio</div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={!!config.enabled} onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))} />
            Activar módulo fiscal en el POS
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" placeholder="Nombre comercial" value={config.businessName || ''} onChange={e => setConfig(c => ({ ...c, businessName: e.target.value }))} />
            <input className="input" placeholder="Razón social" value={config.legalName || ''} onChange={e => setConfig(c => ({ ...c, legalName: e.target.value }))} />
            <input className="input" placeholder="RNC del negocio" value={config.rnc || ''} onChange={e => setConfig(c => ({ ...c, rnc: e.target.value }))} />
            <input className="input" placeholder="Régimen fiscal" value={config.fiscalRegime || ''} onChange={e => setConfig(c => ({ ...c, fiscalRegime: e.target.value }))} />
            <input className="input" placeholder="Teléfono" value={config.phone || ''} onChange={e => setConfig(c => ({ ...c, phone: e.target.value }))} />
            <input className="input" placeholder="Email" value={config.email || ''} onChange={e => setConfig(c => ({ ...c, email: e.target.value }))} />
            <input className="input md:col-span-2" placeholder="Dirección" value={config.address || ''} onChange={e => setConfig(c => ({ ...c, address: e.target.value }))} />
          </div>
          <button onClick={saveConfig} className="btn-primary text-sm">Guardar datos fiscales</button>
          <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            Nota: este módulo ayuda a emitir comprobantes, pero debe ser validado por tu contador antes de usarlo formalmente ante DGII.
          </div>
        </div>

        <div className="card p-5 space-y-3">
          <div className="section-title">Crear / editar secuencia NCF</div>
          <select className="select" value={seq.typeCode} onChange={e => setSeq(s => ({ ...s, typeCode: e.target.value, prefix: e.target.value }))}>
            {FISCAL_TYPE_OPTIONS.map(t => <option key={t.code} value={t.code}>{t.code} — {t.label}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="Prefijo" value={seq.prefix || ''} onChange={e => setSeq(s => ({ ...s, prefix: e.target.value.toUpperCase() }))} />
            <input className="input" type="date" value={seq.expiresAt || ''} onChange={e => setSeq(s => ({ ...s, expiresAt: e.target.value }))} />
            <input className="input" type="number" placeholder="Número inicial" value={seq.startNumber || ''} onChange={e => setSeq(s => ({ ...s, startNumber: e.target.value }))} />
            <input className="input" type="number" placeholder="Número final" value={seq.endNumber || ''} onChange={e => setSeq(s => ({ ...s, endNumber: e.target.value }))} />
            <input className="input" type="number" placeholder="Próximo número" value={seq.nextNumber || ''} onChange={e => setSeq(s => ({ ...s, nextNumber: e.target.value }))} />
            <input className="input" type="number" placeholder="Alerta mínimo" value={seq.alertThreshold || ''} onChange={e => setSeq(s => ({ ...s, alertThreshold: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={seq.active !== false} onChange={e => setSeq(s => ({ ...s, active: e.target.checked }))} />
            Secuencia activa
          </label>
          <div className="flex gap-2">
            <button onClick={saveSeq} className="btn-primary text-sm">{editingId ? 'Actualizar secuencia' : 'Guardar secuencia'}</button>
            {editingId && <button onClick={resetSeq} className="btn-secondary text-sm">Cancelar</button>}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="section-title mb-3">Secuencias registradas</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-white/10">
              <tr><th className="text-left py-2">Tipo</th><th className="text-left">Rango</th><th className="text-left">Próximo</th><th className="text-left">Vence</th><th className="text-left">Restantes</th><th className="text-left">Estado</th><th></th></tr>
            </thead>
            <tbody>
              {state.ncfSequences.map(s => {
                const rem = sequenceRemaining(s)
                const warn = rem <= Number(s.alertThreshold || 10)
                const expired = isSequenceExpired(s)
                return <tr key={s.id} className="border-b border-white/5 text-slate-300">
                  <td className="py-2 font-mono">{s.typeCode} <span className="text-slate-500 font-sans">{fiscalTypeLabel(s.typeCode)}</span></td>
                  <td>{s.prefix}{String(s.startNumber).padStart(8,'0')} → {s.prefix}{String(s.endNumber).padStart(8,'0')}</td>
                  <td className="font-mono">{s.prefix}{String(s.nextNumber).padStart(8,'0')}</td>
                  <td>{s.expiresAt || '—'}</td>
                  <td className={warn ? 'text-amber-400 font-bold' : ''}>{rem}</td>
                  <td>{s.active === false ? <span className="badge badge-gray">Inactiva</span> : expired ? <span className="badge badge-red">Vencida</span> : rem <= 0 ? <span className="badge badge-red">Agotada</span> : <span className="badge badge-green">Activa</span>}</td>
                  <td className="text-right space-x-2"><button onClick={() => editSeq(s)} className="text-[#00e5a0] text-xs">Editar</button><button onClick={() => removeSeq(s)} className="text-red-400 text-xs">Eliminar</button></td>
                </tr>
              })}
              {state.ncfSequences.length === 0 && <tr><td colSpan="7" className="py-8 text-center text-slate-500">No hay secuencias NCF configuradas</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
