import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import * as crypto from 'crypto'
import { trialExpired } from './trial'

const collections = ['products', 'liquids', 'customers', 'suppliers', 'purchases', 'cash_sessions', 'inventory_movements', 'audit_logs', 'fiscalConfig', 'ncfSequences', 'fiscalInvoices', 'settings', 'branch_settings', 'sales', 'suggestions']
const operationalCollections = ['products', 'liquids', 'customers', 'suppliers', 'sales', 'purchases', 'cash_sessions', 'inventory_movements', 'liquid_sessions', 'liquid_events', 'refill_history', 'fiscalInvoices', 'branch_transfers']
const key = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value)

export const addOpenLiquidStock = onCall({ region: 'us-central1', enforceAppCheck: true }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.')
  const db = getFirestore()
  const uid = request.auth.uid
  const profile = (await db.doc(`users/${uid}`).get()).data()
  if (request.data?.businessId && request.data.businessId !== profile?.businessId) throw new HttpsError('permission-denied', 'La operación pertenece a otro negocio.')
  if (!profile?.active || !profile.businessId || !['Administrador', 'Encargado'].includes(profile.role)) throw new HttpsError('permission-denied', 'Sin permiso para agregar líquidos.')
  const { liquidId, operationId, ml, capacity, dataEpoch } = request.data
  const data = request.data.liquid || {}
  const editFields = request.data.editFields || {}
  const editable = ['name', 'sku', 'brand', 'flavor', 'category', 'sizeML', 'costPerBottle', 'pricePerBottle', 'taxIncluded', 'closedBottles', 'pointsR50', 'pointsR100', 'pointsR150', 'refillConsumption', 'consumptionUnit', 'nicotinaFreebase', 'nicotinaSales', 'imageUrl', 'color']
  if (Object.keys(editFields).some(field => !editable.includes(field))) throw new HttpsError('invalid-argument', 'Los campos de edición contienen datos no permitidos.')
  if (Object.keys(editFields).length && (!String(editFields.name || '').trim() || !Number.isInteger(editFields.closedBottles) || editFields.closedBottles < 0)) throw new HttpsError('invalid-argument', 'Nombre y cantidad de botellas cerradas inválidos.')
  if (!key(liquidId) || !key(operationId) || !Number.isFinite(ml) || !Number.isFinite(capacity) || ml <= 0 || capacity <= 0 || ml > capacity || !String(data.name || '').trim()) throw new HttpsError('invalid-argument', 'Nombre, capacidad y ml disponibles son obligatorios.')
  const ref = db.doc(`businesses/${profile.businessId}/liquids/${liquidId}`)
  const receipt = db.doc(`businesses/${profile.businessId}/sync_receipts/${operationId}`)
  const sessionRef = db.collection(`businesses/${profile.businessId}/liquid_sessions`).doc(operationId)
  const eventRef = db.collection(`businesses/${profile.businessId}/liquid_events`).doc(operationId)
  return db.runTransaction(async tx => {
    const [business, previous, done] = await Promise.all([tx.get(db.doc(`businesses/${profile.businessId}`)), tx.get(ref), tx.get(receipt)])
    if (trialExpired(business.data())) throw new HttpsError('failed-precondition', 'Tu prueba ha concluido. Contacta a soporte.')
    if (business.data()?.active !== true || business.data()?.resetInProgress || (business.data()?.dataEpoch || 0) !== dataEpoch) throw new HttpsError('failed-precondition', 'El negocio fue restaurado o está suspendido.')
    if (done.exists) return { success: true, duplicate: true }
    if (Object.keys(editFields).length && !previous.exists) throw new HttpsError('not-found', 'El líquido ya no existe.')
    const old = previous.data() || {}
    if (previous.exists && (String(old.name).trim().toLowerCase() !== String(data.name).trim().toLowerCase()
      || Number(old.activeCapacity) !== capacity
      || String(old.brand || '').trim().toLowerCase() !== String(data.brand || '').trim().toLowerCase()
      || String(old.nicotinaFreebase || 'ninguna') !== String(data.nicotinaFreebase || 'ninguna')
      || String(old.nicotinaSales || 'ninguna') !== String(data.nicotinaSales || 'ninguna'))) throw new HttpsError('failed-precondition', 'El líquido existente tiene otras características.')
    const previousBalance = Number(old.activeSaldo || 0)
    const count = previousBalance > 0 ? Number(old.openBottleCount || 1) : 0
    if (count >= 3) throw new HttpsError('failed-precondition', 'El máximo es 3 botellas abiertas.')
    const sessions = Array.isArray(old.activeSessionIds) ? [...old.activeSessionIds] : []
    if (previousBalance > 0 && !sessions.length) {
      const carryId = `carry_${operationId}`
      sessions.push(carryId)
      tx.set(db.doc(`businesses/${profile.businessId}/liquid_sessions/${carryId}`), { liquidId, capacity: Number(old.activeTotalCapacity || capacity), remaining: previousBalance, status: 'active', source: 'legacy-balance', openedBy: uid, openedAt: FieldValue.serverTimestamp() })
    }
    const liquid = { ...(previous.exists ? old : data), ...editFields, businessId: profile.businessId, dataEpoch,
      closedBottles: previous.exists ? Number(editFields.closedBottles ?? old.closedBottles ?? 0) : 0,
      activeCapacity: capacity, hasActive: true, activeSaldo: previousBalance + ml,
      openBottleCount: count + 1, activeTotalCapacity: Number(old.activeTotalCapacity || count * capacity) + capacity,
      totalOpenedBottles: Number(old.totalOpenedBottles || 0) + 1,
      totalOpenedCapacity: Number(old.totalOpenedCapacity || previousBalance) + ml,
      activeSessionIds: [...sessions, operationId], updatedAt: FieldValue.serverTimestamp() }
    delete liquid.id
    tx.set(ref, liquid, { merge: true })
    tx.set(sessionRef, { liquidId, liquidName: data.name, capacity, remaining: ml, source: 'open-stock', status: 'active', openedBy: uid, openedAt: FieldValue.serverTimestamp() })
    tx.set(eventRef, { type: 'OPEN_STOCK_ADDED', liquidId, ml, previousBalance, newBalance: previousBalance + ml, userId: uid, createdAt: FieldValue.serverTimestamp() })
    tx.set(receipt, { uid, createdAt: FieldValue.serverTimestamp() })
    return { success: true }
  })
})

