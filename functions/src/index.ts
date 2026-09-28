import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentDeleted } from 'firebase-functions/v2/firestore'
import { initializeApp } from 'firebase-admin/app'
import { getAuth, UpdateRequest } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import * as crypto from 'crypto'

initializeApp()
const db = getFirestore()
const auth = getAuth()

async function setAccessClaims(uid: string, businessId: string | null, role: string, active: boolean) {
  const user = await auth.getUser(uid)
  await auth.setCustomUserClaims(uid, {
    ...(user.customClaims || {}),
    vapePosBusinessId: businessId,
    vapePosRole: role,
    vapePosActive: active,
  })
}

// Sincroniza en el token firmado los permisos que Storage necesita evaluar.
// El cliente no puede elegir estos valores: siempre se leen del perfil servidor.
export const syncMyAccessClaims = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')
    const profile = await db.doc(`users/${request.auth.uid}`).get()
    if (!profile.exists) throw new HttpsError('not-found', 'Perfil no encontrado.')
    const data = profile.data()!
    const businessId = typeof data.businessId === 'string' ? data.businessId : null
    const role = String(data.role || '')
    const active = data.active === true
    await setAccessClaims(request.auth.uid, businessId, role, active)
    return { success: true }
  }
)

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

async function requireBusinessUser(uid: string, managerOnly = false): Promise<any> {
  const snap = await db.doc(`users/${uid}`).get()
  const data = snap.data()
  if (!snap.exists || data?.active !== true || !data?.businessId) {
    throw new HttpsError('permission-denied', 'Usuario o negocio no autorizado.')
  }
  if (managerOnly && !['Administrador', 'Encargado'].includes(String(data.role))) {
    throw new HttpsError('permission-denied', 'Esta operación requiere rol de administrador o encargado.')
  }
  return { ...data, businessId: String(data.businessId), role: String(data.role || '') }
}

// Abre hasta tres frascos del mismo líquido. El saldo anterior se conserva y
// la capacidad del nuevo frasco se suma al depósito activo.
export const openLiquidBottle = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')
    const uid = request.auth.uid
    const caller = await requireBusinessUser(uid, true)
    const liquidId = String(request.data?.liquidId || '')
    if (!liquidId) throw new HttpsError('invalid-argument', 'Líquido requerido.')

    const liquidRef = db.doc(`businesses/${caller.businessId}/liquids/${liquidId}`)
    const sessionRef = db.collection(`businesses/${caller.businessId}/liquid_sessions`).doc()
    const carryRef = db.collection(`businesses/${caller.businessId}/liquid_sessions`).doc()
    const eventRef = db.collection(`businesses/${caller.businessId}/liquid_events`).doc()

    const result = await db.runTransaction(async transaction => {
      const snap = await transaction.get(liquidRef)
      if (!snap.exists) throw new HttpsError('not-found', 'Líquido no encontrado.')
      const liquid = snap.data()!
      const closedBottles = Math.max(0, Math.floor(asNumber(liquid.closedBottles)))
      if (closedBottles < 1) throw new HttpsError('failed-precondition', 'No quedan frascos cerrados.')

      const perBottleCapacity = Math.max(1, asNumber(liquid.activeCapacity, asNumber(liquid.sizeML, 100)))
      const previousBalance = Math.max(0, asNumber(liquid.activeSaldo))
      const legacyCount = previousBalance > 0 ? Math.max(1, Math.ceil(previousBalance / perBottleCapacity)) : 0
      const previousCount = previousBalance > 0
        ? Math.max(legacyCount, Math.floor(asNumber(liquid.openBottleCount, legacyCount)))
        : 0
      if (previousCount >= 3) throw new HttpsError('failed-precondition', 'Ya hay tres frascos abiertos para este líquido.')

      const previousSessionIds = Array.isArray(liquid.activeSessionIds) ? liquid.activeSessionIds.map(String) : []
      const activeSessionIds = [...previousSessionIds]
      if (previousBalance > 0 && activeSessionIds.length === 0) {
        activeSessionIds.push(carryRef.id)
        transaction.set(carryRef, {
          liquidId, liquidName: liquid.name || '', source: 'legacy-balance',
          capacity: previousCount * perBottleCapacity, remaining: previousBalance,
          status: 'active', openedBy: uid, openedAt: FieldValue.serverTimestamp(),
        })
      }
      activeSessionIds.push(sessionRef.id)

      const openBottleCount = previousCount + 1
      const activeSaldo = previousBalance + perBottleCapacity
      const activeTotalCapacity = openBottleCount * perBottleCapacity
      transaction.set(sessionRef, {
        liquidId, liquidName: liquid.name || '', source: 'sealed-bottle',
        capacity: perBottleCapacity, remaining: perBottleCapacity,
        status: 'active', openedBy: uid, openedAt: FieldValue.serverTimestamp(),
      })
      transaction.update(liquidRef, {
        closedBottles: closedBottles - 1,
        hasActive: true,
        activeSaldo,
        openBottleCount,
        activeTotalCapacity,
        activeSessionIds,
        totalOpenedBottles: asNumber(liquid.totalOpenedBottles) + 1,
        totalOpenedCapacity: asNumber(liquid.totalOpenedCapacity) + perBottleCapacity,
        activeOpenedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      transaction.set(eventRef, {
        type: 'OPEN_BOTTLE', liquidId, liquidName: liquid.name || '',
        userId: uid, userName: caller.displayName || '',
        previousBalance, newBalance: activeSaldo, addedCapacity: perBottleCapacity,
        openBottleCount, createdAt: FieldValue.serverTimestamp(),
      })
      return { closedBottles: closedBottles - 1, hasActive: true, activeSaldo, openBottleCount, activeTotalCapacity, activeSessionIds }
    })
    return { success: true, liquid: result }
  }
)

