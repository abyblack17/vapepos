import { doc, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../config/firebase'
import { bizSet, bizUpdate, bizDelete } from './firestoreService'
import { buildNCF, sequenceAvailable, sequenceRemaining } from '../utils/fiscalHelpers'

export async function saveFiscalConfig(businessId, config) {
  await bizSet(businessId, 'fiscalConfig', 'config', config)
  return { id: 'config', ...config }
}

export async function saveNCFSequence(businessId, sequence) {
  const id = sequence.id || `${sequence.typeCode}_${Date.now()}`
  const payload = {
    typeCode: sequence.typeCode,
    label: sequence.label || sequence.typeCode,
    prefix: sequence.prefix || sequence.typeCode,
    startNumber: Number(sequence.startNumber || 1),
    endNumber: Number(sequence.endNumber || 1),
    nextNumber: Number(sequence.nextNumber || sequence.startNumber || 1),
    expiresAt: sequence.expiresAt || '',
    active: sequence.active !== false,
    alertThreshold: Number(sequence.alertThreshold || 10),
  }
  await bizSet(businessId, 'ncfSequences', id, payload)
  return { id, ...payload }
}

export async function deleteNCFSequence(businessId, sequenceId) {
  return bizDelete(businessId, 'ncfSequences', sequenceId)
}

export async function issueNCF(businessId, sequences, typeCode) {
  const local = (sequences || []).find(s => s.typeCode === typeCode && sequenceAvailable(s))
  if (!local) throw new Error(`No hay secuencia NCF activa/disponible para ${typeCode}`)

  const ref = doc(db, 'businesses', businessId, 'ncfSequences', local.id)
  const result = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error(`La secuencia ${typeCode} no existe en Firestore`)
    const seq = { id: snap.id, ...snap.data() }
    if (!sequenceAvailable(seq)) throw new Error(`La secuencia ${typeCode} está vencida, agotada o inactiva`)

    const usedNumber = Number(seq.nextNumber)
    const nextNumber = usedNumber + 1
    const ncf = buildNCF(seq.prefix || seq.typeCode, usedNumber)
    tx.update(ref, {
      nextNumber,
      updatedAt: serverTimestamp(),
    })
    return {
      ncf,
      sequenceId: seq.id,
      typeCode: seq.typeCode,
      label: seq.label,
      prefix: seq.prefix || seq.typeCode,
      usedNumber,
      nextNumber,
      expiresAt: seq.expiresAt || '',
      remaining: Math.max(0, Number(seq.endNumber || 0) - nextNumber + 1),
      alertThreshold: Number(seq.alertThreshold || 10),
    }
  })

  return result
}

export async function saveFiscalInvoice(businessId, invoice) {
  await bizSet(businessId, 'fiscalInvoices', invoice.id, invoice)
  return invoice
}