export const applyBusinessMutation = onCall({ region: 'us-central1', enforceAppCheck: true }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.')
  const db = getFirestore()
  const uid = request.auth.uid
  const profileSnap = await db.doc(`users/${uid}`).get()
  const profile = profileSnap.data()
  if (!profile?.active || !profile.businessId) throw new HttpsError('permission-denied', 'Cuenta sin acceso.')
  const businessId = profile.businessId
  if (request.data?.businessId && request.data.businessId !== businessId) throw new HttpsError('permission-denied', 'La operación pertenece a otro negocio.')
  const { collection, documentId, action, operationId, dataEpoch } = request.data
  if (!collections.includes(collection) || !key(documentId) || !key(operationId) || !['set', 'update', 'delete'].includes(action)) throw new HttpsError('invalid-argument', 'Operación inválida.')
  const data = { ...(request.data.data || {}) }
  delete data.id
  delete data.createdAt
  delete data.updatedAt
  const manager = ['Administrador', 'Encargado'].includes(profile.role)
  const admin = profile.role === 'Administrador'
  if (['fiscalConfig', 'ncfSequences', 'settings', 'branch_settings'].includes(collection) && !admin) throw new HttpsError('permission-denied', 'Solo el administrador puede cambiar la configuración.')
  if (collection === 'sales' && (action === 'set' || !admin)) throw new HttpsError('permission-denied', 'Las ventas se registran mediante el POS.')
  if (collection === 'sales' && action === 'delete') throw new HttpsError('failed-precondition', 'La venta debe revertirse mediante reverseSale para restaurar inventario y caja.')
  if (['products', 'liquids', 'suppliers', 'purchases'].includes(collection) && !manager) throw new HttpsError('permission-denied', 'Se requiere administrador o encargado.')
  if (action === 'delete' && !(collection === 'customers' ? manager : admin)) throw new HttpsError('permission-denied', 'No puedes eliminar estos datos.')
  if (['audit_logs', 'inventory_movements'].includes(collection) && action !== 'set') throw new HttpsError('permission-denied', 'La bitácora no se modifica.')
  if (collection === 'audit_logs') { data.userId = uid; data.role = profile.role }
  if (collection === 'cash_sessions' && action === 'set') data.userId = uid
  const ref = db.doc(`businesses/${businessId}/${collection}/${documentId}`)
  const receipt = db.doc(`businesses/${businessId}/sync_receipts/${operationId}`)
  return db.runTransaction(async tx => {
    const [business, previous, done] = await Promise.all([tx.get(db.doc(`businesses/${businessId}`)), tx.get(ref), tx.get(receipt)])
    if (trialExpired(business.data())) throw new HttpsError('failed-precondition', 'Tu prueba ha concluido. Contacta a soporte.')
    if (business.data()?.active !== true || business.data()?.resetInProgress || (business.data()?.dataEpoch || 0) !== dataEpoch) throw new HttpsError('failed-precondition', 'El negocio fue restaurado, suspendido o está restaurándose.')
    if (done.exists) return { success: true, duplicate: true }
    if (collection === 'cash_sessions' && !manager && previous.exists && previous.data()?.userId !== uid) throw new HttpsError('permission-denied', 'La caja pertenece a otro usuario.')
    if (action === 'update' && !previous.exists) throw new HttpsError('not-found', 'El registro ya no existe.')
    if (collection === 'liquids' && previous.exists) {
      const protectedFields = ['activeSaldo', 'hasActive', 'activeSessionIds', 'openBottleCount', 'activeTotalCapacity', 'totalOpenedCapacity', 'totalOpenedBottles', 'totalRechargesAllTime', 'totalRevenueAllTime', 'totalPointsConsumedAllTime']
      if (protectedFields.some(field => field in data && JSON.stringify(data[field]) !== JSON.stringify(previous.data()?.[field]))) throw new HttpsError('permission-denied', 'Usa los movimientos de líquidos para cambiar el saldo.')
    }
    if (action === 'delete') tx.delete(ref)
    else tx.set(ref, { ...data, businessId, dataEpoch, updatedAt: FieldValue.serverTimestamp(), ...(!previous.exists ? { createdAt: FieldValue.serverTimestamp() } : {}) }, { merge: true })
    if (collection === 'settings') tx.update(db.doc(`businesses/${businessId}`), {
      name: String(data.businessName || ''), phone: String(data.phone || ''), address: String(data.address || ''), taxRate: Number(data.taxRate || 0), updatedAt: FieldValue.serverTimestamp(),
    })
    tx.set(receipt, { uid, collection, documentId, createdAt: FieldValue.serverTimestamp() })
    return { success: true }
  })
})