export const adjustLiquidBalance = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')
    const uid = request.auth.uid
    const caller = await requireBusinessUser(uid, true)
    const liquidId = String(request.data?.liquidId || '')
    const reason = String(request.data?.reason || '').trim().slice(0, 300)
    const requestedBalance = asNumber(request.data?.newBalance, Number.NaN)
    if (!liquidId || !reason || !Number.isFinite(requestedBalance)) {
      throw new HttpsError('invalid-argument', 'Líquido, saldo y motivo son obligatorios.')
    }
    const liquidRef = db.doc(`businesses/${caller.businessId}/liquids/${liquidId}`)
    const eventRef = db.collection(`businesses/${caller.businessId}/liquid_events`).doc()
    const result = await db.runTransaction(async transaction => {
      const snap = await transaction.get(liquidRef)
      if (!snap.exists) throw new HttpsError('not-found', 'Líquido no encontrado.')
      const liquid = snap.data()!
      const perBottleCapacity = Math.max(1, asNumber(liquid.activeCapacity, asNumber(liquid.sizeML, 100)))
      const previousBalance = Math.max(0, asNumber(liquid.activeSaldo))
      const openBottleCount = previousBalance > 0
        ? Math.max(1, Math.floor(asNumber(liquid.openBottleCount, 1)))
        : Math.max(0, Math.floor(asNumber(liquid.openBottleCount)))
      const totalCapacity = Math.max(perBottleCapacity, asNumber(liquid.activeTotalCapacity, openBottleCount * perBottleCapacity))
      if (requestedBalance < 0 || requestedBalance > totalCapacity) {
        throw new HttpsError('invalid-argument', `El saldo debe estar entre 0 y ${totalCapacity} ml.`)
      }
      const isEmpty = requestedBalance === 0
      const update = {
        activeSaldo: requestedBalance,
        hasActive: !isEmpty,
        openBottleCount: isEmpty ? 0 : Math.max(1, openBottleCount),
        activeTotalCapacity: isEmpty ? 0 : totalCapacity,
        activeSessionIds: isEmpty ? [] : (Array.isArray(liquid.activeSessionIds) ? liquid.activeSessionIds : []),
        updatedAt: FieldValue.serverTimestamp(),
      }
      transaction.update(liquidRef, update)
      transaction.set(eventRef, {
        type: requestedBalance < previousBalance ? 'LOSS_ADJUSTMENT' : 'BALANCE_CORRECTION',
        liquidId, liquidName: liquid.name || '', reason,
        userId: uid, userName: caller.displayName || '',
        previousBalance, newBalance: requestedBalance,
        difference: requestedBalance - previousBalance,
        createdAt: FieldValue.serverTimestamp(),
      })
      return update
    })
    return { success: true, liquid: result }
  }
)

