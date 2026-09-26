import { orderBy } from 'firebase/firestore'
import { bizAdd, bizGetAll, bizUpdate, bizDelete } from './firestoreService'

const COL         = 'liquids'
const HISTORY_COL = 'refill_history'

// ── Helpers (pure) ────────────────────────────────────────────

export function getBottlePct(liquid) {
  const capacity = getActiveTotalCapacity(liquid)
  if (!liquid.hasActive || !capacity) return 0
  return Math.min(100, Math.round((toNum(liquid.activeSaldo) / capacity) * 100))
}

export function getOpenBottleCount(liquid) {
  if (!liquid?.hasActive || toNum(liquid.activeSaldo) <= 0) return 0
  const saved = Math.floor(toNum(liquid.openBottleCount))
  if (saved > 0) return Math.min(3, saved)
  return Math.min(3, Math.max(1, Math.ceil(toNum(liquid.activeSaldo) / Math.max(1, toNum(liquid.activeCapacity)))))
}

export function getActiveTotalCapacity(liquid) {
  if (!liquid?.hasActive) return 0
  return toNum(liquid.activeTotalCapacity) || toNum(liquid.activeCapacity) * getOpenBottleCount(liquid)
}

export function canRefill(liquid, refillType, settings = null) {
  if (!liquid.hasActive) return false
  return toNum(liquid.activeSaldo, 0) >= getPointsForType(liquid, refillType, settings)
}

export const DEFAULT_REFILL_BUTTONS = [
  { id: 'r50',  price: 50,  points: 10, active: true },
  { id: 'r100', price: 100, points: 20, active: true },
  { id: 'r150', price: 150, points: 30, active: true },
]

const toNum = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function getRefillButtons(settings = {}) {
  const raw = Array.isArray(settings?.refillButtons) && settings.refillButtons.length
    ? settings.refillButtons
    : DEFAULT_REFILL_BUTTONS
  return raw
    .slice(0, 5)
    .map((b, index) => ({
      id: b.id || `r${index}_${b.price || Date.now()}`,
      price: toNum(b.price, 0),
      points: toNum(b.points, 0),
      active: b.active !== false,
    }))
    .filter(b => b.active && b.price > 0 && b.points > 0)
}

export function getPointsForType(liquid, refillType, settings = null) {
  const price = toNum(String(refillType).replace('RD$', ''), 0)
  const fromSettings = settings && Array.isArray(settings.refillButtons)
    ? getRefillButtons(settings).find(b => b.price === price)
    : null
  if (fromSettings) return fromSettings.points
  if (price === 50)  return toNum(liquid?.pointsR50, 10)
  if (price === 100) return toNum(liquid?.pointsR100, 20)
  if (price === 150) return toNum(liquid?.pointsR150, 30)
  return toNum(liquid?.pointsR100, 20)
}

/**
 * Cuantas recargas rinde una botella completa para un precio dado
 */
export function getExpectedRecharges(liquid, priceType = 100, settings = null) {
  const pts = getPointsForType(liquid, priceType, settings)
  if (!pts) return 0
  return Math.floor(toNum(liquid.activeCapacity, 0) / pts)
}

/**
 * Costo de cada recarga = (costo botella / recargas que rinde)
 * Ejemplo: botella RD$325, rinde 10 recargas de RD$100
 *   → cada recarga cuesta RD$32.5
 */
export function getCostPerRefill(liquid, priceType = 100, settings = null) {
  const capacity = toNum(liquid?.activeCapacity, 0)
  const cost = toNum(liquid?.costPerBottle, 0)
  const points = getPointsForType(liquid, priceType, settings)
  if (!capacity || !points) return 0
  return (cost / capacity) * points
}

/**
 * Ganancia por recarga = precio recarga - costo de esa recarga
 * Ejemplo: recarga RD$100, costo RD$32.5 → ganancia RD$67.5
 */
export function getProfitPerRefill(liquid, priceType = 100, settings = null) {
  return toNum(priceType, 0) - getCostPerRefill(liquid, priceType, settings)
}

/**
 * Ganancia total potencial si se venden TODAS las recargas de una botella
 * Ejemplo: 10 recargas x RD$67.5 = RD$675
 */
export function getTotalPotentialProfit(liquid, priceType = 100, settings = null) {
  const expected = getExpectedRecharges(liquid, priceType, settings)
  return expected * getProfitPerRefill(liquid, priceType, settings)
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
  const consumed = Math.max(0, toNum(liquid.totalOpenedCapacity, getActiveTotalCapacity(liquid)) - toNum(liquid.activeSaldo))
  const registeredPoints = toNum(liquid.totalPointsConsumedAllTime)
  const diff = consumed - registeredPoints
  const tolerance = Math.max(1, toNum(liquid.pointsR50, 10))
  if (diff > tolerance) {
    return { warning: true, diff, message: `Posible diferencia de ${Math.round(diff)} ml sin justificar` }
  }
  return null
}

export function buildRefillCartItem(liquid, refillPrice, settings = null) {
  const points = getPointsForType(liquid, refillPrice, settings)
  if (!canRefill(liquid, refillPrice, settings)) {
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
    taxIncluded: liquid.taxIncluded === true,
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
export function getRendimientoReport(liquid, refillSales = []) {
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
  const bottlesOpened    = Math.max(1, toNum(liquid.totalOpenedBottles, liquid.hasActive ? 1 : 0))
  const totalPotential   = getTotalPotentialProfit(liquid, 100) * bottlesOpened

  // Ganancia real = ingresos reales - costo real de cada recarga según su tipo
  const totalEarned      = liquid.totalRevenueAllTime || 0
  const liquidSales      = refillSales.filter(r => r.liquidId === liquid.id)
  const realCostConsumed = liquidSales.length > 0
    ? liquidSales.reduce((acc, r) => acc + getCostPerRefill(liquid, r.price || 100), 0)
    : realRecharges * costPerR100
  const realNetProfit    = totalEarned - realCostConsumed

  // ROI potencial sobre la botella completa
  const totalInvested = toNum(liquid.costPerBottle) * bottlesOpened
  const roiPotential = totalInvested
    ? Math.round((totalPotential / totalInvested) * 100)
    : 0

  // ROI real sobre lo consumido hasta ahora
  const roiReal = realCostConsumed > 0
    ? Math.round((realNetProfit / realCostConsumed) * 100)
    : 0

  const openedCapacity = toNum(liquid.totalOpenedCapacity, toNum(liquid.activeCapacity) * bottlesOpened)
  const consumed    = Math.max(0, openedCapacity - toNum(liquid.activeSaldo))
  const pctConsumed = openedCapacity ? Math.min(100, Math.round(consumed / openedCapacity * 100)) : 0

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
    totalInvested,
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
