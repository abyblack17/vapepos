import React, { useEffect, useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import { uploadBusinessLogo } from '../services/storageService'
import { isBluetoothPrinterSupported, requestBluetoothPrinter, printBluetoothTest, requestAppPermissions } from '../services/bluetoothPrinterService'
import { saveBusinessSettings, bizGetAll, bizDelete, bizSet } from '../services/firestoreService'
import { usePlan } from '../hooks/usePlan'
import UpgradeModal from '../components/ui/UpgradeModal'
import toast from 'react-hot-toast'
import { DEFAULT_REFILL_BUTTONS } from '../services/liquidService'
import { canDo } from '../utils/helpers'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

export default function Settings() {
  const { state, dispatch } = useApp()
  const { businessId, currentUser, logout } = useAuth()
  const { hasFeature }      = usePlan()
  const [settings, setSettings]             = useState({ ...state.settings })
  const [uploading, setUploading]           = useState(false)
  const [showUpgrade, setShowUpgrade]       = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteText, setDeleteText]         = useState('')
  const [deleting, setDeleting]             = useState(false)
  const [restoring, setRestoring]           = useState(false)
  const [restorePreview, setRestorePreview] = useState(null)
  const [pairingPrinter, setPairingPrinter] = useState(false)
  const [testingPrinter, setTestingPrinter] = useState(false)
  const [requestingPermissions, setRequestingPermissions] = useState(false)
  const [claimingAdmin, setClaimingAdmin] = useState(false)
  const [generatingDemo, setGeneratingDemo] = useState(false)

  useEffect(() => {
    setSettings({ ...state.settings })
  }, [state.branchId, state.settings])

  const set       = (k, v) => setSettings(s => ({ ...s, [k]: v }))
  const canBackup = hasFeature('exportBackup')
  const refillButtons = Array.isArray(settings.refillButtons) && settings.refillButtons.length
    ? settings.refillButtons.slice(0, 5)
    : DEFAULT_REFILL_BUTTONS
  const setRefillButton = (index, patch) => setSettings(s => ({
    ...s,
    refillButtons: refillButtons.map((btn, i) => i === index ? { ...btn, ...patch } : btn).slice(0, 5),
  }))
  const addRefillButton = () => {
    if (refillButtons.length >= 5) return toast.error('Máximo 5 botones de recarga')
    setSettings(s => ({
      ...s,
      refillButtons: [...refillButtons, { id: `r${Date.now()}`, price: '', points: '', active: true }],
    }))
  }
  const deleteRefillButton = (index) => {
    if (refillButtons.length <= 1) return toast.error('Debe existir al menos un botón de recarga')
    setSettings(s => ({ ...s, refillButtons: refillButtons.filter((_, i) => i !== index) }))
  }

  const handleSave = (section) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings })
    saveBusinessSettings(businessId, settings, state.branchId).catch(() => {})
    toast.success(`Configuración de ${section} guardada`)
  }


  const persistSettings = async (nextSettings, section) => {
    setSettings(nextSettings)
    dispatch({ type: 'UPDATE_SETTINGS', payload: nextSettings })
    await saveBusinessSettings(businessId, nextSettings, state.branchId)
    if (section) toast.success(`Configuración de ${section} guardada`)
  }


  const handleRequestAppPermissions = async () => {
    setRequestingPermissions(true)
    toast.loading('Solicitando permisos del dispositivo...')
    try {
      await requestAppPermissions()
      toast.dismiss()
      toast.success('Permisos solicitados correctamente')
    } catch (error) {
      toast.dismiss()
      toast.error(error?.message || 'No se pudieron solicitar los permisos')
    } finally {
      setRequestingPermissions(false)
    }
  }

  const handleAddBluetoothPrinter = async () => {
    if (!isBluetoothPrinterSupported()) {
      toast.error('Bluetooth no está disponible en este dispositivo.')
      return
    }

    setPairingPrinter(true)
    toast.loading('Buscando impresora Bluetooth...')
    try {
      const printer = await requestBluetoothPrinter()
      const nextSettings = {
        ...settings,
        bluetoothPrinter: {
          ...printer,
          paperSize: settings.paperSize || '58mm',
          addedAt: new Date().toISOString(),
        },
      }
      await persistSettings(nextSettings, null)
      toast.dismiss()
      toast.success(`Impresora agregada: ${printer.name}`)
    } catch (error) {
      toast.dismiss()
      toast.error(error?.message || 'No se pudo agregar la impresora')
    } finally {
      setPairingPrinter(false)
    }
  }

  const handleRemoveBluetoothPrinter = async () => {
    const nextSettings = { ...settings, bluetoothPrinter: null }
    await persistSettings(nextSettings, null)
    toast.success('Impresora eliminada de la configuración')
  }

  const handleTestBluetoothPrinter = async () => {
    setTestingPrinter(true)
    toast.loading('Enviando prueba a la impresora...')
    try {
      const printerName = await printBluetoothTest(settings)
      toast.dismiss()
      toast.success(`Prueba enviada a ${printerName}`)
    } catch (error) {
      toast.dismiss()
      toast.error(error?.message || 'No se pudo imprimir la prueba')
    } finally {
      setTestingPrinter(false)
    }
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
    if (file.size > 5 * 1024 * 1024) { toast.error('La imagen no puede superar 5MB'); return }
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

  const referenceButton = refillButtons.find(b => Number(b.price) === 100) || refillButtons[0] || { points: 20 }
  const expectedPerBottle = settings.defaultBottleCapacity
    ? Math.floor(Number(settings.defaultBottleCapacity || 0) / Number(referenceButton.points || 20))
    : 0

  const canManageBusiness = canDo(currentUser, 'settings')
  const hasActiveAdmin = (state.users || []).some(user =>
    user.active !== false && user.role === 'Administrador'
  )

  const handleClaimVacantAdmin = async () => {
    setClaimingAdmin(true)
    try {
      const claimAdmin = httpsCallable(functions, 'claimVacantAdmin')
      await claimAdmin()
      toast.success('Rol de Administrador restaurado')
      setTimeout(() => window.location.reload(), 800)
    } catch (error) {
      const message = error?.message || 'No se pudo restaurar el administrador'
      toast.error(message.includes('administrador activo') ? 'El negocio ya tiene un administrador activo' : message)
      setClaimingAdmin(false)
    }
  }

  const handleGenerateDemoMonth = async () => {
    setGeneratingDemo(true)
    try {
      const generateDemo = httpsCallable(functions, 'generateDemoMonth')
      const result = await generateDemo()
      toast.success(`${result.data?.created || 0} ventas ficticias generadas`)
      setTimeout(() => window.location.reload(), 1000)
    } catch (error) {
      const message = error?.message || 'No se pudieron generar las ventas ficticias'
      toast.error(message.includes('already-exists') || message.includes('ya fue generado') ? 'El mes demo ya fue generado anteriormente' : message)
      setGeneratingDemo(false)
    }
  }

  const accountPanel = (
    <div className="card p-6">
      <div className="font-display font-bold text-slate-100 mb-4">👤 Cuenta y sesión</div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#00e5a0] to-[#00c4e8] flex items-center justify-center font-bold text-[#080d18]">
          {(currentUser?.name || currentUser?.email || 'U')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-100">{currentUser?.name || 'Usuario'}</div>
          <div className="text-xs text-slate-500 truncate">{currentUser?.email || ''}</div>
          <div className="text-xs text-[#00e5a0] mt-1">{currentUser?.role || ''}</div>
        </div>
        <button onClick={logout} className="btn-danger text-sm whitespace-nowrap">
          ⏻ Cerrar sesión / Cambiar usuario
        </button>
      </div>
      <div className="text-xs text-slate-500 mt-3">
        Para entrar con otro usuario, cierra esta sesión y selecciona la otra cuenta en la pantalla de acceso.
      </div>
    </div>
  )

  if (!canManageBusiness) {
    return (
      <div className="space-y-5 animate-fade-in max-w-4xl">
        {accountPanel}
        <div className="alert-info text-xs">
          Los ajustes del negocio están disponibles únicamente para usuarios con permiso de configuración.
        </div>
        {!hasActiveAdmin && (
          <div className="card p-6">
            <div className="font-display font-bold text-slate-100 mb-2">Recuperar administración</div>
            <div className="text-xs text-slate-500 mb-4">
              Este negocio no tiene ningún administrador activo. Puedes restaurar este usuario como Administrador.
            </div>
            <button className="btn-primary text-sm" onClick={handleClaimVacantAdmin} disabled={claimingAdmin}>
              {claimingAdmin ? 'Comprobando...' : 'Restaurar como Administrador'}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-4xl">

      {accountPanel}

      {currentUser?.email?.toLowerCase() === 'test01@gmail.com' && (
        <div className="card p-6 border border-[#a78bfa]/20">
          <div className="font-display font-bold text-slate-100 mb-2">🧪 Datos de demostración</div>
          <div className="text-xs text-slate-500 mb-4">
            Genera 30 días completos de ventas ficticias coherentes para presentar las gráficas, reportes, clientes y recibos. Solo puede ejecutarse una vez.
          </div>
          <button className="btn-primary text-sm" onClick={handleGenerateDemoMonth} disabled={generatingDemo}>
            {generatingDemo ? 'Generando mes demo...' : 'Generar un mes de ventas demo'}
          </button>
        </div>
      )}

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
              <div className="text-xs text-slate-500">PNG, JPG, SVG o WebP. Max 5MB.</div>
              <div className="text-xs text-slate-500">El logo aparece en las facturas impresas.</div>
            </div>
          </div>
        </div>
        <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between rounded-xl border border-white/10 bg-[#101c35] p-3">
          <div>
            <div className="text-sm font-semibold text-slate-200">Permisos del dispositivo</div>
            <div className="text-xs text-slate-500">Bluetooth, cámara y permisos necesarios para funciones nativas.</div>
          </div>
          <button type="button" onClick={handleRequestAppPermissions} disabled={requestingPermissions} className="btn-secondary text-xs whitespace-nowrap">
            {requestingPermissions ? 'Solicitando...' : 'Solicitar permisos'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">Nombre del negocio</label><input className="input" value={settings.businessName || ''} onChange={e => set('businessName', e.target.value)} /></div>
          <div><label className="label">Teléfono</label><input className="input" value={settings.phone || ''} onChange={e => set('phone', e.target.value)} /></div>
          <div className="sm:col-span-2"><label className="label">Dirección</label><input className="input" value={settings.address || ''} onChange={e => set('address', e.target.value)} /></div>
          <div><label className="label">RNC / Cédula fiscal</label><input className="input font-mono" value={settings.rnc || ''} onChange={e => set('rnc', e.target.value)} placeholder="000-00000-0" /></div>
          <div><label className="label">Correo electrónico</label><input className="input" type="email" value={settings.email || ''} onChange={e => set('email', e.target.value)} placeholder="tienda@ejemplo.com" /></div>
          <div>
            <label className="label">Moneda</label>
            <select className="select" value={settings.currency || 'RD$'} onChange={e => set('currency', e.target.value)}>
              <option>RD$</option><option>USD</option>
            </select>
          </div>
          <div>
            <label className="label">ITBIS / Impuesto</label>
            <select className="select" value={settings.taxRate ?? 18} onChange={e => set('taxRate', Number(e.target.value))}>
              <option value={18}>ITBIS 18%</option>
              <option value={0}>Sin ITBIS (0%)</option>
            </select>
            <div className="text-xs text-slate-500 mt-1">Se aplicará a todas las ventas nuevas del negocio.</div>
          </div>
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
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Botones de recarga</div>
              <div className="text-xs text-slate-500">Configura hasta 5 botones. Precio = lo que cobra; puntos = lo que consume de la botella.</div>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={addRefillButton} disabled={refillButtons.length >= 5}>+ Agregar</button>
          </div>
          <div className="space-y-2">
            {refillButtons.map((btn, index) => (
              <div key={btn.id || index} className="grid grid-cols-12 gap-2 items-end bg-[#101c35] border border-white/5 rounded-xl p-3">
                <div className="col-span-5">
                  <label className="label">Precio RD$</label>
                  <input className="input font-mono" type="number" min="1" value={btn.price ?? ''} onChange={e => setRefillButton(index, { price: e.target.value })} />
                </div>
                <div className="col-span-5">
                  <label className="label">Puntos que consume</label>
                  <input className="input font-mono" type="number" min="1" value={btn.points ?? ''} onChange={e => setRefillButton(index, { points: e.target.value })} />
                </div>
                <button type="button" className="col-span-2 btn-danger text-xs py-2" onClick={() => deleteRefillButton(index)}>Borrar</button>
              </div>
            ))}
          </div>
        </div>
        <button className="btn-primary mt-5 text-sm" onClick={() => {
          const cleanButtons = refillButtons
            .slice(0, 5)
            .map((b, i) => ({ id: b.id || `r${i}_${Date.now()}`, price: Number(b.price), points: Number(b.points), active: true }))
            .filter(b => b.price > 0 && b.points > 0)
          if (!cleanButtons.length) return toast.error('Crea al menos un botón válido')
          const nextSettings = {
            ...settings,
            refillButtons: cleanButtons,
            defaultPointsR50: cleanButtons.find(b => b.price === 50)?.points || settings.defaultPointsR50 || 10,
            defaultPointsR100: cleanButtons.find(b => b.price === 100)?.points || settings.defaultPointsR100 || 20,
            defaultPointsR150: cleanButtons.find(b => b.price === 150)?.points || settings.defaultPointsR150 || 30,
          }
          setSettings(nextSettings)
          dispatch({ type: 'UPDATE_SETTINGS', payload: nextSettings })
          saveBusinessSettings(businessId, nextSettings).catch(() => {})
          toast.success('Configuración de recargas guardada')
        }}>Guardar Configuración de Recargas</button>
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
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="font-display font-bold text-slate-100">🖨️ Impresora</div>
            <div className="text-xs text-slate-500 mt-1">Agrega una impresora Bluetooth y define el formato del ticket.</div>
          </div>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${settings.bluetoothPrinter?.id ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-slate-500/10 border-white/10 text-slate-400'}`}>
            {settings.bluetoothPrinter?.id ? 'Configurada' : 'Sin impresora'}
          </span>
        </div>
        <div className="alert-info text-xs mb-5">
          En Android/Capacitor la app usa Bluetooth nativo para impresoras térmicas 48mm, 58mm o 80mm. Primero empareja la impresora desde Ajustes de Android si no aparece.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tamano de papel</label>
            <select className="select" value={settings.paperSize || '58mm'} onChange={e => set('paperSize', e.target.value)}>
              <option value="48mm">48mm — Impresora mini / papel estrecho</option>
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

        <div className="mt-5 bg-[#101c35] border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-200">Impresora Bluetooth</div>
              <div className="text-xs text-slate-500">Vincula y guarda la impresora para usarla al imprimir facturas.</div>
            </div>
            <button
              type="button"
              onClick={handleAddBluetoothPrinter}
              disabled={pairingPrinter}
              className="btn-primary text-xs whitespace-nowrap"
            >
              {pairingPrinter ? 'Buscando...' : '+ Agregar impresora'}
            </button>
          </div>

          {settings.bluetoothPrinter?.id ? (
            <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#00e5a0]/10 border border-[#00e5a0]/20 flex items-center justify-center text-2xl flex-shrink-0">📠</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100 truncate">{settings.bluetoothPrinter.name || 'Impresora Bluetooth'}</div>
                <div className="text-xs text-slate-500">
                  Bluetooth · {settings.paperSize || '58mm'} · Guardada para facturas
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handleTestBluetoothPrinter} disabled={testingPrinter} className="btn-secondary text-xs">
                  {testingPrinter ? 'Probando...' : 'Probar'}
                </button>
                <button type="button" onClick={handleRemoveBluetoothPrinter} className="btn-danger text-xs">
                  Quitar
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-slate-500">
              No hay impresora guardada. Presiona <span className="text-[#00e5a0] font-semibold">Agregar impresora</span> y selecciona tu impresora Bluetooth.
            </div>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mostrar en el ticket</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { key: 'printLogo',    label: 'Logo del negocio'         },
              { key: 'printAddress', label: 'Direccion del negocio'    },
              { key: 'printPhone',   label: 'Telefono del negocio'     },
              { key: 'printRNC',     label: 'RNC / Cédula fiscal'      },
              { key: 'printEmail',   label: 'Correo electrónico'       },
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
            {settings.printRNC !== false && settings.rnc && <div className="text-center text-xs text-gray-600">RNC: {settings.rnc}</div>}
            {settings.printEmail !== false && settings.email && <div className="text-center text-xs text-gray-600">{settings.email}</div>}
            <div className="border-t border-dashed border-gray-400 my-1" />
            <div className="flex justify-between"><span>Articulo x1</span><span>RD$100</span></div>
            <div className="flex justify-between"><span>Articulo x2</span><span>RD$200</span></div>
            <div className="border-t border-dashed border-gray-400 my-1" />
            {settings.printTax !== false && Number(settings.taxRate ?? 18) > 0 && <div className="flex justify-between text-gray-600"><span>ITBIS {settings.taxRate ?? 18}%</span><span>RD$54</span></div>}
            <div className="flex justify-between font-bold"><span>TOTAL</span><span>{Number(settings.taxRate ?? 18) > 0 ? 'RD$354' : 'RD$300'}</span></div>
            <div className="border-t border-dashed border-gray-400 my-1" />
            <div className="text-center text-xs text-gray-500">{settings.invoiceFooter || '¡Gracias!'}</div>
          </div>
          <div className="text-xs text-slate-500 text-center mt-2">
            Ancho: {settings.paperSize || '58mm'} · {settings.printCopies || 1} copia(s)
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
