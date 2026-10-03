import { onSchedule } from 'firebase-functions/v2/scheduler'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

export function trialExpired(business: any, now = Date.now()) {
  if (business?.licenseType !== 'trial') return false
  const expires = business.trialExpiresAt?.toMillis?.() ?? new Date(business.trialExpiresAt).getTime()
  return !Number.isFinite(expires) || now >= expires
}

export const PURCHASE_PACKAGES: Record<string, { price: number, months: number }> = {
  autonomo: { price: 5000, months: 2 }, remoto: { price: 8000, months: 3 }, presencial: { price: 14000, months: 5 },
}
export function includedProExpiry(date: Date, months: number) {
  const expiry = new Date(date)
  const day = expiry.getUTCDate()
  expiry.setUTCDate(1)
  expiry.setUTCMonth(expiry.getUTCMonth() + months)
  const last = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate()
  expiry.setUTCDate(Math.min(day, last))
  return expiry
}

// Rules and callable checks enforce the exact deadline; this task only updates the displayed status.
// Transaction rechecks prevent a concurrent permanent activation from being suspended.
export const expireBusinessTrials = onSchedule({ schedule: 'every 5 minutes', region: 'us-central1', timeZone: 'America/Santo_Domingo' }, async () => {
  const db = getFirestore()
  const trials = await db.collection('businesses').where('licenseType', '==', 'trial').get()
  for (const item of trials.docs) {
    if (!trialExpired(item.data()) || item.data().active === false) continue
    await db.runTransaction(async tx => {
      const current = await tx.get(item.ref)
      if (!trialExpired(current.data()) || current.data()?.active === false) return
      tx.update(item.ref, { active: false, trialExpiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    })
  }
})
