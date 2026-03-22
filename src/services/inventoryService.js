// ============================================================
// inventoryService.js — tenant-aware
// ============================================================

import { orderBy, where } from 'firebase/firestore'
import { bizAdd, bizGetAll, bizUpdate, bizDelete } from './firestoreService'

const PRODUCTS_COL  = 'products'
const MOVEMENTS_COL = 'inventory_movements'

// ── Products ─────────────────────────────────────────────────

export async function fetchProducts(businessId) {
  return bizGetAll(businessId, PRODUCTS_COL, [
    where('active', '==', true),
    orderBy('name'),
  ])
}

export async function createProduct(businessId, data) {
  return bizAdd(businessId, PRODUCTS_COL, { ...data, active: true })
}

export async function updateProduct(businessId, productId, updates) {
  return bizUpdate(businessId, PRODUCTS_COL, productId, updates)
}

export async function deleteProduct(businessId, productId) {
  return bizDelete(businessId, PRODUCTS_COL, productId)
}

export async function deactivateProduct(businessId, productId) {
  return bizUpdate(businessId, PRODUCTS_COL, productId, { active: false })
}

// ── Movements ────────────────────────────────────────────────

export const MOVEMENT_TYPES = {
  PURCHASE:    'Compra',
  SALE:        'Venta',
  ADJUSTMENT:  'Ajuste',
  RETURN:      'Devolución',
  LOSS:        'Merma',
  CORRECTION:  'Corrección',
}

export async function recordMovement(businessId, { productId, productName, type, qty, reason, userId }) {
  return bizAdd(businessId, MOVEMENTS_COL, {
    productId,
    productName,
    type,
    qty,
    reason:  reason || '',
    userId:  userId || 'system',
  })
}

export async function getProductMovements(businessId, productId) {
  return bizGetAll(businessId, MOVEMENTS_COL, [
    where('productId', '==', productId),
    orderBy('createdAt', 'desc'),
  ])
}

// ── Analysis (pure) ──────────────────────────────────────────

export function getLowStockProducts(products, threshold) {
  return products.filter(p => p.active && p.stock <= (threshold || p.minStock))
}

export function getInventoryValue(products) {
  return products.reduce((a, p) => a + p.cost * p.stock, 0)
}

export function getInventoryRetailValue(products) {
  return products.reduce((a, p) => a + p.price * p.stock, 0)
}

export function getCategoryBreakdown(products) {
  const cats = {}
  products.forEach(p => {
    if (!cats[p.category]) cats[p.category] = { count: 0, value: 0, items: 0 }
    cats[p.category].count++
    cats[p.category].value += p.cost * p.stock
    cats[p.category].items += p.stock
  })
  return Object.entries(cats).map(([name, data]) => ({ name, ...data }))
}
