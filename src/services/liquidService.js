import { orderBy } from 'firebase/firestore'
import { bizAdd, bizGetAll, bizUpdate, bizDelete } from './firestoreService'

const COL         = 'liquids'
const HISTORY_COL = 'refill_history'

// ── Helpers (pure) ────────────────────────────────────────────

export function getBottlePct(liquid) {
  if (!liquid.hasActive || !liquid.activeCapacity) return 0
  return Math.round((liquid.activeSaldo / liquid.activeCapacity) * 100)
}

export function canRefill(liquid, refillType) {
  if (!liquid.hasActive) return false
  return liquid.activeSaldo >= getPointsForType(liquid, refillType)
}

export function getPointsForType(liquid, refillType) {
  if (refillType === 50  || refillType === 'RD$50')  return liquid.pointsR50
  if (refillType === 100 || refillType === 'RD$100') return liquid.pointsR100
  if (refillType === 150 || refillType === 'RD$150') return liquid.pointsR150
  return liquid.pointsR100
}

/**
 * Cuantas recargas rinde una botella completa para un precio dado
 */
export function getExpectedRecharges(liquid, priceType = 100) {
  const pts = getPointsForType(liquid, priceType)
  if (!pts) return 0
  return Math.floor(liquid.activeCapacity / pts)
}

/**
 * Costo de cada recarga = (costo botella / recargas que rinde)
 * Ejemplo: botella RD$325, rinde 10 recargas de RD$100
 *   → cada recarga cuesta RD$32.5
 */
export function getCostPerRefill(liquid, priceType = 100) {
  const expected = getExpectedRecharges(liquid, priceType)
  if (!expected) return 0
  return liquid.costPerBottle / expected
}

/**
 * Ganancia por recarga = precio recarga - costo de esa recarga
 * Ejemplo: recarga RD$100, costo RD$32.5 → ganancia RD$67.5
 */
export function getProfitPerRefill(liquid, priceType = 100) {
  return priceType - getCostPerRefill(liquid, priceType)
}

/**
 * Ganancia total potencial si se venden TODAS las recargas de una botella
 * Ejemplo: 10 recargas x RD$67.5 = RD$675
 */
export function getTotalPotentialProfit(liquid, priceType = 100) {
  const expected = getExpectedRecharges(liquid, priceType)
  return expected * getProfitPerRefill(liquid, priceType)
}

// Para compatibilidad con codigo anterior
export function getRefillCost(liquid, refillType) {
  return getCostPerRefill(liquid, refillType)
}

export function getCostPerPoint(liquid) {
  if (!liquid.activeCapacity) return 0
  return liquid.costPerBottle / liquid.activeCapacity
}

export function detectLoss(liquid) {
  if (!liquid.hasActive) return null
  const consumed    = liquid.activeCapacity - liquid.activeSaldo
  const registered  = liquid.totalRechargesAllTime
  const theoretical = Math.round(consumed / liquid.pointsR100)
  const diff        = theoretical - registered
  if (diff > 1) {
    return { warning: true, diff, message: `Posible perdida: ${diff} recargas sin registrar` }
  }
  return null
}

export function buildRefillCartItem(liquid, refillPrice) {
  const points = getPointsForType(liquid, refillPrice)
  if (!canRefill(liquid, refillPrice)) {
    throw new Error(`Saldo insuficiente en "${liquid.name}". Necesita ${points} pts, disponible: ${liquid.activeSaldo}`)
  }
  return {
    id:         `refill_${liquid.id}_${refillPrice}_${Date.now()}`,
    type:       'refill',
    name:       `Recarga ${liquid.name} — RD$${refillPrice}`,
    liquidId:   liquid.id,
    liquidName: liquid.name,
    price:      refillPrice,
    cost:       getCostPerRefill(liquid, refillPrice),
    points,
    qty:        1,
  }
}

