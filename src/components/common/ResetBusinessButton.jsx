import React, { useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../../config/firebase'
import Modal from '../ui/Modal'
import toast from 'react-hot-toast'

export default function ResetBusinessButton({ businessId, businessName, onReset }) {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const reset = async () => {
    if (!navigator.onLine) return toast.error('La restauración requiere conexión.')
    setBusy(true)
    try {
      await httpsCallable(functions, 'resetBusinessData', { timeout: 540000 })({ businessId, confirmation })
      toast.success('Negocio restaurado a cero')
      setOpen(false)
      onReset?.()
    } catch (error) { toast.error(error.message || 'No se pudo restaurar el negocio') }
    finally { setBusy(false) }
  }
  return <>
    <button className="btn-secondary text-red-400 text-xs" onClick={() => { setConfirmation(''); setOpen(true) }}>Restaurar a cero</button>
    {open && <Modal title="Restaurar negocio a cero" onClose={() => { if (!busy) setOpen(false) }} size="sm">
      <div className="space-y-4">
        <p className="font-semibold text-slate-100">{businessName || businessId}</p>
        <p className="text-sm text-red-300">Se eliminarán las ventas, recibos, inventario, líquidos, compras, clientes, proveedores y movimientos de caja de todas las sucursales. Esta acción no se puede deshacer.</p>
        <p className="text-sm text-slate-400">Se conservarán los usuarios, el plan, las sucursales, la configuración del negocio y las secuencias fiscales para evitar reutilizar NCF. Las operaciones anteriores pendientes en otros equipos quedarán archivadas y no se subirán.</p>
        <p className="text-xs text-slate-400">Descarga un respaldo desde Configuración antes de continuar. Escribe RESTAURAR NEGOCIO para confirmar.</p>
        <input className="input" aria-label="Confirmación de restauración" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
        <div className="flex gap-2 justify-end"><button className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button><button className="btn-danger" disabled={busy || confirmation !== 'RESTAURAR NEGOCIO'} onClick={reset}>{busy ? 'Restaurando…' : 'Eliminar datos y restaurar'}</button></div>
      </div>
    </Modal>}
  </>
}
