// ============================================================
// firestoreService.js
// Capa base de acceso a Firestore con aislamiento por negocio.
//
// TODAS las operaciones de datos pasan por aquí.
// Nunca se accede a colecciones raíz directamente desde
// los servicios de dominio — siempre se usa bizCol() o bizDoc().
//
// Estructura en Firestore:
//   /businesses/{businessId}/{collection}/{documentId}
// ============================================================

import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../config/firebase'
import { queueOperation } from './offlineSync'

// ── Path builders ─────────────────────────────────────────────

/**
 * Retorna una referencia a una subcolección del negocio.
 * Ejemplo: bizCol('biz_abc', 'products')
 *   → /businesses/biz_abc/products
 */
export function bizCol(businessId, colName) {
  return collection(db, 'businesses', businessId, colName)
}

/**
 * Retorna una referencia a un documento dentro del negocio.
 * Ejemplo: bizDoc('biz_abc', 'products', 'p1')
 *   → /businesses/biz_abc/products/p1
 */
export function bizDoc(businessId, colName, docId) {
  return doc(db, 'businesses', businessId, colName, docId)
}

/**
 * Referencia al documento de settings del negocio.
 * Solo existe un documento de settings por negocio.
 */
export function bizSettingsDoc(businessId) {
  return doc(db, 'businesses', businessId, 'settings', 'config')
}

/**
 * Referencia al documento del negocio raíz.
 */
export function businessDoc(businessId) {
  return doc(db, 'businesses', businessId)
}

// ── Generic CRUD within a business ──────────────────────────

export async function bizGetAll(businessId, colName, constraints = []) {
  try {
    const q = constraints.length
      ? query(bizCol(businessId, colName), ...constraints)
      : query(bizCol(businessId, colName))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn(`bizGetAll(${colName}) failed:`, err.message)
    throw err
  }
}

export async function bizGetOne(businessId, colName, docId) {
  try {
    const snap = await getDoc(bizDoc(businessId, colName, docId))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() }
  } catch {
    return null
  }
}

export async function bizAdd(businessId, colName, data) {
  // Strip 'id' from data — Firestore generates its own ID
  // If we save 'id' inside the doc, it overwrites d.id on load
  const { id: _stripId, ...cleanData } = data
  const payload = {
    ...cleanData,
    businessId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  try {
    const id = cleanData.id || crypto.randomUUID()
    await queueOperation('applyBusinessMutation', { collection: colName, documentId: id, action: 'set', data: cleanData }, businessId)
    return { id, ...cleanData, businessId }
  } catch (err) {
    console.warn(`bizAdd(${colName}) failed:`, err.message)
    throw err
  }
}

export async function bizSet(businessId, colName, docId, data) {
  if (!docId) {
    console.warn(`bizSet(${colName}) called with empty docId — skipping`)
    return null
  }
  const { id: _stripId, ...cleanData } = data
  const payload = { ...cleanData, businessId, updatedAt: serverTimestamp() }
  try {
    await queueOperation('applyBusinessMutation', { collection: colName, documentId: docId, action: 'set', data: cleanData }, businessId)
    return { id: docId, ...payload }
  } catch (err) {
    console.warn(`bizSet(${colName}/${docId}) failed:`, err.message)
    throw err
  }
}

export async function bizUpdate(businessId, colName, docId, updates) {
  if (!docId) {
    console.warn(`bizUpdate(${colName}) called with empty docId — skipping`)
    return false
  }
  const { id: _stripId, ...cleanUpdates } = updates
  try {
    await queueOperation('applyBusinessMutation', { collection: colName, documentId: docId, action: 'update', data: cleanUpdates }, businessId)
    return true
  } catch (err) {
    console.warn(`bizUpdate(${colName}/${docId}) failed:`, err.message)
    throw err
  }
}

export async function bizDelete(businessId, colName, docId) {
  if (!docId) {
    console.warn(`bizDelete(${colName}) called with empty docId — skipping`)
    return false
  }
  try {
    await queueOperation('applyBusinessMutation', { collection: colName, documentId: docId, action: 'delete' }, businessId)
    return true
  } catch (err) {
    console.warn(`bizDelete(${colName}/${docId}) failed:`, err.message)
    throw err
  }
}

// ── Settings ─────────────────────────────────────────────────

export async function getBusinessSettings(businessId, branchId = null) {
  try {
    const snap = await getDoc(bizSettingsDoc(businessId))
    let base = snap.exists() ? snap.data() : null
    // Fallback: read from /businesses/{id} root doc
    if (!base) {
      const biz = await getDoc(businessDoc(businessId))
      base = biz.exists() ? biz.data() : null
    }
    if (branchId && branchId !== 'main') {
      const branchSnap = await getDoc(bizDoc(businessId, 'branch_settings', branchId))
      if (branchSnap.exists()) return { ...base, ...branchSnap.data() }
    }
    return base
  } catch {
    return null
  }
}

export async function saveBusinessSettings(businessId, settings, branchId = null) {
  try {
    await queueOperation('applyBusinessMutation', { collection: branchId && branchId !== 'main' ? 'branch_settings' : 'settings', documentId: branchId && branchId !== 'main' ? branchId : 'config', action: 'set', data: settings }, businessId)
    return true
  } catch (err) {
    console.warn('saveBusinessSettings failed:', err.message)
    return false
  }
}

// ── Real-time listeners ───────────────────────────────────────

/**
 * Escucha cambios en tiempo real a una subcolección del negocio.
 * Retorna la función de unsubscribe.
 */
export function bizListen(businessId, colName, constraints, callback) {
  const q = constraints?.length
    ? query(bizCol(businessId, colName), ...constraints)
    : query(bizCol(businessId, colName))
  return onSnapshot(q, (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    callback(docs)
  }, (err) => {
    console.warn(`bizListen(${colName}) error:`, err.message)
  })
}

// ── Helpers ──────────────────────────────────────────────────

export { serverTimestamp, Timestamp, orderBy, where, limit }

// ── Global collections (shared across all businesses) ────────
// Used for the providers directory marketplace

export function globalCol(colName) {
  return collection(db, colName)
}

export function globalDoc(colName, docId) {
  return doc(db, colName, docId)
}

export async function globalGetAll(colName, constraints = []) {
  try {
    const q = constraints.length
      ? query(globalCol(colName), ...constraints)
      : query(globalCol(colName))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.warn(`globalGetAll(${colName}) failed:`, err.message)
    return []
  }
}

export async function globalAdd(colName, data) {
  const payload = { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
  try {
    const ref = await addDoc(globalCol(colName), payload)
    return { id: ref.id, ...payload }
  } catch (err) {
    console.warn(`globalAdd(${colName}) failed:`, err.message)
    return null
  }
}

export async function globalSet(colName, docId, data) {
  const payload = { ...data, updatedAt: serverTimestamp() }
  try {
    await setDoc(globalDoc(colName, docId), payload, { merge: true })
    return { id: docId, ...payload }
  } catch (err) {
    console.warn(`globalSet(${colName}/${docId}) failed:`, err.message)
    return null
  }
}

export async function globalDelete(colName, docId) {
  try {
    await deleteDoc(globalDoc(colName, docId))
    return true
  } catch (err) {
    console.warn(`globalDelete(${colName}/${docId}) failed:`, err.message)
    return false
  }
}