/**
 * Reporte de rendimiento CORREGIDO
 *
 * Ejemplo con botella RD$325, capacidad 100pts, pointsR100=10:
 *   - Recargas esperadas: 100/10 = 10
 *   - Costo por recarga RD$100: 325/10 = RD$32.5
 *   - Ganancia por recarga RD$100: 100 - 32.5 = RD$67.5
 *   - Ganancia total potencial: 10 * 67.5 = RD$675
 *   - ROI potencial: (675/325) * 100 = 207%
 */
export function getRendimientoReport(liquid) {
  const expectedR100     = getExpectedRecharges(liquid, 100)
  const expectedR50      = getExpectedRecharges(liquid, 50)
  const expectedR150     = getExpectedRecharges(liquid, 150)
  const realRecharges    = liquid.totalRechargesAllTime || 0
  const costPerR100      = getCostPerRefill(liquid, 100)
  const costPerR50       = getCostPerRefill(liquid, 50)
  const costPerR150      = getCostPerRefill(liquid, 150)
  const profitPerR100    = getProfitPerRefill(liquid, 100)
  const profitPerR50     = getProfitPerRefill(liquid, 50)
  const profitPerR150    = getProfitPerRefill(liquid, 150)
  const totalPotential   = getTotalPotentialProfit(liquid, 100)

  // Ganancia real = ingresos reales - (recargas realizadas * costo por recarga)
  const totalEarned      = liquid.totalRevenueAllTime || 0
  const realCostConsumed = realRecharges * costPerR100
  const realNetProfit    = totalEarned - realCostConsumed

  // ROI potencial sobre la botella completa
  const roiPotential = liquid.costPerBottle
    ? Math.round((totalPotential / liquid.costPerBottle) * 100)
    : 0

  // ROI real sobre lo consumido hasta ahora
  const roiReal = realCostConsumed > 0
    ? Math.round((realNetProfit / realCostConsumed) * 100)
    : 0

  const consumed    = liquid.hasActive ? liquid.activeCapacity - liquid.activeSaldo : liquid.activeCapacity
  const pctConsumed = liquid.activeCapacity ? Math.round(consumed / liquid.activeCapacity * 100) : 100

  return {
    liquidName:       liquid.name,
    // Recargas
    expectedR50, expectedR100, expectedR150,
    realRecharges,
    // Costos por recarga
    costPerR50, costPerR100, costPerR150,
    // Ganancia por recarga
    profitPerR50, profitPerR100, profitPerR150,
    // Totales
    totalPotential,
    totalEarned,
    realNetProfit,
    totalInvested:   liquid.costPerBottle,
    // ROI
    roiPotential,
    roiReal,
    // Otros
    consumed, pctConsumed,
    lossData:        detectLoss(liquid),
    bottlePct:       getBottlePct(liquid),
  }
}

// Alias para compatibilidad
export function getNicotinaLabel(liquid) {
  const parts = []
  if (liquid.nicotinaFreebase && liquid.nicotinaFreebase !== 'ninguna' && liquid.nicotinaFreebase !== '0') {
    parts.push(`FB ${liquid.nicotinaFreebase}mg`)
  }
  if (liquid.nicotinaSales && liquid.nicotinaSales !== 'ninguna' && liquid.nicotinaSales !== '0') {
    parts.push(`Sales ${liquid.nicotinaSales}mg`)
  }
  return parts.length > 0 ? parts.join(' / ') : 'Sin nicotina'
}

// ── Firebase ─────────────────────────────────────────────────

export async function fetchLiquids(businessId) {
  return bizGetAll(businessId, COL, [orderBy('name')])
}
export async function saveLiquid(businessId, liquidData) {
  return bizAdd(businessId, COL, liquidData)
}
export async function updateLiquid(businessId, liquidId, updates) {
  return bizUpdate(businessId, COL, liquidId, updates)
}
export async function deleteLiquid(businessId, liquidId) {
  return bizDelete(businessId, COL, liquidId)
}
export async function recordRefillHistory(businessId, refillData) {
  return bizAdd(businessId, HISTORY_COL, refillData)
}
