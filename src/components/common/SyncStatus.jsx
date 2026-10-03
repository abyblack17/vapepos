import React, { useEffect, useState } from 'react'
import { getSyncStatus, subscribeSync, flushOperations, separateRejectedLiquid } from '../../services/offlineSync'
import { listOperations, listReviewOperations } from '../../services/offlineStore'
import { isRejectedLegacyLiquid } from '../../services/syncRecovery'
import { useAuth } from '../../contexts/AuthContext'
import Modal from '../ui/Modal'

export default function SyncStatus() {
  const [status, setStatus] = useState(getSyncStatus)
  const [operations, setOperations] = useState(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [repairError, setRepairError] = useState('')
  const { businessId, authUser } = useAuth()
  useEffect(() => subscribeSync(setStatus), [])
  const belongs = item => item.businessId === businessId && item.uid === authUser?.uid
  useEffect(() => {
    const refresh = () => listReviewOperations().then(rows => setReviewCount(rows.filter(belongs).length)).catch(() => {})
    refresh(); window.addEventListener('vapepos-review-updated', refresh)
    return () => window.removeEventListener('vapepos-review-updated', refresh)
  }, [businessId, authUser?.uid])
  const inspect = async () => setOperations([...(await listOperations()), ...(await listReviewOperations())].filter(belongs))
  return <>
    <div className={`px-4 py-2 text-xs flex gap-3 items-center flex-wrap ${status.error ? 'bg-red-900/30 text-red-300' : 'bg-[#101c35] text-slate-300'}`} role="status">
      <span>{status.syncing ? 'Sincronizando…' : status.online ? 'Con conexión' : 'Sin conexión · trabajando con datos locales'}</span>
      <button onClick={inspect}>{status.pending} operación(es) pendiente(s)</button>
      {reviewCount > 0 && <button className="text-amber-300 underline" onClick={inspect}>{reviewCount} cambio(s) conservado(s) para revisión · no sincronizados</button>}
      {status.error && <span>{status.error}</span>}
      {status.warning && <span className="text-amber-300">{status.warning}</span>}
      <button className="underline" onClick={() => flushOperations()} disabled={!status.online || status.syncing}>Reintentar</button>
    </div>
    {operations && <Modal title="Operaciones guardadas en este equipo" onClose={() => setOperations(null)}>
      <div className="space-y-3 text-sm text-slate-300">
        {!operations.length && <p>No hay operaciones pendientes.</p>}
        {repairError && <p className="text-red-300">{repairError}</p>}
        {operations.map(operation => <div className="border border-white/10 p-3 rounded" key={operation.id}><div>{operation.name} · {new Date(operation.createdAt).toLocaleString('es-DO')}</div><div>{operation.reviewRequired ? operation.recoveryReason || 'Conservada para revisión. No se ha aplicado este cambio al inventario.' : operation.error || 'Pendiente de envío'}</div><div className="text-xs text-slate-500">{operation.payload.sale?.saleNumber || operation.payload.documentId || operation.payload.liquidId}</div>{!operation.reviewRequired && isRejectedLegacyLiquid(operation) && <button className="btn-secondary mt-2" onClick={async () => {
          if (!window.confirm('Este cambio de saldo fue rechazado. Se conservará una copia para revisión, sin aplicarlo al inventario, y se reintentará el resto de la cola. ¿Continuar?')) return
          try { setRepairError(''); await separateRejectedLiquid(operation.id); await inspect() } catch (error) { setRepairError(error.message) }
        }}>Conservar para revisión y desbloquear cola</button>}</div>)}
        <button className="btn-secondary" onClick={() => {
          const blob = new Blob([JSON.stringify(operations, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a'); link.href = url; link.download = 'vapepos-operaciones-pendientes.json'; link.click(); URL.revokeObjectURL(url)
        }}>Exportar operaciones pendientes</button>
      </div>
    </Modal>}
  </>
}