export const resetBusinessData = onCall({ region: 'us-central1', enforceAppCheck: true, timeoutSeconds: 540 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.')
  if (request.data?.confirmation !== 'RESTAURAR NEGOCIO') throw new HttpsError('invalid-argument', 'Confirmación incorrecta.')
  const db = getFirestore()
  const profile = (await db.doc(`users/${request.auth.uid}`).get()).data()
  const businessId = String(request.data.businessId || '')
  if (!key(businessId) || !profile?.active || !(profile.role === 'superadmin' || (profile.role === 'Administrador' && profile.businessId === businessId))) throw new HttpsError('permission-denied', 'Solo el administrador del negocio o superadmin puede restaurar.')
  const businessRef = db.doc(`businesses/${businessId}`)
  let resetId = crypto.randomUUID()
  const epoch = await db.runTransaction(async tx => {
    const snap = await tx.get(businessRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Negocio inexistente.')
    if (profile.role !== 'superadmin' && trialExpired(snap.data())) throw new HttpsError('failed-precondition', 'Tu prueba ha concluido. Contacta a soporte.')
    if (snap.data()?.resetInProgress) {
      const previousId = snap.data()?.resetId
      const previous = previousId ? await tx.get(db.doc(`businesses/${businessId}/reset_history/${previousId}`)) : null
      if (previous?.data()?.status !== 'failed') throw new HttpsError('failed-precondition', 'Hay una restauración en curso. Espera a que termine.')
      resetId = previousId
      tx.update(previous!.ref, { status: 'running', resumedAt: FieldValue.serverTimestamp() })
      return snap.data()!.dataEpoch
    }
    const nextEpoch = (snap.data()?.dataEpoch || 0) + 1
    tx.update(businessRef, { resetInProgress: true, dataEpoch: nextEpoch, resetId })
    tx.set(db.doc(`businesses/${businessId}/reset_history/${resetId}`), {
      userId: request.auth!.uid, status: 'running', dataEpoch: nextEpoch, createdAt: FieldValue.serverTimestamp(),
    })
    return nextEpoch
  })
  try {
    for (const name of operationalCollections) await db.recursiveDelete(businessRef.collection(name))
    await businessRef.update({ resetInProgress: false, resetAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    await db.doc(`businesses/${businessId}/reset_history/${resetId}`).update({ status: 'completed', completedAt: FieldValue.serverTimestamp() })
    return { success: true, dataEpoch: epoch }
  } catch (error) {
    await db.doc(`businesses/${businessId}/reset_history/${resetId}`).update({ status: 'failed' })
    // Leave the lock set: a partial reset must never accept new sales.
    throw new HttpsError('internal', 'Restauración incompleta. El negocio quedó bloqueado para que soporte la termine.')
  }
})
