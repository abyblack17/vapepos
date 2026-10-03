// ============================================================
// salesService.js — tenant-aware
// Todas las operaciones filtran por businessId
// ============================================================

import { orderBy, where } from 'firebase/firestore'
import {
  bizAdd,
  bizGetAll,
  bizDelete,
} from './firestoreService'
import { localDateKey, today } from '../utils/helpers'

const COL = 'sales'

// ── Create ───────────────────────────────────────────────────
export async function createSale(businessId, saleData) {
  return bizAdd(businessId, COL, saleData)
}

// ── Read ─────────────────────────────────────────────────────
export async function getTodaySales(businessId) {
  return bizGetAll(businessId, COL, [
    where('date', '==', today()),
    orderBy('createdAt', 'desc'),
  ])
}

export async function getSalesByDateRange(businessId, startDate, endDate) {
  return bizGetAll(businessId, COL, [
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'desc'),
  ])
}

export async function getAllSales(businessId) {
  return bizGetAll(businessId, COL, [orderBy('createdAt', 'desc')])
}

// ── Delete ───────────────────────────────────────────────────
export async function deleteSale(businessId, saleId) {
  const { queueOperation } = await import('./offlineSync')
  return queueOperation('reverseSale', { saleId }, businessId)
}

// ── Analytics (pure functions, work on local arrays) ─────────

export function computeDailySummary(sales) {
  const t = today()
  const todaySales = sales.filter(s => s.date === t)
  return {
    totalSales:       todaySales.reduce((a, s) => a + s.total, 0),
    totalProfit:      todaySales.reduce((a, s) => a + (s.profit || 0), 0),
    totalRefills:     todaySales.reduce((a, s) => a + s.refills.length, 0),
    transactionCount: todaySales.length,
    avgTicket: todaySales.length
      ? Math.round(todaySales.reduce((a, s) => a + s.total, 0) / todaySales.length)
      : 0,
  }
}

export function aggregateByPayment(sales) {
  return sales.reduce((acc, s) => {
    acc[s.payment] = (acc[s.payment] || 0) + s.total
    return acc
  }, {})
}

export function getTopProducts(sales, topN = 5) {
  const counts = {}
  sales.forEach(s => {
    ;(s.items || []).forEach(i => {
      if (!counts[i.name]) counts[i.name] = { name: i.name, qty: 0, revenue: 0 }
      counts[i.name].qty     += i.qty
      counts[i.name].revenue += i.price * i.qty
    })
  })
  return Object.values(counts).sort((a, b) => b.qty - a.qty).slice(0, topN)
}

export function getWeeklyChartData(sales) {
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const now = new Date()
  const sunday = new Date(now)
  sunday.setHours(0, 0, 0, 0)
  sunday.setDate(now.getDate() - now.getDay())

  return days.map((label, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    const dateStr = localDateKey(d)
    const daySales = sales.filter(s => s.date === dateStr)
    return {
      name:     label,
      ventas:   daySales.reduce((a, s) => a + s.total, 0),
      ganancia: daySales.reduce((a, s) => a + (s.profit || 0), 0),
    }
  })
}

export function getLast7DaysChartData(sales) {
  const now = new Date()
  const days = []

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    d.setDate(now.getDate() - offset)
    const dateStr = localDateKey(d)
    const daySales = sales.filter(s => s.date === dateStr)
    days.push({
      name: d.toLocaleDateString('es-DO', { weekday: 'short' }).replace('.', ''),
      date: dateStr,
      ventas: daySales.reduce((a, s) => a + s.total, 0),
      ganancia: daySales.reduce((a, s) => a + (s.profit || 0), 0),
    })
  }

  return days
}
