import { defineSecret } from 'firebase-functions/params'
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentDeleted } from 'firebase-functions/v2/firestore'
import * as admin from 'firebase-admin'

const LEMON_SQUEEZY_API_KEY = defineSecret('LEMON_SQUEEZY_API_KEY')
const LEMON_SQUEEZY_SIGNING_SECRET = defineSecret('LEMON_SQUEEZY_SIGNING_SECRET')

admin.initializeApp()
const db = admin.firestore()
const auth = admin.auth()

// ── Validadores ───────────────────────────────────────────────
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
function validatePassword(pwd: string): boolean {
  return typeof pwd === 'string' && pwd.length >= 6
}

// ══════════════════════════════════════════════════════════════
// 1. registerBusiness
// ══════════════════════════════════════════════════════════════
export const registerBusiness = onCall(
  { region: 'us-central1' },
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
      throw new HttpsError('invalid-argument', 'La contraseña debe tener al menos 6 caracteres.')
    }
    if (!data.ownerName || data.ownerName.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'El nombre del propietario es requerido.')
    }
    if (!data.businessName || data.businessName.trim().length < 2) {
      throw new HttpsError('invalid-argument', 'El nombre del negocio es requerido.')
    }

    const now = admin.firestore.FieldValue.serverTimestamp()

    try {
      const authUser = await auth.createUser({
        email: data.email.trim().toLowerCase(),
        password: data.password,
        displayName: data.ownerName.trim(),
      })
      const uid = authUser.uid

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
        active: true,
        createdAt: now,
        updatedAt: now,
      })

      batch.set(db.doc(`businesses/${businessId}/settings/config`), defaultSettings)

      batch.set(db.doc(`users/${uid}`), {
        businessId,
        role: 'Administrador',
        active: true,
        email: data.email.trim().toLowerCase(),
        displayName: data.ownerName.trim(),
        createdAt: now,
        updatedAt: now,
      })

      batch.set(db.doc(`businesses/${businessId}/users/${uid}`), {
        uid,
        businessId,
        role: 'Administrador',
        active: true,
        email: data.email.trim().toLowerCase(),
        displayName: data.ownerName.trim(),
        createdAt: now,
        updatedAt: now,
      })

      await batch.commit()

      await db.collection(`businesses/${businessId}/audit_logs`).add({
        action: 'REGISTER_BUSINESS',
        module: 'system',
        userId: uid,
        userName: data.ownerName.trim(),
        role: 'Administrador',
        targetId: businessId,
        targetName: data.businessName.trim(),
        before: null,
        after: { businessName: data.businessName.trim(), plan: 'starter' },
        businessId,
        createdAt: now,
      })

      return { success: true, businessId, uid }
    } catch (err: any) {
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
  { region: 'us-central1' },
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

    const now = admin.firestore.FieldValue.serverTimestamp()

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
  { region: 'us-central1' },
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

    const now = admin.firestore.FieldValue.serverTimestamp()

    await db.doc(`users/${data.targetUid}`).update({ role: data.newRole, updatedAt: now })
    await db.doc(`businesses/${businessId}/users/${data.targetUid}`).update({ role: data.newRole, updatedAt: now })

    return { success: true }
  }
)

// ══════════════════════════════════════════════════════════════
// 4. deactivateUser
// ══════════════════════════════════════════════════════════════
export const deactivateUser = onCall(
  { region: 'us-central1' },
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

    const now = admin.firestore.FieldValue.serverTimestamp()

    await auth.updateUser(data.targetUid, { disabled: true })
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
)

