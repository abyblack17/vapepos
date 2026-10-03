import { httpsCallable } from 'firebase/functions'
import { assertSupportWritable, isSupportMode } from './supportMode'
import { getDocFromServer, doc } from 'firebase/firestore'
import { auth, db, functions } from '../config/firebase'
import { readLocal, writeLocal, listOperations, enqueueLocal, preserveForReview } from './offlineStore'
import { LIQUID_MOVEMENT_FIELDS, isRejectedLegacyLiquid, isMissingLiquidSuperseded, withLoadDeadline } from './syncRecovery'

let context = null
let projectOperation = null
export function setOfflineProjection(project) { projectOperation = project }
let activeFlush = null
let syncStatus = { pending: 0, error: '', syncing: false, online: navigator.onLine }
const listeners = new Set()
export const getSyncStatus = () => syncStatus
export function subscribeSync(listener) { listeners.add(listener); return () => listeners.delete(listener) }
function publish(patch) {
  syncStatus = { ...syncStatus, ...patch }
  listeners.forEach(listener => listener(syncStatus))
}
export function setSyncContext(value) {
  context = value
  listOperations().then(items => publish({ pending: items.filter(item => item.uid === auth.currentUser?.uid && item.businessId === value?.businessId && item.epoch === value?.epoch).length })).catch(console.error)
  flushOperations().catch(error => publish({ error: error.message }))
}
const retryable = error => /unavailable|deadline-exceeded|network-request-failed|internal|unknown/.test(error?.code || '')
export async function queueOperation(name, payload, businessId = context?.businessId) {
  assertSupportWritable()
  if (name === 'applyBusinessMutation' && payload.collection === 'liquids' && payload.action === 'update' && LIQUID_MOVEMENT_FIELDS.some(field => field in (payload.data || {}))) {
    throw new Error('El saldo de líquidos debe guardarse mediante un movimiento registrado, no una actualización directa.')
  }
  if (!auth.currentUser || !businessId || businessId !== context?.businessId) throw new Error('No hay un negocio validado para guardar esta operación.')
  const operation = {
    id: crypto.randomUUID(), name, payload: JSON.parse(JSON.stringify(payload, (key, value) => value?._methodName === 'serverTimestamp' ? new Date().toISOString() : value)),
    businessId, uid: auth.currentUser.uid, epoch: context.epoch || 0, createdAt: Date.now(),
  }
  await enqueueLocal(operation, projectOperation?.(operation))
  publish({ pending: (await listOperations()).filter(item => item.uid === operation.uid && item.businessId === businessId).length })
  flushOperations().catch(error => publish({ error: error.message }))
  return { data: { success: true, pending: true } }
}
export async function flushOperations() {
  if (isSupportMode()) return
  if (activeFlush) return activeFlush
  if (!context || !navigator.onLine || !auth.currentUser) return
  const captured = { ...context, uid: auth.currentUser.uid }
  activeFlush = (async () => {
    const run = async () => {
      publish({ syncing: true, error: '' })
      const businessSnap = await withLoadDeadline(getDocFromServer(doc(db, 'businesses', captured.businessId)))
      if (!businessSnap.exists() || businessSnap.data().resetInProgress) throw new Error('El negocio se está restaurando. Intenta sincronizar después.')
      const serverEpoch = businessSnap.data().dataEpoch || 0
      if (serverEpoch !== captured.epoch) {
        publish({ error: 'El negocio fue restaurado. Las operaciones anteriores quedaron archivadas para revisión.' })
        window.dispatchEvent(new CustomEvent('vapepos-business-reset', { detail: { businessId: captured.businessId, epoch: serverEpoch } }))
        return
      }
      for (const operation of await listOperations()) {
        if (context?.businessId !== captured.businessId || auth.currentUser?.uid !== captured.uid) break
        if (operation.uid !== captured.uid || operation.businessId !== captured.businessId) continue
        if (operation.epoch !== serverEpoch) {
          await writeLocal(`operation:${operation.id}`, { ...operation, error: 'Archivada: pertenece al estado anterior a la restauración.' })
          continue
        }
        try {
          const result = await httpsCallable(functions, operation.name, { timeout: 15000 })({
            ...operation.payload, operationId: operation.id, dataEpoch: operation.epoch,
            businessId: operation.businessId,
          })
          if (result.data?.warnings?.length) publish({ warning: result.data.warnings.join(' ') })
          await writeLocal(`operation:${operation.id}`, undefined)
        } catch (error) {
          if (context?.businessId === captured.businessId && context?.epoch === captured.epoch && auth.currentUser?.uid === captured.uid
            && isMissingLiquidSuperseded(operation, error, await listOperations())) {
            await preserveForReview({ ...operation, error: error.message, recoveryReason: 'El líquido ya no existe y hay una eliminación posterior del mismo registro. No se recreó ni se aplicó este saldo.' })
            window.dispatchEvent(new Event('vapepos-review-updated'))
            continue
          }
          if (!retryable(error)) await writeLocal(`operation:${operation.id}`, { ...operation, error: error.message })
          throw error
        }
      }
      const pending = (await listOperations()).filter(item => item.uid === captured.uid && item.businessId === captured.businessId && item.epoch === serverEpoch).length
      const hadPending = syncStatus.pending > 0
      publish({ pending })
      if (!pending && hadPending) window.dispatchEvent(new Event('vapepos-synced'))
    }
    try {
      // A browser lock prevents two tabs replaying the same queue concurrently.
      if (navigator.locks) await navigator.locks.request(`vapepos-sync-${captured.businessId}`, run)
      else await run()
    } catch (error) { publish({ error: error.message }) }
    finally { publish({ syncing: false }); activeFlush = null }
  })()
  return activeFlush
}
export async function separateRejectedLiquid(operationId) {
  if (activeFlush) await activeFlush
  const run = async () => {
    const operation = (await listOperations()).find(item => item.id === operationId)
    if (!operation || !isRejectedLegacyLiquid(operation) || operation.uid !== auth.currentUser?.uid || operation.businessId !== context?.businessId || operation.epoch !== context?.epoch) throw new Error('Esta operación no se puede separar automáticamente.')
    await preserveForReview(operation)
    publish({ error: 'El cambio rechazado se conserva para revisión; no se ha aplicado al inventario.', pending: (await listOperations()).filter(item => item.uid === operation.uid && item.businessId === operation.businessId && item.epoch === operation.epoch).length })
  }
  if (navigator.locks) await navigator.locks.request(`vapepos-sync-${context?.businessId}`, run)
  else await run()
  await flushOperations()
  if (!syncStatus.pending) window.dispatchEvent(new Event('vapepos-synced'))
  window.dispatchEvent(new Event('vapepos-review-updated'))
}
export async function offlineCallable(name, payload, localResult) {
  const result = await queueOperation(name, payload)
  return localResult ? { data: localResult } : result
}
window.addEventListener('online', () => { publish({ online: true }); flushOperations() })
window.addEventListener('offline', () => publish({ online: false }))
setInterval(() => { if (context && navigator.onLine) flushOperations() }, 30000)
