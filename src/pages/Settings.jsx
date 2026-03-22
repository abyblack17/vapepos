import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import { uploadBusinessLogo } from '../services/storageService'
import { saveBusinessSettings, bizGetAll, bizDelete, bizSet } from '../services/firestoreService'
import { usePlan } from '../hooks/usePlan'
import UpgradeModal from '../components/ui/UpgradeModal'
import toast from 'react-hot-toast'

export default function Settings() {
  const { state, dispatch } = useApp()
  const { businessId }      = useAuth()
  const { hasFeature }      = usePlan()
  const [settings, setSettings]             = useState({ ...state.settings })
  const [uploading, setUploading]           = useState(false)
  const [showUpgrade, setShowUpgrade]       = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteText, setDeleteText]         = useState('')
  const [deleting, setDeleting]             = useState(false)
  const [restoring, setRestoring]           = useState(false)
  const [restorePreview, setRestorePreview] = useState(null)

  const set       = (k, v) => setSettings(s => ({ ...s, [k]: v }))
  const canBackup = hasFeature('exportBackup')

  const handleSave = (section) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings })
    saveBusinessSettings(businessId, settings).catch(() => {})
    toast.success(`Configuración de ${section} guardada`)
  }

  const handleBackup = async () => {
    if (!canBackup) { setShowUpgrade(true); return }
    toast.loading('Generando backup...')
    try {
      const collections = ['products', 'liquids', 'customers', 'suppliers', 'sales', 'purchases', 'cash_sessions', 'users']
      const backup = { businessId, exportedAt: new Date().toISOString(), settings: state.settings }
      for (const col of collections) {
        backup[col] = await bizGetAll(businessId, col)
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `VapePOS-Backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.dismiss()
      toast.success('Backup descargado exitosamente')
    } catch {
      toast.dismiss()
      toast.error('Error al generar backup')
    }
  }

  const handleRestoreFile = (e) => {
    if (!canBackup) { setShowUpgrade(true); return }
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.businessId) { toast.error('Archivo de backup invalido'); return }
        setRestorePreview(data)
      } catch {
        toast.error('Error al leer el archivo — asegurate de que sea un backup de VapePOS')
      }
    }
    reader.readAsText(file)
  }

  const handleRestore = async () => {
    if (!restorePreview) return
    setRestoring(true)
    toast.loading('Restaurando datos...')
    try {
      const collections = ['products', 'liquids', 'customers', 'suppliers', 'purchases']
      for (const col of collections) {
        if (!restorePreview[col]?.length) continue
        for (const doc of restorePreview[col]) {
          const { id, ...data } = doc
          if (id) await bizSet(businessId, col, id, data)
        }
      }
      if (restorePreview.settings) {
        dispatch({ type: 'UPDATE_SETTINGS', payload: restorePreview.settings })
      }
      toast.dismiss()
      toast.success('Restauracion completada')
      setRestorePreview(null)
      setTimeout(() => window.location.reload(), 1500)
    } catch {
      toast.dismiss()
      toast.error('Error durante la restauracion')
    }
    setRestoring(false)
  }

  const handleDeleteStore = async () => {
    if (deleteText !== state.settings?.businessName) { toast.error('El nombre no coincide'); return }
    setDeleting(true)
    try {
      const collections = ['products', 'liquids', 'customers', 'suppliers', 'sales', 'purchases', 'cash_sessions', 'users', 'suggestions']
      for (const col of collections) {
        const docs = await bizGetAll(businessId, col)
        for (const doc of docs) await bizDelete(businessId, col, doc.id)
      }
      toast.success('Tienda eliminada. Cerrando sesion...')
      setTimeout(() => window.location.reload(), 2000)
    } catch {
      toast.error('Error al eliminar tienda')
      setDeleting(false)
    }
  }

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('La imagen no puede superar 2MB'); return }
    setUploading(true)
    const url = await uploadBusinessLogo(businessId, file)
    if (url) {
      set('logoUrl', url)
      dispatch({ type: 'UPDATE_SETTINGS', payload: { ...settings, logoUrl: url } })
      toast.success('Logo actualizado')
    } else {
      toast.error('Error al subir el logo')
    }
    setUploading(false)
  }

  const expectedPerBottle = settings.defaultBottleCapacity
    ? Math.floor(settings.defaultBottleCapacity / (settings.defaultPointsR100 || 20))
    : 0

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">

      {/* ── Negocio ── */}
      <div className="card p-6">
        <div className="font-display font-bold text-slate-100 mb-5">🏪 Negocio</div>
        <div className="mb-5">
          <label className="label">Logo del negocio</label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border border-white/10 bg-[#101c35] flex items-center justify-center overflow-hidden flex-shrink-0">
              {settings.logoUrl
                ? <img src={settings.logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
                : <span className="text-3xl">🏪</span>}
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer btn-secondary text-xs py-1.5 px-3">
                <span>{uploading ? 'Subiendo...' : 'Cambiar Logo'}</span>
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
                  onChange={handleLogoUpload} disabled={uploading} />
              </label>
              <div className="text-xs text-slate-500">PNG, JPG, SVG o WebP. Max 2MB.</div>
              <div className="text-xs text-slate-500">El logo aparece en las facturas impresas.</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">Nombre del negocio</label><input className="input" value={settings.businessName || ''} onChange={e => set('businessName', e.target.value)} /></div>
          <div><label className="label">Teléfono</label><input className="input" value={settings.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Dirección</label><input className="input" value={settings.address || ''} onChange={e => set('address', e.target.value)} /></div>
          <div>
            <label className="label">Moneda</label>
            <select className="select" value={settings.currency || 'RD$'} onChange={e => set('currency', e.target.value)}>
              <option>RD$</option><option>USD</option>
            </select>
          </div>
          <div><label className="label">ITBIS / Impuesto (%)</label><input className="input" type="number" value={settings.taxRate || 18} onChange={e => set('taxRate', parseFloat(e.target.value))} /></div>
        </div>
        <button className="btn-primary mt-4 text-sm" onClick={() => handleSave('negocio')}>Guardar</button>
      </div>

      {/* ── Recargas ── */}
      <div className="card p-6">
        <div className="font-display font-bold text-slate-100 mb-2">💧 Configuración de Recargas</div>
        <div className="alert-info text-xs mb-5">
          Define los valores por defecto del sistema de puntos. Estos valores se aplican a nuevos líquidos.
          Los líquidos existentes pueden tener su propio ajuste individual.
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Capacidad por botella (puntos)</label>
            <input className="input" type="number" value={settings.defaultBottleCapacity || 100} onChange={e => set('defaultBottleCapacity', parseInt(e.target.value))} />
            <div className="text-xs text-slate-500 mt-1">Puntos totales de una botella nueva</div>
          </div>
          <div className="bg-[#101c35] rounded-xl p-4 flex items-center">
            <div>
              <div className="text-xs text-slate-400 mb-0.5">Con estos valores, cada botella rinde:</div>
              <div className="font-display font-bold text-[#00e5a0] text-xl">{expectedPerBottle} recargas</div>
              <div className="text-xs text-slate-500">de RD$100</div>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          {[
            { key: 'defaultPointsR50',  label: 'Puntos por recarga RD$50'  },
            { key: 'defaultPointsR100', label: 'Puntos por recarga RD$100' },
            { key: 'defaultPointsR150', label: 'Puntos por recarga RD$150' },
          ].map(f => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input className="input font-mono" type="number" value={settings[f.key] || 0} onChange={e => set(f.key, parseInt(e.target.value))} />
            </div>
          ))}
        </div>
        <button className="btn-primary mt-5 text-sm" onClick={() => handleSave('recargas')}>Guardar Configuración de Recargas</button>
      </div>

      {/* ── Alertas ── */}
      <div className="card p-6">
        <div className="font-display font-bold text-slate-100 mb-5">🔔 Alertas</div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Stock mínimo por defecto</label>
            <input className="input" type="number" value={settings.lowStockThreshold || 5} onChange={e => set('lowStockThreshold', parseInt(e.target.value))} />
          </div>
          <div>
            <label className="label">Alerta botella activa (% restante)</label>
            <input className="input" type="number" value={settings.lowBottleAlert || 15} onChange={e => set('lowBottleAlert', parseInt(e.target.value))} />
            <div className="text-xs text-slate-500 mt-1">Alerta cuando la botella esté por debajo de este %</div>
          </div>
        </div>
        <button className="btn-primary mt-4 text-sm" onClick={() => handleSave('alertas')}>Guardar</button>
      </div>

      {/* ── Factura ── */}
      <div className="card p-6">
        <div className="font-display font-bold text-slate-100 mb-5">🧾 Factura</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Prefijo de recibos</label>
            <input className="input font-mono uppercase" maxLength={5}
              value={settings.invoicePrefix || 'VPS'}
              onChange={e => set('invoicePrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="VPS" />
            <div className="text-xs text-slate-500 mt-1">
              Tus recibos: {(settings.invoicePrefix || 'VPS')}-001, {(settings.invoicePrefix || 'VPS')}-002...
            </div>
          </div>
          <div><label className="label">Encabezado</label><input className="input" value={settings.invoiceHeader || ''} onChange={e => set('invoiceHeader', e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Pie de pagina</label><input className="input" value={settings.invoiceFooter || ''} onChange={e => set('invoiceFooter', e.target.value)} /></div>
        </div>
        <button className="btn-primary mt-4 text-sm" onClick={() => handleSave('factura')}>Guardar</button>
      </div>

      {/* ── Impresora ── */}
      <div className="card p-6">
        <div className="font-display font-bold text-slate-100 mb-2">🖨️ Impresora</div>
        <div className="alert-info text-xs mb-5">
          Configura el formato del ticket segun tu impresora. Compatible con impresoras termicas USB y Bluetooth.
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tamano de papel</label>
            <select className="select" value={settings.paperSize || '80mm'} onChange={e => set('paperSize', e.target.value)}>
              <option value="58mm">58mm — Impresora pequeña / portatil</option>
              <option value="80mm">80mm — Impresora de mostrador / restaurante</option>
            </select>
          </div>
          <div>
            <label className="label">Copias por venta</label>
            <select className="select" value={settings.printCopies || '1'} onChange={e => set('printCopies', e.target.value)}>
              <option value="1">1 copia</option>
              <option value="2">2 copias</option>
              <option value="3">3 copias</option>
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mostrar en el ticket</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { key: 'printLogo',    label: 'Logo del negocio'         },
              { key: 'printAddress', label: 'Direccion del negocio'    },
              { key: 'printPhone',   label: 'Telefono del negocio'     },
              { key: 'printTax',     label: 'ITBIS desglosado'         },
              { key: 'printProfit',  label: 'Ganancia (solo admin)'    },
              { key: 'printQR',      label: 'Codigo QR (proximamente)' },
            ].map(opt => (
              <label key={opt.key} className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5 transition-all">
                <input type="checkbox"
                  checked={settings[opt.key] !== false}
                  onChange={e => set(opt.key, e.target.checked)}
                  className="w-4 h-4 rounded accent-[#00e5a0]" />
                <span className="text-sm text-slate-300">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Vista previa del ticket</div>
          <div className="bg-white text-black rounded-lg p-4 font-mono text-xs max-w-[200px] mx-auto">
            <div className="text-center font-bold text-sm">{settings.businessName || 'Mi Tienda'}</div>
            {settings.printAddress !== false && settings.address && <div className="text-center text-xs text-gray-600">{settings.address}</div>}
            {settings.printPhone !== false && settings.phone && <div className="text-center text-xs text-gray-600">Tel: {settings.phone}</div>}
            <div className="border-t border-dashed border-gray-400 my-1" />
            <div className="flex justify-between"><span>Articulo x1</span><span>RD$100</span></div>
            <div className="flex justify-between"><span>Articulo x2</span><span>RD$200</span></div>
            <div className="border-t border-dashed border-gray-400 my-1" />
            {settings.printTax !== false && <div className="flex justify-between text-gray-600"><span>ITBIS 18%</span><span>RD$54</span></div>}
            <div className="flex justify-between font-bold"><span>TOTAL</span><span>RD$354</span></div>
            <div className="border-t border-dashed border-gray-400 my-1" />
            <div className="text-center text-xs text-gray-500">{settings.invoiceFooter || '¡Gracias!'}</div>
          </div>
          <div className="text-xs text-slate-500 text-center mt-2">
            Ancho: {settings.paperSize || '80mm'} · {settings.printCopies || 1} copia(s)
          </div>
        </div>
        <button className="btn-primary mt-4 text-sm" onClick={() => handleSave('impresora')}>Guardar Configuracion de Impresora</button>
      </div>

      {/* ── Backup y Datos ── */}
      <div className="card p-6">
        <div className="font-display font-bold text-slate-100 mb-2">💾 Datos de la Tienda</div>
        <div className="alert-info text-xs mb-5">
          Descarga una copia de seguridad completa de todos tus datos o elimina la tienda permanentemente.
        </div>
        <div className="space-y-4">

          {/* Backup */}
          <div className="bg-[#101c35] rounded-xl p-4 flex items-center gap-4">
            <div className="text-3xl">{canBackup ? '📦' : '🔒'}</div>
            <div className="flex-1">
              <div className="font-semibold text-slate-200 text-sm">Backup completo</div>
              <div className="text-xs text-slate-500">
                {canBackup
                  ? 'Descarga todos tus productos, ventas, clientes y configuracion en un archivo JSON'
                  : 'La copia de seguridad es exclusiva del plan Pro'}
              </div>
            </div>
            {canBackup ? (
              <button onClick={handleBackup} className="btn-primary text-xs whitespace-nowrap">
                Descargar Backup
              </button>
            ) : (
              <button onClick={() => setShowUpgrade(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-all whitespace-nowrap">
                🔒 Plan Pro
              </button>
            )}
          </div>

          {/* Restore */}
          <div className="bg-[#101c35] rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">{canBackup ? '📂' : '🔒'}</div>
              <div className="flex-1">
                <div className="font-semibold text-slate-200 text-sm">Restaurar desde backup</div>
                <div className="text-xs text-slate-500">
                  {canBackup
                    ? 'Importa un archivo de backup previamente descargado'
                    : 'La restauracion desde backup es exclusiva del plan Pro'}
                </div>
              </div>
              {canBackup ? (
                <label className="btn-secondary text-xs cursor-pointer whitespace-nowrap">
                  Seleccionar archivo
                  <input type="file" accept=".json" className="hidden" onChange={handleRestoreFile} />
                </label>
              ) : (
                <button onClick={() => setShowUpgrade(true)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/20 transition-all whitespace-nowrap">
                  🔒 Plan Pro
                </button>
              )}
            </div>
            {restorePreview && canBackup && (
              <div className="space-y-3 border-t border-white/10 pt-3">
                <div className="text-xs text-slate-400">
                  Archivo: <span className="text-[#00e5a0] font-mono">backup del {restorePreview.exportedAt?.split('T')[0]}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {['products','liquids','customers','sales'].map(col => (
                    <div key={col} className="bg-[#1a2848] rounded-lg p-2 text-center">
                      <div className="font-bold text-slate-200">{restorePreview[col]?.length || 0}</div>
                      <div className="text-slate-500 capitalize">{col}</div>
                    </div>
                  ))}
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs rounded-lg p-3">
                  ⚠️ Esto agregara los datos del backup a tu tienda actual. No elimina datos existentes.
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setRestorePreview(null)} className="btn-secondary text-xs flex-1">Cancelar</button>
                  <button onClick={handleRestore} disabled={restoring} className="btn-primary text-xs flex-1">
                    {restoring ? 'Restaurando...' : 'Confirmar Restauracion'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Delete store */}
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">⚠️</div>
              <div>
                <div className="font-semibold text-red-400 text-sm">Eliminar tienda permanentemente</div>
                <div className="text-xs text-slate-500">Esta accion no se puede deshacer. Se eliminaran todos los datos.</div>
              </div>
            </div>
            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)} className="btn-danger text-xs">
                Eliminar Tienda
              </button>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-red-400">
                  Escribe el nombre de tu tienda para confirmar: <strong>{state.settings?.businessName}</strong>
                </div>
                <input className="input text-sm border-red-500/30" placeholder="Nombre de la tienda..."
                  value={deleteText} onChange={e => setDeleteText(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={() => { setShowDeleteConfirm(false); setDeleteText('') }}
                    className="btn-secondary text-xs flex-1">Cancelar</button>
                  <button onClick={handleDeleteStore} disabled={deleting || deleteText !== state.settings?.businessName}
                    className="btn-danger text-xs flex-1">
                    {deleting ? 'Eliminando...' : 'Confirmar Eliminacion'}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}