// ══════════════════════════════════════════════════════════════
// 6. deleteUser — Admin elimina un usuario completamente
// ══════════════════════════════════════════════════════════════
export const deleteUser = onCall(
  { region: 'us-central1' },
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

    const now = admin.firestore.FieldValue.serverTimestamp()

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
// 7. lemonSqueezyWebhook
// ══════════════════════════════════════════════════════════════
export const lemonSqueezyWebhook = onRequest(
  {
    region: 'us-central1',
    secrets: [LEMON_SQUEEZY_SIGNING_SECRET],
  },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed')
        return
      }

      const signingSecret = LEMON_SQUEEZY_SIGNING_SECRET.value()
      const signature = req.headers['x-signature'] as string | undefined

      if (!signature) {
        res.status(400).send('Falta firma')
        return
      }

      const crypto = require('crypto')

      const expectedSignature = crypto
        .createHmac('sha256', signingSecret)
        .update(req.rawBody)
        .digest('hex')

      if (signature !== expectedSignature) {
        res.status(403).send('Firma inválida')
        return
      }

      const eventName = req.body?.meta?.event_name
      const customData = req.body?.meta?.custom_data || {}
      const attributes = req.body?.data?.attributes || {}
      const subscriptionId = req.body?.data?.id || null

      const businessId = customData.businessId

      if (!businessId) {
        res.status(200).send('OK')
        return
      }

      const now = new Date()
      const ts = admin.firestore.FieldValue.serverTimestamp()

      if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
        let planExpiresAt: Date | null = null

        if (attributes.renews_at) {
          planExpiresAt = new Date(attributes.renews_at)
        } else if (attributes.ends_at) {
          planExpiresAt = new Date(attributes.ends_at)
        } else {
          planExpiresAt = new Date(now)
          planExpiresAt.setDate(planExpiresAt.getDate() + 30)
        }

        await db.doc(`businesses/${businessId}`).set(
          {
            plan: 'pro',
            planActivatedAt: now,
            planExpiresAt,
            degradedAt: null,
            lemonSqueezy: {
              status: attributes.status || 'active',
              renewsAt: attributes.renews_at ? new Date(attributes.renews_at) : null,
              endsAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
              subscriptionId,
              customerId: attributes.customer_id || null,
              variantId: attributes.variant_id || null,
              productId: attributes.product_id || null,
              orderId: attributes.order_id || null,
              updatedAt: ts,
            },
            updatedAt: ts,
          },
          { merge: true }
        )
      }

      if (eventName === 'subscription_cancelled' || eventName === 'subscription_expired') {
        await db.doc(`businesses/${businessId}`).set(
          {
            plan: 'starter',
            planExpiresAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
            degradedAt: now,
            lemonSqueezy: {
              status: 'inactive',
              renewsAt: null,
              endsAt: attributes.ends_at ? new Date(attributes.ends_at) : null,
              subscriptionId,
              customerId: attributes.customer_id || null,
              variantId: attributes.variant_id || null,
              productId: attributes.product_id || null,
              orderId: attributes.order_id || null,
              updatedAt: ts,
            },
            updatedAt: ts,
          },
          { merge: true }
        )
      }

      res.status(200).send('OK')
    } catch (error) {
      console.error('Error en webhook Lemon Squeezy:', error)
      res.status(500).send('Error')
    }
  }
)

// ══════════════════════════════════════════════════════════════
// 8. createLemonSqueezyCheckout
// ══════════════════════════════════════════════════════════════
export const createLemonSqueezyCheckout = onCall(
  {
    region: 'us-central1',
    secrets: [LEMON_SQUEEZY_API_KEY],
  },
  async (request) => {
    try {
      const authUser = request.auth
      if (!authUser) {
        throw new HttpsError('unauthenticated', 'Debes iniciar sesión')
      }

      const { businessId, email } = request.data || {}

      if (!businessId) {
        throw new HttpsError('invalid-argument', 'Falta businessId')
      }

      const apiKey = LEMON_SQUEEZY_API_KEY.value()
      const storeId = 324232
      const variantId = 1437338

      console.log('CHECKOUT DEBUG 1')
      console.log(JSON.stringify({
        apiKeyExiste: !!apiKey,
        storeId,
        variantId,
        businessId,
        email: email || null,
      }))

      const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: {
                email: email || undefined,
                custom: {
                  businessId,
                },
              },
            },
            relationships: {
              store: {
                data: {
                  type: 'stores',
                  id: String(storeId),
                },
              },
              variant: {
                data: {
                  type: 'variants',
                  id: String(variantId),
                },
              },
            },
          },
        }),
      })

      const json = await response.json()

      console.log('CHECKOUT DEBUG 2')
      console.log(JSON.stringify({
        ok: response.ok,
        status: response.status,
        json,
      }))

      if (!response.ok) {
        throw new HttpsError(
          'internal',
          json?.errors?.[0]?.detail || 'No se pudo crear el checkout'
        )
      }

      const checkoutUrl = json?.data?.attributes?.url

      if (!checkoutUrl) {
        throw new HttpsError('internal', 'Lemon Squeezy no devolvió URL')
      }

      return { url: checkoutUrl }
    } catch (error: any) {
      console.error('CHECKOUT ERROR', error)
      throw new HttpsError('internal', error?.message || 'Error interno creando checkout')
    }
  }
)