// Registra venta, inventario, saldo de líquidos, caja y cliente en una sola
// transacción. Un saleId repetido es idempotente y no descuenta dos veces.
export const commitSale = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')
    const uid = request.auth.uid
    const caller = await requireBusinessUser(uid)
    if (caller.permissions?.pos === false) throw new HttpsError('permission-denied', 'No tienes permiso para realizar ventas.')

    const sale = request.data?.sale as Record<string, any>
    if (!sale || String(sale.userId || '') !== uid || !String(sale.id || '')) {
      throw new HttpsError('invalid-argument', 'Venta inválida.')
    }
    if (asNumber(sale.total, -1) < 0 || (sale.items?.length || 0) > 200 || (sale.refills?.length || 0) > 200) {
      throw new HttpsError('invalid-argument', 'Contenido de venta inválido.')
    }

    const businessId = caller.businessId
    const saleId = String(sale.id).slice(0, 160)
    const saleRef = db.doc(`businesses/${businessId}/sales/${saleId}`)
    const productLines = Array.isArray(sale.items) ? sale.items : []
    const refillLines = Array.isArray(sale.refills) ? sale.refills : []
    const bottleLines = Array.isArray(sale.bottleSales) ? sale.bottleSales : []
    const productIds = [...new Set(productLines.map((line: any) => String(line.productId || '')).filter(Boolean))]
    const liquidIds = [...new Set([...refillLines, ...bottleLines].map((line: any) => String(line.liquidId || '')).filter(Boolean))]
    const productRefs = productIds.map(id => db.doc(`businesses/${businessId}/products/${id}`))
    const liquidRefs = liquidIds.map(id => db.doc(`businesses/${businessId}/liquids/${id}`))
    const cashSessionId = String(request.data?.cashSessionId || '')
    const cashRef = cashSessionId ? db.doc(`businesses/${businessId}/cash_sessions/${cashSessionId}`) : null
    const customerId = sale.customerId ? String(sale.customerId) : ''
    const customerRef = customerId ? db.doc(`businesses/${businessId}/customers/${customerId}`) : null
    const fiscalInvoice = request.data?.fiscalInvoice || null

    const transactionResult = await db.runTransaction(async transaction => {
      const [saleSnap, productSnaps, liquidSnaps, cashSnap, customerSnap] = await Promise.all([
        transaction.get(saleRef),
        Promise.all(productRefs.map(ref => transaction.get(ref))),
        Promise.all(liquidRefs.map(ref => transaction.get(ref))),
        cashRef ? transaction.get(cashRef) : Promise.resolve(null),
        customerRef ? transaction.get(customerRef) : Promise.resolve(null),
      ])
      if (saleSnap.exists) return { duplicate: true }
      if (cashRef && (!cashSnap?.exists || cashSnap.data()?.open !== true)) {
        throw new HttpsError('failed-precondition', 'La caja debe estar abierta para completar la venta.')
      }

      const products = new Map(productSnaps.map(snap => [snap.id, snap]))
      const liquids = new Map(liquidSnaps.map(snap => [snap.id, snap]))
      const sessionIds = [...new Set(liquidSnaps.flatMap(snap => {
        const ids = snap.data()?.activeSessionIds
        return Array.isArray(ids) ? ids.map(String) : []
      }))]
      const sessionSnaps = await Promise.all(sessionIds.map(id =>
        transaction.get(db.doc(`businesses/${businessId}/liquid_sessions/${id}`))))
      const sessions = new Map(sessionSnaps.map(snap => [snap.id, snap]))
      for (const line of productLines) {
        const snap = products.get(String(line.productId))
        const qty = Math.max(1, Math.floor(asNumber(line.qty, 1)))
        if (!snap?.exists || asNumber(snap.data()?.stock) < qty) {
          throw new HttpsError('failed-precondition', `Stock insuficiente para ${line.name || 'un producto'}.`)
        }
        transaction.update(snap.ref, { stock: asNumber(snap.data()?.stock) - qty, updatedAt: FieldValue.serverTimestamp() })
      }

      for (const liquidId of liquidIds) {
        const snap = liquids.get(liquidId)
        if (!snap?.exists) throw new HttpsError('not-found', 'Uno de los líquidos ya no existe.')
        const liquid = snap.data()!
        let activeSaldo = Math.max(0, asNumber(liquid.activeSaldo))
        let closedBottles = Math.max(0, Math.floor(asNumber(liquid.closedBottles)))
        let halfBottleStock = Math.max(0, Math.floor(asNumber(liquid.halfBottleStock)))
        let refillCount = 0
        let refillRevenue = 0
        let consumedPoints = 0
        for (const line of refillLines.filter((item: any) => String(item.liquidId) === liquidId)) {
          const points = Math.max(0, asNumber(line.pointsConsumed))
          if (points <= 0 || activeSaldo < points) {
            throw new HttpsError('failed-precondition', `Saldo insuficiente para ${liquid.name || 'un líquido'}.`)
          }
          activeSaldo -= points
          consumedPoints += points
          refillCount += 1
          refillRevenue += Math.max(0, asNumber(line.price))
        }
        for (const line of bottleLines.filter((item: any) => String(item.liquidId) === liquidId)) {
          const qty = Math.max(1, Math.floor(asNumber(line.qty, 1)))
          for (let index = 0; index < qty; index += 1) {
            if (line.isHalf === true) {
              if (halfBottleStock > 0) halfBottleStock -= 1
              else {
                if (closedBottles < 1) throw new HttpsError('failed-precondition', `No quedan frascos de ${liquid.name || 'líquido'}.`)
                closedBottles -= 1
                halfBottleStock += 1
              }
            } else {
              if (closedBottles < 1) throw new HttpsError('failed-precondition', `No quedan frascos de ${liquid.name || 'líquido'}.`)
              closedBottles -= 1
            }
          }
        }
        const update: Record<string, any> = {
          activeSaldo, closedBottles, halfBottleStock,
          hasActive: activeSaldo > 0,
          totalRechargesAllTime: asNumber(liquid.totalRechargesAllTime) + refillCount,
          totalRevenueAllTime: asNumber(liquid.totalRevenueAllTime) + refillRevenue,
          totalPointsConsumedAllTime: asNumber(liquid.totalPointsConsumedAllTime) + consumedPoints,
          updatedAt: FieldValue.serverTimestamp(),
        }
        if (consumedPoints > 0 && Array.isArray(liquid.activeSessionIds)) {
          let pending = consumedPoints
          const remainingIds: string[] = []
          let remainingCapacity = 0
          for (const sessionId of liquid.activeSessionIds.map(String)) {
            const sessionSnap = sessions.get(sessionId)
            if (!sessionSnap?.exists) continue
            const session = sessionSnap.data()!
            const previousRemaining = Math.max(0, asNumber(session.remaining))
            const used = Math.min(previousRemaining, pending)
            const remaining = previousRemaining - used
            pending -= used
            transaction.update(sessionSnap.ref, {
              remaining,
              status: remaining > 0 ? 'active' : 'depleted',
              depletedAt: remaining > 0 ? null : FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            })
            if (remaining > 0) {
              remainingIds.push(sessionId)
              remainingCapacity += Math.max(0, asNumber(session.capacity))
            }
          }
          update.activeSessionIds = remainingIds
          update.openBottleCount = remainingIds.length
          update.activeTotalCapacity = remainingCapacity
        }
        if (activeSaldo === 0) {
          update.openBottleCount = 0
          update.activeTotalCapacity = 0
          update.activeSessionIds = []
        }
        transaction.update(snap.ref, update)
        transaction.set(db.collection(`businesses/${businessId}/liquid_events`).doc(), {
          type: 'SALE_CONSUMPTION', saleId, liquidId, liquidName: liquid.name || '',
          refillCount, consumed: refillLines.filter((item: any) => String(item.liquidId) === liquidId)
            .reduce((sum: number, item: any) => sum + asNumber(item.pointsConsumed), 0),
          userId: uid, userName: caller.displayName || '',
          createdAt: FieldValue.serverTimestamp(),
        })
      }

      const cleanSale: Record<string, any> = { ...sale, businessId, userId: uid,
        user: caller.displayName || sale.user || '', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
      delete cleanSale.id
      transaction.set(saleRef, cleanSale)

      if (cashRef && cashSnap?.exists) {
        const paid = Math.max(0, asNumber(sale.amountReceived, asNumber(sale.total)) - Math.max(0, asNumber(sale.change)))
        transaction.update(cashRef, {
          salePayments: asNumber(cashSnap.data()?.salePayments) + paid,
          sales: asNumber(cashSnap.data()?.sales) + paid,
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      if (customerRef && customerSnap?.exists) {
        const customer = customerSnap.data()!
        transaction.update(customerRef, {
          creditBalance: Math.max(0, asNumber(customer.creditBalance) + asNumber(sale.creditAdded)),
          totalSpent: Math.max(0, asNumber(customer.totalSpent) + asNumber(sale.total)),
          totalTransactions: asNumber(customer.totalTransactions) + 1,
          lastPurchase: sale.date || new Date().toISOString().slice(0, 10),
          refillRewards: Math.max(0, asNumber(customer.refillRewards) - (sale.freeRefillRedeemed ? 4 : 0)) + asNumber(sale.refillRewardsEarned),
          totalRefills: Math.max(0, asNumber(customer.totalRefills) - (sale.freeRefillRedeemed ? 4 : 0)) + asNumber(sale.refillRewardsEarned),
          rewardPoints: Math.max(0, asNumber(customer.rewardPoints) - asNumber(sale.pointsRedeemed)) + asNumber(sale.rewardPointsEarned),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      if (fiscalInvoice?.id) {
        const invoiceRef = db.doc(`businesses/${businessId}/fiscalInvoices/${String(fiscalInvoice.id)}`)
        transaction.set(invoiceRef, { ...fiscalInvoice, businessId, userId: uid, createdAt: FieldValue.serverTimestamp() })
      }
      return { duplicate: false }
    })
    return { success: true, ...transactionResult }
  }
)

// ── Validadores ───────────────────────────────────────────────
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
function validatePassword(pwd: string): boolean {
  return typeof pwd === 'string' && pwd.length >= 8 && pwd.length <= 128
}

async function enforceRegistrationRateLimit(request: any): Promise<void> {
  const ip = String(request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || 'unknown')
    .split(',')[0].trim()
  const fingerprint = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)
  const windowId = Math.floor(Date.now() / 3_600_000)
  const ref = db.doc(`_security_rate_limits/register_${fingerprint}_${windowId}`)
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const count = Number(snap.data()?.count || 0)
    if (count >= 3) throw new HttpsError('resource-exhausted', 'Demasiados registros. Intenta nuevamente más tarde.')
    tx.set(ref, { count: count + 1, windowId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

// ══════════════════════════════════════════════════════════════
// 1. registerBusiness
// ══════════════════════════════════════════════════════════════
export const registerBusiness = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    const data = request.data as {
      email: string
      password: string
      ownerName: string
      businessName: string
      phone?: string
      address?: string
      currency?: string
    }

    if (!data.email || !validateEmail(data.email)) {
      throw new HttpsError('invalid-argument', 'Correo electrónico inválido.')
    }
    if (!validatePassword(data.password)) {
      throw new HttpsError('invalid-argument', 'La contraseña debe tener entre 8 y 128 caracteres.')
    }
    if (!data.ownerName || data.ownerName.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'El nombre del propietario es requerido.')
    }
    if (!data.businessName || data.businessName.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'El nombre del negocio es requerido.')
    }
    if (data.ownerName.trim().length > 100 || data.businessName.trim().length > 120
      || String(data.phone || '').length > 30 || String(data.address || '').length > 300) {
      throw new HttpsError('invalid-argument', 'Uno de los campos supera el tamaño permitido.')
    }

    await enforceRegistrationRateLimit(request)

    const now = FieldValue.serverTimestamp()

    let createdUid: string | null = null
    try {
      const authUser = await auth.createUser({
        email: data.email.trim().toLowerCase(),
        password: data.password,
        displayName: data.ownerName.trim(),
      })
      const uid = authUser.uid
      createdUid = uid

      const bizRef = db.collection('businesses').doc()
      const businessId = bizRef.id

      const defaultSettings = {
        businessName: data.businessName.trim(),
        phone: data.phone?.trim() || '',
        address: data.address?.trim() || '',
        currency: data.currency || 'RD$',
        taxRate: 18,
        defaultPointsR50: 10,
        defaultPointsR100: 20,
        defaultPointsR150: 30,
        defaultBottleCapacity: 100,
        lowStockThreshold: 5,
        lowBottleAlert: 10,
        invoiceHeader: `VapePOS — ${data.businessName.trim()}`,
        invoiceFooter: '¡Gracias por su compra! Vuelva pronto.',
        updatedAt: now,
      }

      const batch = db.batch()

      batch.set(bizRef, {
        name: data.businessName.trim(),
        phone: data.phone?.trim() || '',
        address: data.address?.trim() || '',
        ownerId: uid,
        plan: 'starter',
        active: false,
        activationPending: true,
        activationRequestedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      batch.set(db.doc(`businesses/${businessId}/settings/config`), defaultSettings)

      batch.set(db.doc(`users/${uid}`), {
        businessId,
        role: 'Administrador',
        active: false,
        activationPending: true,
        email: data.email.trim().toLowerCase(),
        displayName: data.ownerName.trim(),
        createdAt: now,
        updatedAt: now,
      })

      batch.set(db.doc(`businesses/${businessId}/users/${uid}`), {
        uid,
        businessId,
        role: 'Administrador',
        active: false,
        activationPending: true,
        email: data.email.trim().toLowerCase(),
        displayName: data.ownerName.trim(),
        createdAt: now,
        updatedAt: now,
      })

      await batch.commit()

      await setAccessClaims(uid, businessId, 'Administrador', false)

      await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: 'REGISTER_BUSINESS',
        module: 'system',
        userId: uid,
        userName: data.ownerName.trim(),
        role: 'Administrador',
        targetId: businessId,
        targetName: data.businessName.trim(),
        before: null,
        after: { businessName: data.businessName.trim(), plan: 'starter', activationPending: true },
        businessId,
        createdAt: now,
      })

      return { success: true, businessId, uid, activationPending: true }
    } catch (err: any) {
      if (createdUid) await auth.deleteUser(createdUid).catch(() => undefined)
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Ya existe una cuenta con ese correo.')
      }
      throw new HttpsError('internal', `Error al crear el negocio: ${err.message}`)
    }
  }
)

// ══════════════════════════════════════════════════════════════
// 2. addEmployeeToStore
// ══════════════════════════════════════════════════════════════
export const addEmployeeToStore = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.')
    }

    const data = request.data as {
      email: string
      password: string
      displayName: string
      role: 'Cajero' | 'Encargado'
    }

    const callerUid = request.auth.uid
    const callerProfile = await db.doc(`users/${callerUid}`).get()

    if (!callerProfile.exists || callerProfile.data()?.role !== 'Administrador') {
      throw new HttpsError('permission-denied', 'Solo el administrador puede agregar empleados.')
    }

    const businessId = callerProfile.data()?.businessId
    if (!businessId) {
      throw new HttpsError('failed-precondition', 'Negocio no encontrado.')
    }

    if (!['Cajero', 'Encargado'].includes(data.role)) {
      throw new HttpsError('invalid-argument', 'Rol inválido.')
    }
    if (!validateEmail(data.email)) {
      throw new HttpsError('invalid-argument', 'Correo inválido.')
    }
    if (!validatePassword(data.password)) {
      throw new HttpsError('invalid-argument', 'Contraseña muy corta.')
    }

    const now = FieldValue.serverTimestamp()

    try {
      const newUser = await auth.createUser({
        email: data.email.trim().toLowerCase(),
        password: data.password,
        displayName: data.displayName.trim(),
      })
      const newUid = newUser.uid

      const batch = db.batch()

      batch.set(db.doc(`users/${newUid}`), {
        businessId,
        role: data.role,
        active: true,
        email: data.email.trim().toLowerCase(),
        displayName: data.displayName.trim(),
        createdAt: now,
        updatedAt: now,
      })

      batch.set(db.doc(`businesses/${businessId}/users/${newUid}`), {
        uid: newUid,
        businessId,
        role: data.role,
        active: true,
        email: data.email.trim().toLowerCase(),
        displayName: data.displayName.trim(),
        createdAt: now,
        updatedAt: now,
      })

      await batch.commit()

      await setAccessClaims(newUid, businessId, data.role, true)

      return { success: true, uid: newUid }
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Ya existe una cuenta con ese correo.')
      }
      throw new HttpsError('internal', err.message)
    }
  }
)

