// ============================================================
// cashService.js — tenant-aware
// ============================================================

import { orderBy, limit, where } from 'firebase/firestore'
import { bizAdd, bizUpdate, bizGetAll } from './firestoreService'
import { today, formatTime } from '../utils/helpers'

const COL = 'cash_sessions'

export async function openCashSession(businessId, { userId, userName, openAmount }) {
  return bizAdd(businessId, COL, {
    open:          true,
    date:          today(),
    openTime:      formatTime(),
    closeTime:     null,
    userId,
    user:          userName,
    openAmount,
    sales:         0,
    expenses:      0,
    expectedTotal: openAmount,
    countedTotal:  null,
    difference:    null,
    notes:         '',
  })
}

export async function closeCashSession(businessId, sessionId, { countedTotal, notes, totalSales, expenses }) {
  const expectedTotal = totalSales + expenses
  const difference    = countedTotal - expectedTotal
  return bizUpdate(businessId, COL, sessionId, {
    open:          false,
    closeTime:     formatTime(),
    countedTotal,
    expectedTotal,
    difference,
    notes,
  })
}

export async function getCashHistory(businessId, limitN = 20) {
  return bizGetAll(businessId, COL, [
    orderBy('createdAt', 'desc'),
    limit(limitN),
  ])
}

export function getCashSummary(session) {
  const expected = session.openAmount + session.sales - session.expenses
  const counted  = session.countedTotal ?? null
  const diff     = counted !== null ? counted - expected : null
  return { expected, counted, diff, hasDiff: diff !== null && Math.abs(diff) > 0 }
}

export function getSalesByPayment(sales) {
  return ['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto'].map(method => ({
    method,
    total: sales.filter(s => s.payment === method).reduce((a, s) => a + s.total, 0),
    count: sales.filter(s => s.payment === method).length,
  }))
}
