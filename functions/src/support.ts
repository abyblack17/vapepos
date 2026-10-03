import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore'
import { trialExpired } from './trial'

export const SUPPORT_MODULES: Record<string, string> = {
  settings: 'Configuración', products: 'Inventario', liquids: 'Líquidos', sales: 'Ventas',
  customers: 'Clientes', suppliers: 'Proveedores', purchases: 'Compras', users: 'Usuarios',
  branches: 'Sucursales', branch_settings: 'Configuración de sucursales', branch_transfers: 'Transferencias',
  cash_sessions: 'Caja', inventory_movements: 'Movimientos de inventario',
  liquid_sessions: 'Frascos', liquid_events: 'Movimientos de líquidos', refill_history: 'Recargas',
  fiscalConfig: 'Configuración fiscal', ncfSequences: 'Secuencias NCF', fiscalInvoices: 'Facturas fiscales',
  audit_logs: 'Auditoría', suggestions: 'Sugerencias', upgrade_requests: 'Solicitudes Pro',
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
}

async function requireSuperAdmin(request: any) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.')
  const user = (await getFirestore().doc(`users/${request.auth.uid}`).get()).data()
  if (user?.active !== true || user.role !== 'superadmin') {
    throw new HttpsError('permission-denied', 'Solo Superadmin puede consultar soporte.')
  }
  return user
}

// Never expose passwords, service credentials or fiscal private keys to support.
export function supportSafeData(value: any): any {
  if (value == null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(supportSafeData)
  const result: Record<string, any> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!/password|passwd|token|secret|credential|private.?key|certificate|api.?key/i.test(key)) {
      result[key] = supportSafeData(entry)
    }
  }
  return result
}

export const openBusinessSupport = onCall({ region: 'us-central1' }, async request => {
  const actor = await requireSuperAdmin(request)
  const businessId = request.data?.businessId
  if (!validId(businessId)) throw new HttpsError('invalid-argument', 'Negocio inválido.')
  const db = getFirestore()
  const business = await db.doc(`businesses/${businessId}`).get()
  if (!business.exists) throw new HttpsError('not-found', 'El negocio no existe.')
  const session = db.collection('support_sessions').doc()
  const batch = db.batch()
  batch.set(session, { businessId, userId: request.auth!.uid, mode: 'read-only', expiresAt: Date.now() + 30 * 60000, createdAt: FieldValue.serverTimestamp() })
  batch.set(db.collection(`businesses/${businessId}/audit_logs`).doc(), {
    businessId, userId: request.auth!.uid, userName: actor.email || request.auth!.uid,
    role: 'superadmin', action: 'SUPPORT_VIEW', module: 'support', mode: 'read-only',
    sessionId: session.id, createdAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()
  return { sessionId: session.id, business: { ...supportSafeData(business.data()), id: business.id }, modules: SUPPORT_MODULES }
})

export const readBusinessSupport = onCall({ region: 'us-central1' }, async request => {
  await requireSuperAdmin(request)
  const { sessionId, module, cursor } = request.data || {}
  if (!validId(sessionId) || typeof module !== 'string' || !Object.prototype.hasOwnProperty.call(SUPPORT_MODULES, module)
    || (cursor != null && !validId(cursor))) throw new HttpsError('invalid-argument', 'Consulta inválida.')
  const db = getFirestore()
  const session = (await db.doc(`support_sessions/${sessionId}`).get()).data()
  if (!session || session.userId !== request.auth!.uid || session.mode !== 'read-only' || session.expiresAt <= Date.now()) {
    throw new HttpsError('permission-denied', 'La sesión de soporte venció. Vuelve a entrar desde Superadmin.')
  }
  if (!(await db.doc(`businesses/${session.businessId}`).get()).exists) throw new HttpsError('not-found', 'El negocio no existe.')
  let query = db.collection(`businesses/${session.businessId}/${module}`).orderBy(FieldPath.documentId()).limit(51)
  if (cursor) query = query.startAfter(cursor)
  const page = await query.get()
  const docs = page.docs.slice(0, 50)
  return {
    rows: docs.map(item => ({ ...supportSafeData(item.data()), id: item.id })),
    nextCursor: page.docs.length > 50 ? docs[docs.length - 1].id : null,
  }
})

export const recordBusinessActivity = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.')
  const db = getFirestore()
  return db.runTransaction(async tx => {
    const user = (await tx.get(db.doc(`users/${request.auth!.uid}`))).data()
    if (user?.active !== true || user.role === 'superadmin' || !validId(user.businessId)) return { recorded: false }
    // The tenant is always derived from the authenticated profile, not request data.
    const ref = db.doc(`businesses/${user.businessId}`)
    const business = (await tx.get(ref)).data()
    if (!business || business.active !== true || trialExpired(business)) return { recorded: false }
    const last = business.lastActivityAt?.toMillis?.() || 0
    if (Date.now() - last < 5 * 60000) return { recorded: false }
    tx.update(ref, { lastActivityAt: FieldValue.serverTimestamp() })
    return { recorded: true }
  })
})