// ══════════════════════════════════════════════════════════════
// 3. updateUserRole
// ══════════════════════════════════════════════════════════════
export const updateUserRole = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'No autenticado.')
    }

    const data = request.data as { targetUid: string; newRole: string }

    const callerUid = request.auth.uid
    const callerProfile = await db.doc(`users/${callerUid}`).get()

    if (!callerProfile.exists || callerProfile.data()?.role !== 'Administrador') {
      throw new HttpsError('permission-denied', 'Solo el administrador puede cambiar roles.')
    }

    const businessId = callerProfile.data()?.businessId

    if (data.targetUid === callerUid) {
      throw new HttpsError('invalid-argument', 'No puedes cambiar tu propio rol.')
    }

    if (!['Cajero', 'Encargado', 'Administrador'].includes(data.newRole)) {
      throw new HttpsError('invalid-argument', 'Rol inválido.')
    }

    const targetProfile = await db.doc(`users/${data.targetUid}`).get()
    if (!targetProfile.exists || targetProfile.data()?.businessId !== businessId) {
      throw new HttpsError('not-found', 'Usuario no pertenece a este negocio.')
    }

    const now = FieldValue.serverTimestamp()

    await db.doc(`users/${data.targetUid}`).update({ role: data.newRole, updatedAt: now })
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).update({ role: data.newRole, updatedAt: now })
    await setAccessClaims(data.targetUid, businessId, data.newRole, targetProfile.data()?.active === true)

    return { success: true }
  }
)

// Recuperación segura: un usuario activo puede asumir Administración solamente
// cuando su negocio no conserva ningún administrador activo.
export const claimVacantAdmin = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const callerUid = request.auth.uid
    const callerRef = db.doc(`users/${callerUid}`)
    const callerSnap = await callerRef.get()
    const caller = callerSnap.data()
    const businessId = caller?.businessId

    if (!callerSnap.exists || caller?.active !== true || !businessId) {
      throw new HttpsError('permission-denied', 'Usuario activo no válido.')
    }

    const businessUsers = await db.collection(`businesses/${businessId}/users`).get()
    const hasActiveAdmin = businessUsers.docs.some(doc => {
      const user = doc.data()
      return user.active === true && user.role === 'Administrador'
    })
    if (hasActiveAdmin) {
      throw new HttpsError('failed-precondition', 'El negocio ya tiene un administrador activo.')
    }

    const now = FieldValue.serverTimestamp()
    const businessUserRef = db.doc(`businesses/${businessId}/users/${callerUid}`)
    const batch = db.batch()
    batch.update(callerRef, { role: 'Administrador', permissions: null, updatedAt: now })
    batch.set(businessUserRef, { role: 'Administrador', permissions: null, active: true, updatedAt: now }, { merge: true })
    await batch.commit()
    await setAccessClaims(callerUid, businessId, 'Administrador', true)

    await db.collection(`businesses/${businessId}/audit_logs`).add({
      action: 'CLAIM_VACANT_ADMIN',
      module: 'users',
      userId: callerUid,
      userName: caller.displayName || caller.email || 'Usuario',
      role: 'Administrador',
      targetId: callerUid,
      targetName: caller.displayName || caller.email || callerUid,
      before: { role: caller.role },
      after: { role: 'Administrador' },
      businessId,
      createdAt: now,
    })

    return { success: true }
  }
)

// Genera un mes de historial ficticio exclusivamente para la cuenta demo.
// Es idempotente: el mismo lote no puede generarse dos veces.
export const generateDemoMonth = onCall(
  { region: 'us-central1', enforceAppCheck: true, timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const profileSnap = await db.doc(`users/${request.auth.uid}`).get()
    const profile = profileSnap.data()
    const businessId = profile?.businessId
    const email = String(profile?.email || request.auth.token.email || '').toLowerCase()
    if (!profileSnap.exists || profile?.active !== true || profile?.role !== 'Administrador' || !businessId) {
      throw new HttpsError('permission-denied', 'Solo el administrador activo puede generar datos demo.')
    }
    if (email !== 'test01@gmail.com') {
      throw new HttpsError('permission-denied', 'Esta herramienta está limitada a la cuenta demostrativa.')
    }

    const salesRef = db.collection(`businesses/${businessId}/sales`)
    const existingDemo = await salesRef.where('demoBatchId', '==', 'demo-month-v1').limit(1).get()
    if (!existingDemo.empty) {
      throw new HttpsError('already-exists', 'El mes demostrativo ya fue generado.')
    }

    const [productsSnap, customersSnap, existingSalesSnap, settingsSnap] = await Promise.all([
      db.collection(`businesses/${businessId}/products`).where('active', '==', true).get(),
      db.collection(`businesses/${businessId}/customers`).get(),
      salesRef.get(),
      db.doc(`businesses/${businessId}/settings/config`).get(),
    ])
    const products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))
    const customers = customersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any))
    if (!products.length) throw new HttpsError('failed-precondition', 'La cuenta demo necesita productos antes de generar ventas.')

    const prefix = String(settingsSnap.data()?.invoicePrefix || 'VPS')
    let counter = existingSalesSnap.docs.reduce((max, doc) => {
      const value = Number(String(doc.data().saleNumber || '').split('-').pop())
      return Number.isFinite(value) ? Math.max(max, value) : max
    }, 0)
    const taxRate = asNumber(settingsSnap.data()?.taxRate, 18)
    const payments = ['Efectivo', 'Transferencia', 'Tarjeta']
    const customerTotals = new Map<string, { spent: number; transactions: number; lastPurchase: string }>()
    const batch = db.batch()
    let created = 0
    let revenue = 0

    const today = new Date()
    today.setUTCHours(12, 0, 0, 0)
    for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
      const date = new Date(today)
      date.setUTCDate(today.getUTCDate() - daysAgo)
      const dateStr = date.toISOString().slice(0, 10)
      const weekday = date.getUTCDay()
      const dailyCount = weekday === 0 ? 2 : weekday === 5 || weekday === 6 ? 5 : 3 + (daysAgo % 2)

      for (let saleIndex = 0; saleIndex < dailyCount; saleIndex += 1) {
        const product = products[(daysAgo * 3 + saleIndex * 2) % products.length]
        const secondProduct = products[(daysAgo + saleIndex + 5) % products.length]
        const qty = 1 + ((daysAgo + saleIndex) % 2)
        const items = [{
          productId: product.id,
          name: product.name,
          qty,
          price: asNumber(product.price),
          cost: asNumber(product.cost),
          taxIncluded: false,
        }]
        if ((daysAgo + saleIndex) % 3 === 0 && secondProduct.id !== product.id) {
          items.push({
            productId: secondProduct.id,
            name: secondProduct.name,
            qty: 1,
            price: asNumber(secondProduct.price),
            cost: asNumber(secondProduct.cost),
            taxIncluded: false,
          })
        }

        const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0)
        const tax = Math.round(subtotal * taxRate / 100)
        const total = subtotal + tax
        const profit = items.reduce((sum, item) => sum + (item.price - item.cost) * item.qty, 0)
        const customer = customers.length && (daysAgo + saleIndex) % 4 !== 0
          ? customers[(daysAgo + saleIndex) % customers.length]
          : null
        counter += 1
        created += 1
        revenue += total
        const hour = 10 + ((daysAgo + saleIndex * 2) % 10)
        const minute = (daysAgo * 7 + saleIndex * 13) % 60
        const createdDate = new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-04:00`)
        const saleId = `demo_${dateStr.replace(/-/g, '')}_${saleIndex + 1}`
        const sale = {
          saleNumber: `${prefix}-${String(counter).padStart(3, '0')}`,
          date: dateStr,
          time: createdDate.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santo_Domingo' }),
          user: profile.displayName || 'mario',
          userId: request.auth.uid,
          customerId: customer?.id || null,
          customerName: customer?.name || null,
          customerRnc: customer?.rnc || null,
          items,
          refills: [],
          bottleSales: [],
          services: [],
          discounts: [],
          subtotal,
          tax,
          discountTotal: 0,
          total,
          fiscal: null,
          payment: payments[(daysAgo + saleIndex) % payments.length],
          amountReceived: total,
          change: 0,
          creditAdded: 0,
          creditPreviousBalance: 0,
          refillRewardsEarned: 0,
          freeRefillRedeemed: false,
          pointsRedeemed: 0,
          rewardPointsEarned: Math.floor(total / 50),
          profit,
          notes: 'Venta ficticia para demostración',
          demoData: true,
          demoBatchId: 'demo-month-v1',
          businessId,
          createdAt: Timestamp.fromDate(createdDate),
          updatedAt: Timestamp.fromDate(createdDate),
        }
        batch.set(salesRef.doc(saleId), sale)

        if (customer) {
          const current = customerTotals.get(customer.id) || { spent: 0, transactions: 0, lastPurchase: '' }
          current.spent += total
          current.transactions += 1
          if (dateStr > current.lastPurchase) current.lastPurchase = dateStr
          customerTotals.set(customer.id, current)
        }
      }
    }

    for (const [customerId, totals] of customerTotals) {
      batch.update(db.doc(`businesses/${businessId}/customers/${customerId}`), {
        totalSpent: FieldValue.increment(totals.spent),
        totalTransactions: FieldValue.increment(totals.transactions),
        rewardPoints: FieldValue.increment(Math.floor(totals.spent / 50)),
        lastPurchase: totals.lastPurchase,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    await batch.commit()

    await db.collection(`businesses/${businessId}/audit_logs`).add({
      action: 'GENERATE_DEMO_MONTH',
      module: 'sales',
      userId: request.auth.uid,
      userName: profile.displayName || profile.email || 'Administrador',
      role: profile.role,
      targetId: 'demo-month-v1',
      targetName: `${created} ventas demo`,
      before: null,
      after: { created, revenue },
      businessId,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { success: true, created, revenue }
  }
)

// Permisos granulares: solo el administrador del mismo negocio puede cambiarlos.
export const updateUserPermissions = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const { targetUid, permissions } = request.data as {
      targetUid: string
      permissions: Record<string, boolean | string>
    }
    if (!targetUid || !permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
      throw new HttpsError('invalid-argument', 'Permisos inválidos.')
    }

    const callerProfile = await db.doc(`users/${request.auth.uid}`).get()
    const businessId = callerProfile.data()?.businessId
    if (!callerProfile.exists || callerProfile.data()?.active !== true || callerProfile.data()?.role !== 'Administrador' || !businessId) {
      throw new HttpsError('permission-denied', 'Solo el administrador puede cambiar permisos.')
    }

    const targetProfile = await db.doc(`users/${targetUid}`).get()
    if (!targetProfile.exists || targetProfile.data()?.businessId !== businessId || targetProfile.data()?.role === 'Administrador') {
      throw new HttpsError('permission-denied', 'Usuario no permitido.')
    }

    const booleanKeys = [
      'dashboard', 'pos', 'refills', 'inventory', 'purchases', 'customers',
      'suppliers', 'reports', 'cash', 'users', 'settings', 'suggestions',
      'insights', 'viewProfit', 'deleteInvoice', 'editInvoice',
      'viewRendimiento', 'deleteProduct', 'manageUsers',
    ]
    const clean: Record<string, boolean | string> = {}
    for (const key of booleanKeys) {
      if (typeof permissions[key] === 'boolean') clean[key] = permissions[key]
    }
    if (['all', 'active', 'active+hist'].includes(String(permissions.refillsTabs))) {
      clean.refillsTabs = String(permissions.refillsTabs)
    }

    const update = { permissions: clean, updatedAt: FieldValue.serverTimestamp() }
    const batch = db.batch()
    batch.update(db.doc(`users/${targetUid}`), update)
    batch.update(db.doc(`businesses/${businessId}/users/${targetUid}`), update)
    await batch.commit()
    return { success: true, permissions: clean }
  }
)

// ══════════════════════════════════════════════════════════════
// 4. deactivateUser
// ══════════════════════════════════════════════════════════════
export const deactivateUser = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'No autenticado.')
    }

    const data = request.data as { targetUid: string }

    const callerUid = request.auth.uid
    const callerProfile = await db.doc(`users/${callerUid}`).get()

    if (!callerProfile.exists || callerProfile.data()?.role !== 'Administrador') {
      throw new HttpsError('permission-denied', 'Solo el administrador puede desactivar usuarios.')
    }

    const businessId = callerProfile.data()?.businessId

    if (data.targetUid === callerUid) {
      throw new HttpsError('invalid-argument', 'No puedes desactivarte a ti mismo.')
    }

    const targetProfile = await db.doc(`users/${data.targetUid}`).get()
    if (!targetProfile.exists || targetProfile.data()?.businessId !== businessId) {
      throw new HttpsError('not-found', 'Usuario no pertenece a este negocio.')
    }

    const now = FieldValue.serverTimestamp()

    await auth.updateUser(data.targetUid, { disabled: true })
    await setAccessClaims(data.targetUid, businessId, String(targetProfile.data()?.role || ''), false)
    await db.doc(`users/${data.targetUid}`).update({ active: false, updatedAt: now })
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).update({ active: false, updatedAt: now })

    return { success: true }
  }
)

// ══════════════════════════════════════════════════════════════
// 5. auditOnSaleDelete (trigger)
// ══════════════════════════════════════════════════════════════
export const auditOnSaleDelete = onDocumentDeleted(
  {
    document: 'businesses/{businessId}/sales/{saleId}',
    region: 'us-central1',
  },
  async (event) => {
    const { businessId, saleId } = event.params
    const deletedSale = event.data?.data()

    await db.collection(`businesses/${businessId}/audit_logs`).add({
      action: 'DELETE_SALE',
      module: 'sales',
      userId: deletedSale?.userId || 'unknown',
      userName: 'Sistema (trigger)',
      role: 'system',
      targetId: saleId,
      targetName: deletedSale?.saleNumber || saleId,
      before: deletedSale || null,
      after: null,
      businessId,
      createdAt: FieldValue.serverTimestamp(),
    })
  }
)

// ══════════════════════════════════════════════════════════════
// 6. deleteUser — Admin elimina un usuario completamente
// ══════════════════════════════════════════════════════════════
export const deleteUser = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'No autenticado.')
    }

    const data = request.data as { targetUid: string }
    const callerUid = request.auth.uid
    const callerProfile = await db.doc(`users/${callerUid}`).get()

    if (!callerProfile.exists || callerProfile.data()?.role !== 'Administrador') {
      throw new HttpsError('permission-denied', 'Solo el administrador puede eliminar usuarios.')
    }

    const businessId = callerProfile.data()?.businessId

    if (data.targetUid === callerUid) {
      throw new HttpsError('invalid-argument', 'No puedes eliminarte a ti mismo.')
    }

    const targetProfile = await db.doc(`users/${data.targetUid}`).get()
    if (!targetProfile.exists || targetProfile.data()?.businessId !== businessId) {
      throw new HttpsError('not-found', 'Usuario no pertenece a este negocio.')
    }

    const now = FieldValue.serverTimestamp()

    await auth.deleteUser(data.targetUid)
    await db.doc(`users/${data.targetUid}`).delete()
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).delete()

    await db.collection(`businesses/${businessId}/audit_logs`).add({
      action: 'DELETE_USER',
      module: 'users',
      userId: callerUid,
      userName: callerProfile.data()?.displayName || 'Admin',
      role: 'Administrador',
      targetId: data.targetUid,
      targetName: targetProfile.data()?.displayName || data.targetUid,
      before: { role: targetProfile.data()?.role, email: targetProfile.data()?.email },
      after: null,
      businessId,
      createdAt: now,
    })

    return { success: true }
  }
)

// ══════════════════════════════════════════════════════════════
// 7. activateTrial — prueba Pro gratuita de 30 días, una vez por negocio
// ══════════════════════════════════════════════════════════════
export const activateTrial = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const profile = await db.doc(`users/${request.auth.uid}`).get()
    const profileData = profile.data()
    if (!profile.exists || profileData?.active !== true || profileData?.role !== 'Administrador') {
      throw new HttpsError('permission-denied', 'Solo el administrador activo puede activar la prueba.')
    }

    const businessId = profileData.businessId
    if (!businessId) throw new HttpsError('failed-precondition', 'Negocio no encontrado.')

    const businessRef = db.doc(`businesses/${businessId}`)
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + 30)

    await db.runTransaction(async transaction => {
      const business = await transaction.get(businessRef)
      if (!business.exists) throw new HttpsError('not-found', 'Negocio no encontrado.')
      if (business.data()?.trialUsed === true) {
        throw new HttpsError('failed-precondition', 'Este negocio ya utilizó su prueba gratuita.')
      }
      transaction.update(businessRef, {
        plan: 'pro',
        planExpiresAt: expiresAt,
        planActivatedAt: now,
        trialUsed: true,
        trialStartedAt: now,
        degradedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    const [products, customers, users] = await Promise.all([
      db.collection(`businesses/${businessId}/products`).where('planLocked', '==', true).get(),
      db.collection(`businesses/${businessId}/customers`).where('planLocked', '==', true).get(),
      db.collection(`businesses/${businessId}/users`).where('planLocked', '==', true).get(),
    ])

    const writer = db.bulkWriter()
    const unlockedAt = FieldValue.serverTimestamp()
    for (const item of products.docs) writer.update(item.ref, { planLocked: false, updatedAt: unlockedAt })
    for (const item of customers.docs) writer.update(item.ref, { planLocked: false, updatedAt: unlockedAt })
    for (const item of users.docs) {
      const uid = String(item.data().uid || item.id)
      await auth.updateUser(uid, { disabled: false }).catch(() => undefined)
      writer.update(item.ref, { planLocked: false, active: true, updatedAt: unlockedAt })
      writer.update(db.doc(`users/${uid}`), { planLocked: false, active: true, updatedAt: unlockedAt })
      await setAccessClaims(uid, businessId, String(item.data().role || 'Cajero'), true)
    }
    await writer.close()

    await db.collection(`businesses/${businessId}/audit_logs`).add({
      action: 'TRIAL_ACTIVATED',
      module: 'system',
      userId: request.auth.uid,
      userName: profileData.displayName || 'Administrador',
      role: 'Administrador',
      targetId: businessId,
      before: null,
      after: { plan: 'pro', trialDays: 30, expiresAt },
      businessId,
      createdAt: FieldValue.serverTimestamp(),
    })

    return { success: true, expiresAt: expiresAt.toISOString() }
  }
)

// ══════════════════════════════════════════════════════════════
// Sucursales beta: exclusivamente cuenta Tests
// ══════════════════════════════════════════════════════════════
export const manageTestBranch = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')
    const email = String(request.auth.token.email || '').trim().toLowerCase()
    if (email !== 'test01@gmail.com') throw new HttpsError('permission-denied', 'La prueba de sucursales solo está habilitada para la cuenta Tests.')

    const profileSnap = await db.doc(`users/${request.auth.uid}`).get()
    const profile = profileSnap.data()
    const businessId = String(profile?.businessId || '')
    if (!profileSnap.exists || profile?.active !== true || profile?.role !== 'Administrador' || !businessId) {
      throw new HttpsError('permission-denied', 'Solo el administrador activo de Tests puede administrar sucursales.')
    }

    const action = String(request.data?.action || '')
    const branchesRef = db.collection(`businesses/${businessId}/branches`)
    const now = FieldValue.serverTimestamp()

    if (action === 'create') {
      const name = String(request.data?.name || '').trim().slice(0, 80)
      const address = String(request.data?.address || '').trim().slice(0, 180)
      const phone = String(request.data?.phone || '').trim().slice(0, 30)
      if (!name) throw new HttpsError('invalid-argument', 'El nombre de la sucursal es requerido.')
      const existing = await branchesRef.get()
      const additional = existing.docs.filter(item => item.data()?.isMain !== true).length
      if (additional >= 5) throw new HttpsError('failed-precondition', 'El negocio ya alcanzó el máximo de 5 sucursales adicionales.')

      const branchRef = branchesRef.doc()
      const branch = {
        businessId, name, address, phone,
        code: `SUC-${String(additional + 1).padStart(2, '0')}`,
        isMain: false, active: true, monthlyPrice: 300,
        createdAt: now, updatedAt: now, createdBy: request.auth.uid,
      }
      await branchRef.set(branch)
      await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: 'CREATE_BRANCH', module: 'branches', userId: request.auth.uid,
        userName: email, role: 'Administrador', targetId: branchRef.id,
        targetName: name, businessId, after: { code: branch.code, monthlyPrice: 300 }, createdAt: now,
      })
      return { success: true, branch: { id: branchRef.id, businessId, name, address, phone, code: branch.code, isMain: false, active: true, monthlyPrice: 300, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
    }

    if (action === 'setActive') {
      const branchId = String(request.data?.branchId || '')
      const active = request.data?.active === true
      if (!branchId) throw new HttpsError('invalid-argument', 'Sucursal requerida.')
      const branchRef = branchesRef.doc(branchId)
      const branchSnap = await branchRef.get()
      if (!branchSnap.exists || branchSnap.data()?.isMain === true) throw new HttpsError('not-found', 'Sucursal no encontrada.')
      await branchRef.update({ active, updatedAt: now })
      await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: active ? 'ACTIVATE_BRANCH' : 'SUSPEND_BRANCH', module: 'branches',
        userId: request.auth.uid, userName: email, role: 'Administrador', targetId: branchId,
        targetName: branchSnap.data()?.name || branchId, businessId, after: { active }, createdAt: now,
      })
      return { success: true, branchId, active }
    }

    throw new HttpsError('invalid-argument', 'Acción de sucursal no válida.')
  }
)

// ══════════════════════════════════════════════════════════════
// SuperAdmin: activar, suspender o rechazar un negocio completo
// ══════════════════════════════════════════════════════════════
export const setBusinessAccessAsSuperAdmin = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const caller = await db.doc(`users/${request.auth.uid}`).get()
    if (!caller.exists || caller.data()?.active !== true || caller.data()?.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Solo el super admin puede cambiar el acceso de un negocio.')
    }

    const data = request.data as {
      businessId?: string
      status?: 'active' | 'suspended' | 'rejected'
      plan?: 'starter' | 'pro'
      planExpiresAt?: string | null
      note?: string
    }
    const businessId = String(data.businessId || '')
    const status = String(data.status || '')
    if (!businessId || !['active', 'suspended', 'rejected'].includes(status)) {
      throw new HttpsError('invalid-argument', 'Negocio y estado válidos son requeridos.')
    }

    const businessRef = db.doc(`businesses/${businessId}`)
    const businessSnap = await businessRef.get()
    if (!businessSnap.exists) throw new HttpsError('not-found', 'Negocio no encontrado.')

    const now = FieldValue.serverTimestamp()
    const activating = status === 'active'
    const businessUpdate: Record<string, any> = {
      active: activating,
      activationPending: false,
      updatedAt: now,
      accessUpdatedAt: now,
      accessUpdatedBy: request.auth.token.email || request.auth.uid,
    }
    if (status === 'active') {
      businessUpdate.activatedAt = now
      businessUpdate.activationNote = String(data.note || '').slice(0, 300)
      businessUpdate.rejectionReason = FieldValue.delete()
      businessUpdate.suspensionReason = FieldValue.delete()
      if (data.plan === 'starter' || data.plan === 'pro') businessUpdate.plan = data.plan
      if (data.plan === 'pro' && data.planExpiresAt) {
        const expiry = new Date(data.planExpiresAt)
        if (Number.isNaN(expiry.getTime())) throw new HttpsError('invalid-argument', 'Fecha de vencimiento inválida.')
        businessUpdate.planExpiresAt = Timestamp.fromDate(expiry)
        businessUpdate.planActivatedAt = now
      }
    } else if (status === 'suspended') {
      businessUpdate.suspensionReason = String(data.note || '').slice(0, 300)
      businessUpdate.suspendedAt = now
    } else {
      businessUpdate.rejectionReason = String(data.note || '').slice(0, 300)
      businessUpdate.rejectedAt = now
    }

    const usersSnap = await db.collection('users').where('businessId', '==', businessId).get()
    const batch = db.batch()
    batch.update(businessRef, businessUpdate)

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data()
      const shouldEnable = activating && (user.activationPending === true || user.disabledByBusinessStatus === true)
      const nextActive = activating ? (shouldEnable ? true : user.active === true) : false
      const userUpdate: Record<string, any> = {
        active: nextActive,
        activationPending: false,
        updatedAt: now,
      }
      if (!activating && user.active === true) userUpdate.disabledByBusinessStatus = true
      if (activating && shouldEnable) userUpdate.disabledByBusinessStatus = FieldValue.delete()
      batch.update(userDoc.ref, userUpdate)

      const businessUserRef = db.doc(`businesses/${businessId}/users/${userDoc.id}`)
      batch.set(businessUserRef, userUpdate, { merge: true })

      await auth.updateUser(userDoc.id, { disabled: !nextActive })
      await setAccessClaims(userDoc.id, businessId, String(user.role || ''), nextActive)
    }

    batch.set(db.collection(`businesses/${businessId}/audit_logs`).doc(), {
      action: activating ? 'ACTIVATE_BUSINESS' : status === 'suspended' ? 'SUSPEND_BUSINESS' : 'REJECT_BUSINESS',
      module: 'system',
      userId: request.auth.uid,
      userName: request.auth.token.email || 'SuperAdmin',
      role: 'superadmin',
      targetId: businessId,
      targetName: businessSnap.data()?.name || businessId,
      before: { active: businessSnap.data()?.active, activationPending: businessSnap.data()?.activationPending === true },
      after: { active: activating, activationPending: false, plan: businessUpdate.plan || businessSnap.data()?.plan, note: String(data.note || '').slice(0, 300) },
      businessId,
      createdAt: now,
    })
    await batch.commit()

    return { success: true, status, usersUpdated: usersSnap.size }
  }
)

// ══════════════════════════════════════════════════════════════
// 8. updateUserAsSuperAdmin — Super admin edita correo, nombre, rol, estado y contraseña
// ══════════════════════════════════════════════════════════════
export const updateUserAsSuperAdmin = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const callerUid = request.auth.uid
    const callerProfile = await db.doc(`users/${callerUid}`).get()
    if (!callerProfile.exists || callerProfile.data()?.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Solo el super admin puede editar usuarios.')
    }

    const data = request.data as { targetUid: string; email?: string; password?: string; displayName?: string; role?: string; active?: boolean }
    if (!data.targetUid) throw new HttpsError('invalid-argument', 'Usuario requerido.')
    if (data.targetUid === callerUid) throw new HttpsError('invalid-argument', 'No puedes editar tu propia cuenta desde aquí.')

    const targetProfile = await db.doc(`users/${data.targetUid}`).get()
    if (!targetProfile.exists) throw new HttpsError('not-found', 'Usuario no encontrado.')
    if (targetProfile.data()?.role === 'superadmin') throw new HttpsError('permission-denied', 'No puedes modificar otro super admin.')

    const email = data.email?.trim().toLowerCase()
    const displayName = data.displayName?.trim()
    const authUpdates: UpdateRequest = {}
    const dbUpdates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() }

    if (email) {
      if (!validateEmail(email)) throw new HttpsError('invalid-argument', 'Correo electrónico inválido.')
      authUpdates.email = email
      dbUpdates.email = email
    }
    if (displayName) {
      authUpdates.displayName = displayName
      dbUpdates.displayName = displayName
    }
    if (data.password) {
      if (!validatePassword(data.password)) throw new HttpsError('invalid-argument', 'La contraseña debe tener entre 8 y 128 caracteres.')
      authUpdates.password = data.password
    }
    if (typeof data.active === 'boolean') {
      authUpdates.disabled = !data.active
      dbUpdates.active = data.active
    }
    if (data.role) {
      if (!['Cajero', 'Encargado', 'Administrador'].includes(data.role)) throw new HttpsError('invalid-argument', 'Rol inválido.')
      if (targetProfile.data()?.role === 'Administrador' && data.role !== 'Administrador') {
        const businessId = targetProfile.data()?.businessId
        if (businessId) {
          const businessUsers = await db.collection(`businesses/${businessId}/users`).get()
          const otherActiveAdmin = businessUsers.docs.some(doc => {
            const user = doc.data()
            return doc.id !== data.targetUid && user.active === true && user.role === 'Administrador'
          })
          if (!otherActiveAdmin) {
            throw new HttpsError('failed-precondition', 'No puedes quitar el rol al último administrador activo.')
          }
        }
      }
      dbUpdates.role = data.role
    }

    if (Object.keys(authUpdates).length) await auth.updateUser(data.targetUid, authUpdates)
    await db.doc(`users/${data.targetUid}`).update(dbUpdates)

    const businessId = targetProfile.data()?.businessId
    if (businessId) {
      const bizUserRef = db.doc(`businesses/${businessId}/users/${data.targetUid}`)
      const bizUserSnap = await bizUserRef.get()
      if (bizUserSnap.exists) await bizUserRef.update(dbUpdates)
    }

    return { success: true }
  }
)

// ══════════════════════════════════════════════════════════════
// 8. deleteUserAsSuperAdmin — Super admin elimina usuario de Auth y Firestore
// ══════════════════════════════════════════════════════════════
export const deleteUserAsSuperAdmin = onCall(
  { region: 'us-central1', enforceAppCheck: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado.')

    const callerUid = request.auth.uid
    const callerProfile = await db.doc(`users/${callerUid}`).get()
    if (!callerProfile.exists || callerProfile.data()?.role !== 'superadmin') {
      throw new HttpsError('permission-denied', 'Solo el super admin puede eliminar usuarios.')
    }

    const data = request.data as { targetUid: string }
    if (!data.targetUid) throw new HttpsError('invalid-argument', 'Usuario requerido.')
    if (data.targetUid === callerUid) throw new HttpsError('invalid-argument', 'No puedes eliminar tu propia cuenta.')

    const targetProfile = await db.doc(`users/${data.targetUid}`).get()
    if (!targetProfile.exists) throw new HttpsError('not-found', 'Usuario no encontrado.')
    if (targetProfile.data()?.role === 'superadmin') throw new HttpsError('permission-denied', 'No puedes eliminar otro super admin.')

    const businessId = targetProfile.data()?.businessId
    await auth.deleteUser(data.targetUid).catch(() => {})
    await db.doc(`users/${data.targetUid}`).delete()
    if (businessId) await db.doc(`businesses/${businessId}/users/${data.targetUid}`).delete().catch(() => {})

    return { success: true }
  }
)

