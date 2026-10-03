import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react'
import { orderBy, where } from 'firebase/firestore'
import { useAuth } from './AuthContext'
import { bizGetAll, getBusinessSettings } from '../services/firestoreService'
import { useFirestoreSync } from '../hooks/useFirestoreSync'
import { DEFAULT_REFILL_BUTTONS } from '../services/liquidService'
import { useBranches } from './BranchContext'
import { readLocal, writeLocal, listOperations } from '../services/offlineStore'
import { getSyncStatus, setOfflineProjection } from '../services/offlineSync'
import { withLoadDeadline } from '../services/syncRecovery'

// ── Estado inicial vacío ──────────────────────────────────────
export function getInitialState() {
  return {
    products:        [],
    liquids:         [],
    customers:       [],
    suppliers:       [],
    sales:           [],
    users:           [],
    purchases:       [],
    fiscalConfig:    null,
    ncfSequences:    [],
    fiscalInvoices:  [],
    cashSession:     { open: false, sales: 0, expenses: 0, openAmount: 0, expenseList: [] },
    settings: {
      businessName: '', phone: '', address: '', currency: 'RD$', taxRate: 18,
      defaultPointsR50: 10, defaultPointsR100: 20, defaultPointsR150: 30,
      refillButtons: DEFAULT_REFILL_BUTTONS,
      defaultBottleCapacity: 100, lowStockThreshold: 5, lowBottleAlert: 10,
      invoiceHeader: 'VapePOS', invoiceFooter: 'Gracias por su compra!',
      invoicePrefix: 'VPS',
      discounts: [], services: [],
      paperSize: '80mm', printCopies: '1',
      printLogo: true, printAddress: true, printPhone: true,
      printTax: true, printProfit: false, printQR: false,
      legalName: '', rnc: '', email: '', fiscalRegime: '', fiscalEnabled: false,
    },
    cashSessions:    [],
    cart:            [],
    selectedPayment: 'Efectivo',
    saleCounter:     0,
    loading:         false,
    dataLoaded:      false,
  }
}

export const AppContext = createContext(null)


function saleDateValue(sale = {}) {
  const raw = sale.createdAt?.seconds ? sale.createdAt.seconds * 1000 : sale.createdAt
  const value = raw ? new Date(raw).getTime() : new Date(`${sale.date || '1970-01-01'}T${sale.time || '00:00'}`).getTime()
  return Number.isFinite(value) ? value : 0
}

export function recalculateCustomerLoyalty(customers = [], sales = []) {
  const stats = new Map()
  const orderedSales = [...sales]
    .filter(s => s && s.customerId)
    .sort((a, b) => saleDateValue(a) - saleDateValue(b))

  for (const sale of orderedSales) {
    const id = sale.customerId
    const current = stats.get(id) || {
      totalSpent: 0,
      totalTransactions: 0,
      refillRewards: 0,
      totalRefills: 0,
      rewardPoints: 0,
      lastPurchase: null,
    }

    const previousSpent = current.totalSpent || 0
    const total = Number(sale.total || 0)
    const newSpent = previousSpent + total
    const refillEarned = Number(sale.refillRewardsEarned ?? sale.refills?.length ?? 0) || 0
    const pointsRedeemed = Number(sale.pointsRedeemed || 0) || 0
    const freeRefillRedeemed = Boolean(sale.freeRefillRedeemed)
    const pointsEarned = sale.rewardPointsEarned != null
      ? Number(sale.rewardPointsEarned || 0)
      : Math.max(0, Math.floor(newSpent / 50) - Math.floor(previousSpent / 50))

    current.totalSpent = newSpent
    current.totalTransactions = (current.totalTransactions || 0) + 1
    current.refillRewards = Math.max(0, (current.refillRewards || 0) - (freeRefillRedeemed ? 4 : 0)) + refillEarned
    current.totalRefills = Math.max(0, (current.totalRefills || 0) - (freeRefillRedeemed ? 4 : 0)) + refillEarned
    current.rewardPoints = Math.max(0, (current.rewardPoints || 0) - pointsRedeemed) + pointsEarned
    current.lastPurchase = sale.date || current.lastPurchase
    stats.set(id, current)
  }

  return customers.map(customer => {
    const computed = stats.get(customer.id) || {
      totalSpent: 0,
      totalTransactions: 0,
      refillRewards: 0,
      totalRefills: 0,
      rewardPoints: 0,
      lastPurchase: null,
    }
    return {
      ...customer,
      totalSpent: Math.max(0, computed.totalSpent || 0),
      totalTransactions: Math.max(0, computed.totalTransactions || 0),
      refillRewards: Math.max(0, computed.refillRewards || 0),
      totalRefills: Math.max(0, computed.totalRefills || 0),
      rewardPoints: Math.max(0, computed.rewardPoints || 0),
      lastPurchase: computed.lastPurchase || null,
    }
  })
}


const toMoney = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function recalcCashSales(cashSession = {}) {
  // IMPORTANTE:
  // No usar `salePayments || cashSession.sales`, porque si salePayments queda en 0
  // al anular/eliminar una venta, JavaScript toma 0 como falso y vuelve a usar
  // el total viejo de `sales`. Eso dejaba dinero pegado en Caja.
  const hasSalePayments = Object.prototype.hasOwnProperty.call(cashSession, 'salePayments')
  const saleCash = toMoney(hasSalePayments ? cashSession.salePayments : cashSession.sales)
  const creditCash = (cashSession.creditPayments || []).reduce((a, p) => a + toMoney(p.amount), 0)
  return Math.max(0, saleCash + creditCash)
}

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':     return { ...state, loading: action.payload }
    case 'START_DATA_LOAD': return { ...action.payload, dataLoaded: false, loading: true, dataError: null }
    case 'SET_DATA_LOADED': return { ...state, dataLoaded: true, loading: false }
    case 'SET_DATA_ERROR': return { ...state, loading: false, dataError: action.payload }
    case 'LOAD_ALL':        return { ...state, ...action.payload, loading: false, dataLoaded: true }

    // Products
    case 'ADD_PRODUCT':
      return { ...state, products: [...state.products, action.payload] }
    case 'UPDATE_PRODUCT':
      return { ...state, products: state.products.map(p => p.id === action.payload.id ? { ...p, ...action.payload } : p) }
    case 'DELETE_PRODUCT':
      return { ...state, products: state.products.filter(p => p.id !== action.payload) }
    case 'DEDUCT_STOCK':
      return { ...state, products: state.products.map(p =>
        p.id === action.payload.productId ? { ...p, stock: Math.max(0, p.stock - action.payload.qty) } : p
      )}

    // Liquids
    case 'ADD_LIQUID':
      return { ...state, liquids: [...state.liquids, action.payload] }
    case 'EDIT_LIQUID':
    case 'UPDATE_LIQUID':
      return { ...state, liquids: state.liquids.map(l => l.id === action.payload.id ? { ...l, ...action.payload } : l) }
    case 'DELETE_LIQUID':
      return { ...state, liquids: state.liquids.filter(l => l.id !== action.payload) }
    case 'OPEN_BOTTLE':
      return { ...state, liquids: state.liquids.map(l =>
        l.id === action.payload.liquidId
          ? { ...l, closedBottles: Math.max(0, l.closedBottles - 1), hasActive: true,
              activeSaldo: Number(l.activeSaldo || 0) + Number(l.activeCapacity || 0),
              openBottleCount: Math.min(3, Number(l.openBottleCount || (l.hasActive ? 1 : 0)) + 1),
              activeTotalCapacity: Number(l.activeTotalCapacity || (l.hasActive ? l.activeCapacity : 0)) + Number(l.activeCapacity || 0),
              activeOpenedAt: new Date() }
          : l
      )}
    case 'CONSUME_REFILL':
      return { ...state, liquids: state.liquids.map(l =>
        l.id === action.payload.liquidId
          ? { ...l,
              activeSaldo:           Math.max(0, l.activeSaldo - action.payload.points),
              totalRechargesAllTime: l.totalRechargesAllTime + (action.payload.qty || 1),
              totalRevenueAllTime:   l.totalRevenueAllTime + action.payload.price,
              totalPointsConsumedAllTime: Number(l.totalPointsConsumedAllTime || 0) + Number(action.payload.points || 0),
            }
          : l
      )}
    case 'ADJUST_SALDO':
      return { ...state, liquids: state.liquids.map(l => l.id === action.payload.liquidId ? { ...l, activeSaldo: Math.max(0, Number(action.payload.newSaldo) || 0) } : l) }
    case 'CLOSE_BOTTLE':
      return { ...state, liquids: state.liquids.map(l => l.id === action.payload.liquidId ? { ...l, hasActive: false, activeSaldo: 0 } : l) }
    case 'SELL_CLOSED_BOTTLE':
      return { ...state, liquids: state.liquids.map(l =>
        l.id === action.payload.liquidId ? action.payload.isHalf
          ? (Number(l.halfBottleStock || 0) > 0
              ? { ...l, halfBottleStock: Math.max(0, Number(l.halfBottleStock) - (action.payload.qty || 1)) }
              : { ...l, closedBottles: Math.max(0, l.closedBottles - 1), halfBottleStock: 1 })
          : { ...l, closedBottles: Math.max(0, l.closedBottles - (action.payload.qty || 1)) } : l
      )}

    // Cart
    case 'ADD_TO_CART': {
      const p = action.payload
      // For refills: validate saldo considering already queued refills in cart
      if (p.type === 'refill') {
        const liquid = state.liquids.find(l => l.id === p.liquidId)
        if (liquid) {
          const cartPoints = state.cart
            .filter(c => c.type === 'refill' && c.liquidId === p.liquidId)
            .reduce((a, c) => a + c.points * c.qty, 0)
          if (cartPoints + p.points > liquid.activeSaldo) {
            // Return state unchanged - caller handles the error toast
            return { ...state, _lastError: 'saldo_insuficiente' }
          }
        }
      }
      const existing = state.cart.find(c => c.id === p.id && c.type === p.type)
      if (existing) {
        // For refills: check if adding one more would exceed saldo
        if (p.type === 'refill') {
          const liquid = state.liquids.find(l => l.id === p.liquidId)
          if (liquid) {
            const cartPoints = state.cart
              .filter(c => c.type === 'refill' && c.liquidId === p.liquidId)
              .reduce((a, c) => a + c.points * c.qty, 0)
            if (cartPoints + p.points > liquid.activeSaldo) {
              return { ...state, _lastError: 'saldo_insuficiente' }
            }
          }
        }
        return { ...state, cart: state.cart.map(c => c.id === p.id && c.type === p.type ? { ...c, qty: c.qty + 1 } : c) }
      }
      return { ...state, cart: [...state.cart, { ...p, qty: 1 }] }
    }
    case 'REMOVE_FROM_CART':
      return { ...state, cart: state.cart.filter((_, i) => i !== action.payload) }
    case 'UPDATE_CART_QTY': {
      const item = state.cart[action.payload.index]
      const delta = action.payload.delta
      // For refills increasing qty: validate saldo
      if (item?.type === 'refill' && delta > 0) {
        const liquid = state.liquids.find(l => l.id === item.liquidId)
        if (liquid) {
          const cartPoints = state.cart
            .filter((c, i) => c.type === 'refill' && c.liquidId === item.liquidId && i !== action.payload.index)
            .reduce((a, c) => a + c.points * c.qty, 0)
          const newQty = item.qty + delta
          if (cartPoints + item.points * newQty > liquid.activeSaldo) {
            return { ...state, _lastError: 'saldo_insuficiente' }
          }
        }
      }
      return { ...state, cart: state.cart.map((c, i) => i === action.payload.index ? { ...c, qty: Math.max(1, c.qty + delta) } : c) }
    }
    case 'CLEAR_CART':
      return { ...state, cart: [] }
    case 'SET_PAYMENT':
      return { ...state, selectedPayment: action.payload }

    // Sales
    case 'ADD_SALE': {
      const newCounter = state.saleCounter + 1
      const sale = {
        ...action.payload,
        id:         action.payload.id         || `s${newCounter}`,
        saleNumber: action.payload.saleNumber || `${state.settings?.invoicePrefix || 'VPS'}-${String(newCounter).padStart(3, '0')}`,
        createdAt:  action.payload.createdAt  || new Date(),
      }
      return {
        ...state,
        sales:       [sale, ...state.sales],
        saleCounter: newCounter,
        cashSession: (() => {
          const paid = Math.max(0, toMoney(sale.amountReceived || sale.total) - toMoney(sale.change))
          const nextSession = {
            ...state.cashSession,
            salePayments: toMoney(state.cashSession.salePayments) + paid,
          }
          return { ...nextSession, sales: recalcCashSales(nextSession) }
        })(),
      }
    }
    case 'DELETE_SALE': {
      const saleToDelete = state.sales.find(s => s.id === action.payload)
      if (!saleToDelete) return { ...state, sales: state.sales.filter(s => s.id !== action.payload) }

      // Revert product stock
      let updatedProducts = state.products
      if (saleToDelete.items?.length) {
        updatedProducts = state.products.map(p => {
          const qty = saleToDelete.items.filter(i => i.productId === p.id).reduce((sum, item) => sum + Number(item.qty || 1), 0)
          if (qty) return { ...p, stock: Number(p.stock || 0) + qty }
          return p
        })
      }

      // Revert liquid saldo and stats
      let updatedLiquids = state.liquids
      if (saleToDelete.refills?.length || saleToDelete.bottleSales?.length) {
        updatedLiquids = state.liquids.map(l => {
          let liq = { ...l }
          // Revert refills
          saleToDelete.refills?.forEach(r => {
            if (r.liquidId === l.id) {
              liq = {
                ...liq,
                activeSaldo:           Number(liq.activeSaldo || 0) + Number(r.pointsConsumed || 0),
                hasActive:             Number(liq.activeSaldo || 0) + Number(r.pointsConsumed || 0) > 0,
                totalPointsConsumedAllTime: Math.max(0, Number(liq.totalPointsConsumedAllTime || 0) - Number(r.pointsConsumed || 0)),
                totalRechargesAllTime: Math.max(0, liq.totalRechargesAllTime - 1),
                totalRevenueAllTime:   Math.max(0, liq.totalRevenueAllTime - r.price),
              }
            }
          })
          // Revert bottle sales
          const bottleLines = (saleToDelete.bottleSales || []).filter(b => b.liquidId === l.id)
          const fullQty = bottleLines.filter(b => !b.isHalf).reduce((sum, b) => sum + Number(b.qty || 1), 0)
          const halfQty = bottleLines.filter(b => b.isHalf).reduce((sum, b) => sum + Number(b.qty || 1), 0)
          const halfDelta = saleToDelete.liquidReversal?.[l.id]?.halfBottleDelta ?? -halfQty
          const canReassemble = Number(liq.halfBottleStock || 0) >= halfDelta
          liq.closedBottles = Number(liq.closedBottles || 0) + fullQty + (canReassemble ? (halfQty + halfDelta) / 2 : 0)
          liq.halfBottleStock = Number(liq.halfBottleStock || 0) + (canReassemble ? -halfDelta : halfQty)
          if ((saleToDelete.refills || []).some(r => r.liquidId === l.id)) {
            const ids = [...new Set([...(liq.activeSessionIds || []), ...(saleToDelete.liquidReversal?.[l.id]?.sessionDebits || []).map(part => part.id)])]
            liq.activeSessionIds = ids
            liq.openBottleCount = Math.max(ids.length, Number(liq.openBottleCount || 0), Math.ceil(liq.activeSaldo / Math.max(1, Number(liq.activeCapacity || liq.sizeML || 100))))
            liq.activeTotalCapacity = Math.max(Number(liq.activeTotalCapacity || 0), liq.openBottleCount * Number(liq.activeCapacity || liq.sizeML || 100))
          }
          return liq
        })
      }

      // Revert cash — only subtract what was actually paid
      const paidAmount = (saleToDelete.amountReceived || saleToDelete.total) - Math.max(0, saleToDelete.change || 0)

      // Revert customer stats and credit
      let updatedCustomers = state.customers
      if (saleToDelete.customerId) {
        updatedCustomers = state.customers.map(c => {
          if (c.id !== saleToDelete.customerId) return c
          return {
            ...c,
            totalSpent:        Math.max(0, (c.totalSpent || 0) - saleToDelete.total),
            totalTransactions: Math.max(0, (c.totalTransactions || 0) - 1),
            // Revert credit: remove the credit that was added in this sale
            creditBalance: Math.max(0, (c.creditBalance || 0) - (saleToDelete.creditAdded || 0)),
            refillRewards: Math.max(0, (c.refillRewards ?? c.totalRefills ?? 0) - (saleToDelete.refillRewardsEarned || saleToDelete.refills?.length || 0) + (saleToDelete.freeRefillRedeemed ? 4 : 0)),
            totalRefills: Math.max(0, (c.totalRefills || 0) - (saleToDelete.refillRewardsEarned || saleToDelete.refills?.length || 0) + (saleToDelete.freeRefillRedeemed ? 4 : 0)),
            rewardPoints: Math.max(0, (c.rewardPoints ?? Math.floor((c.totalSpent || 0) / 50)) - (saleToDelete.rewardPointsEarned || 0) + (saleToDelete.pointsRedeemed || 0)),
          }
        })
      }

      const remainingSales = state.sales.filter(s => s.id !== action.payload)
      const recalculatedCustomers = recalculateCustomerLoyalty(updatedCustomers, remainingSales)

      return {
        ...state,
        sales:     remainingSales,
        products:  updatedProducts,
        liquids:   updatedLiquids,
        customers: recalculatedCustomers,
        fiscalInvoices: state.fiscalInvoices.map(invoice => invoice.saleId === saleToDelete.id ? { ...invoice, status: 'cancelled' } : invoice),
        cashSession: (() => {
          if (saleToDelete.cashSessionId && saleToDelete.cashSessionId !== state.cashSession.id) return state.cashSession
          const nextSession = {
            ...state.cashSession,
            salePayments: Math.max(0, toMoney(Object.prototype.hasOwnProperty.call(state.cashSession, 'salePayments') ? state.cashSession.salePayments : state.cashSession.sales) - paidAmount),
          }
          return { ...nextSession, sales: recalcCashSales(nextSession) }
        })(),
      }
    }

    // Customers
    case 'ADD_CUSTOMER':    return { ...state, customers: [...state.customers, action.payload] }
    case 'UPDATE_CUSTOMER': return { ...state, customers: state.customers.map(c => c.id === action.payload.id ? { ...c, ...action.payload } : c) }
    case 'DELETE_CUSTOMER': return { ...state, customers: state.customers.filter(c => c.id !== action.payload) }

    // Suppliers
    case 'ADD_SUPPLIER':    return { ...state, suppliers: [...state.suppliers, action.payload] }
    case 'UPDATE_SUPPLIER': return { ...state, suppliers: state.suppliers.map(s => s.id === action.payload.id ? { ...s, ...action.payload } : s) }
    case 'DELETE_SUPPLIER': return { ...state, suppliers: state.suppliers.filter(s => s.id !== action.payload) }

    // Users
    case 'ADD_USER':    return { ...state, users: [...state.users, action.payload] }
    case 'UPDATE_USER': return { ...state, users: state.users.map(u => u.id === action.payload.id ? { ...u, ...action.payload } : u) }
    case 'DELETE_USER': return { ...state, users: state.users.filter(u => u.id !== action.payload) }

    // Cash
    case 'SET_CASH_SESSION_ID':
      return { ...state, cashSession: { ...state.cashSession, id: action.payload } }
    case 'OPEN_CASH':
      return { ...state, cashSession: { ...action.payload, open: true, sales: 0, salePayments: 0, expenses: 0, expenseList: [], creditPayments: [] } }
    case 'CLOSE_CASH':
      return { ...state, cashSession: { ...state.cashSession, open: false } }
    case 'ADD_EXPENSE':
      return { ...state, cashSession: { ...state.cashSession, expenses: (state.cashSession.expenses || 0) + action.payload } }
    case 'ADD_EXPENSE_DETAIL': {
      const exp     = action.payload
      const newList = [...(state.cashSession.expenseList || []), exp]
      return { ...state, cashSession: { ...state.cashSession, expenses: (state.cashSession.expenses || 0) + exp.amount, expenseList: newList } }
    }

    // Purchases
    case 'ADD_PURCHASE':
      return { ...state, purchases: [action.payload, ...state.purchases] }

    // Credit payment registered — adds to cash
    case 'UPDATE_CASH_SALES': {
      const payment = { ...action.payload, id: action.payload.id || `cp_${Date.now()}` }
      const nextSession = {
        ...state.cashSession,
        creditPayments: [...(state.cashSession.creditPayments || []), payment],
      }
      return { ...state, cashSession: { ...nextSession, sales: recalcCashSales(nextSession) } }
    }
    case 'EDIT_CREDIT_PAYMENT': {
      const oldPayment = (state.cashSession.creditPayments || []).find(p => p.id === action.payload.id)
      const nextPayments = (state.cashSession.creditPayments || []).map(p => p.id === action.payload.id ? { ...p, ...action.payload, amount: toMoney(action.payload.amount) } : p)
      const delta = toMoney(action.payload.amount) - toMoney(oldPayment?.amount)
      const nextCustomers = action.payload.customerId
        ? state.customers.map(c => c.id === action.payload.customerId ? { ...c, creditBalance: Math.max(0, toMoney(c.creditBalance) - delta) } : c)
        : state.customers
      const nextSession = { ...state.cashSession, creditPayments: nextPayments }
      return { ...state, customers: nextCustomers, cashSession: { ...nextSession, sales: recalcCashSales(nextSession) } }
    }
    case 'DELETE_CREDIT_PAYMENT': {
      const removed = (state.cashSession.creditPayments || []).find(p => p.id === action.payload)
      const nextPayments = (state.cashSession.creditPayments || []).filter(p => p.id !== action.payload)
      const nextCustomers = removed?.customerId
        ? state.customers.map(c => c.id === removed.customerId ? { ...c, creditBalance: toMoney(c.creditBalance) + toMoney(removed.amount) } : c)
        : state.customers
      const nextSession = { ...state.cashSession, creditPayments: nextPayments }
      return { ...state, customers: nextCustomers, cashSession: { ...nextSession, sales: recalcCashSales(nextSession) } }
    }

    // Edit expense
    case 'EDIT_EXPENSE': {
      const updatedList = (state.cashSession.expenseList || []).map(e =>
        e.id === action.payload.id ? { ...e, ...action.payload } : e
      )
      const newTotal = updatedList.reduce((a, e) => a + (e.amount || 0), 0)
      return {
        ...state,
        cashSession: { ...state.cashSession, expenseList: updatedList, expenses: newTotal },
      }
    }

    // Delete expense
    case 'DELETE_EXPENSE': {
      const filteredList = (state.cashSession.expenseList || []).filter(e => e.id !== action.payload)
      const newTotal = filteredList.reduce((a, e) => a + (e.amount || 0), 0)
      return {
        ...state,
        cashSession: { ...state.cashSession, expenseList: filteredList, expenses: newTotal },
      }
    }

    // Settings
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } }

    // Fiscal / NCF
    case 'UPDATE_FISCAL_CONFIG':
      return { ...state, fiscalConfig: { ...(state.fiscalConfig || {}), ...action.payload } }
    case 'ADD_NCF_SEQUENCE':
      return { ...state, ncfSequences: [action.payload, ...state.ncfSequences.filter(s => s.id !== action.payload.id)] }
    case 'UPDATE_NCF_SEQUENCE':
      return { ...state, ncfSequences: state.ncfSequences.map(s => s.id === action.payload.id ? { ...s, ...action.payload } : s) }
    case 'DELETE_NCF_SEQUENCE':
      return { ...state, ncfSequences: state.ncfSequences.filter(s => s.id !== action.payload) }
    case 'CONSUME_NCF_SEQUENCE':
      return { ...state, ncfSequences: state.ncfSequences.map(s => s.id === action.payload.sequenceId ? { ...s, nextNumber: action.payload.nextNumber } : s) }
    case 'ADD_FISCAL_INVOICE':
      return { ...state, fiscalInvoices: [action.payload, ...state.fiscalInvoices.filter(i => i.id !== action.payload.id)] }

    default:
      return state
  }
}

// ── Acciones que NO deben sincronizarse con Firestore ─────────
const NO_SYNC_ACTIONS = new Set([
  'SET_LOADING', 'SET_DATA_LOADED', 'LOAD_ALL',
  'ADD_TO_CART', 'REMOVE_FROM_CART', 'UPDATE_CART_QTY',
  'CLEAR_CART', 'SET_PAYMENT',
  'CONSUME_NCF_SEQUENCE',
  // Products and liquids are handled directly in page handlers
  // to guarantee correct Firestore IDs — skip auto-sync for these
  'ADD_LIQUID', 'EDIT_LIQUID', 'UPDATE_LIQUID', 'DELETE_LIQUID',
  'ADD_PRODUCT', 'UPDATE_PRODUCT', 'DELETE_PRODUCT',
])

export function AppProvider({ children }) {
  const { businessId, currentUser, business } = useAuth()
  const { branchesEnabled, selectedBranchId, selectedBranch } = useBranches()
  const syncRef = useRef(null)
  const revisionRef = useRef(0)

  // Wrapper reducer que captura el estado nuevo para el sync
  const [state, rawDispatch] = useReducer(reducer, getInitialState())
  const stateRef = useRef(state)
  stateRef.current = state

  const sync = useFirestoreSync(businessId, branchesEnabled ? selectedBranchId : null)

  useEffect(() => {
    setOfflineProjection(operation => {
      if (operation.businessId !== businessId) return null
      let projected = stateRef.current
      const apply = (type, payload) => { projected = reducer(projected, { type, payload }) }
      const payload = operation.payload
      if (operation.name === 'commitSale') {
        const sale = payload.sale
        if (!projected.sales.some(item => item.id === sale.id)) {
          for (const item of sale.items || []) apply('DEDUCT_STOCK', { productId: item.productId, qty: item.qty })
          for (const item of sale.refills || []) apply('CONSUME_REFILL', { liquidId: item.liquidId, points: item.pointsConsumed, price: item.price, qty: 1 })
          for (const item of sale.bottleSales || []) apply('SELL_CLOSED_BOTTLE', item)
          apply('ADD_SALE', sale)
          if (payload.fiscalInvoice) apply('ADD_FISCAL_INVOICE', payload.fiscalInvoice)
          projected = { ...projected, cart: [], customers: recalculateCustomerLoyalty(projected.customers, projected.sales).map(customer => customer.id === sale.customerId ? { ...customer, creditBalance: Number(customer.creditBalance || 0) + Number(sale.creditAdded || 0) } : customer) }
        }
      } else if (operation.name === 'reverseSale') apply('DELETE_SALE', payload.saleId)
      else if (operation.name === 'openLiquidBottle') apply('OPEN_BOTTLE', payload)
      else if (operation.name === 'adjustLiquidBalance') apply('ADJUST_SALDO', { liquidId: payload.liquidId, newSaldo: payload.newBalance })
      else if (operation.name === 'addOpenLiquidStock') {
        const previous = projected.liquids.find(item => item.id === payload.liquidId)
          const base = previous ? { ...previous, ...payload.editFields } : { ...payload.liquid, id: payload.liquidId, closedBottles: 0 }
          const balance = Number(base.activeSaldo || 0)
          const count = balance > 0 ? Number(base.openBottleCount || 1) : 0
          apply(previous ? 'UPDATE_LIQUID' : 'ADD_LIQUID', { ...base, hasActive: true,
            activeSaldo: balance + payload.ml,
            openBottleCount: count + 1,
            activeTotalCapacity: Number(base.activeTotalCapacity || count * payload.capacity) + payload.capacity,
          totalOpenedBottles: Number(base.totalOpenedBottles || 0) + 1,
            totalOpenedCapacity: Number(base.totalOpenedCapacity || balance) + payload.ml })
      } else if (operation.name === 'applyBusinessMutation') {
        const field = { products: 'products', liquids: 'liquids', customers: 'customers', suppliers: 'suppliers', purchases: 'purchases', sales: 'sales', cash_sessions: 'cashSessions', ncfSequences: 'ncfSequences', fiscalInvoices: 'fiscalInvoices' }[payload.collection]
        if (field) {
          const previous = projected[field].find(item => item.id === payload.documentId)
          const updated = { ...previous, ...payload.data, id: payload.documentId }
          projected = { ...projected, [field]: payload.action === 'delete' ? projected[field].filter(item => item.id !== payload.documentId) : previous ? projected[field].map(item => item.id === payload.documentId ? updated : item) : [updated, ...projected[field]] }
          if (payload.collection === 'cash_sessions' && (projected.cashSession.id === payload.documentId || payload.data?.open === true)) projected = { ...projected, cashSession: updated }
        }
        if (payload.collection === 'settings' || payload.collection === 'branch_settings') projected = { ...projected, settings: { ...projected.settings, ...payload.data } }
      }
      return { key: `state:${businessId}:${selectedBranchId}:${business?.dataEpoch || 0}`, state: projected }
    })
    return () => setOfflineProjection(null)
  }, [businessId, selectedBranchId, business?.dataEpoch])

  // dispatch sincronizador
  // Calculamos el nuevo estado manualmente ANTES de llamar sync
  // y actualizamos stateRef inmediatamente para que dispatches
  // consecutivos (como en handleCobrar) usen el estado correcto
  const dispatch = (action) => {
    revisionRef.current += 1
    if (action.type === 'OPEN_CASH') action = { ...action, payload: { ...action.payload, id: action.payload.id || crypto.randomUUID() } }
    rawDispatch(action)
    // Siempre calculamos el nuevo estado para mantener stateRef actualizado
    const nextState = reducer(stateRef.current, action)
    stateRef.current = nextState
    if (nextState.dataLoaded && !action._skipSync) {
      writeLocal(`state:${businessId}:${selectedBranchId}:${business?.dataEpoch || 0}`, nextState).catch(error => {
        console.error('No se pudo guardar la copia local:', error)
        window.dispatchEvent(new CustomEvent('vapepos-storage-error', { detail: error.message }))
      })
    }
    if (!action._skipSync && !NO_SYNC_ACTIONS.has(action.type)) {
      sync(action, nextState)
    }
  }

  // Expone helper para que useFirestoreSync pueda inyectar el ID de la caja
  React.useEffect(() => {
    window.__vapepos_set_cash_id = (id) => {
      rawDispatch({ type: 'SET_CASH_SESSION_ID', payload: id })
    }
    return () => { delete window.__vapepos_set_cash_id }
  }, [])

  // Carga inicial desde Firestore
  useEffect(() => {
    if (!businessId) return
    if (business?.resetInProgress) return
    stateRef.current = { ...getInitialState(), dataLoaded: false, loading: true }
    rawDispatch({ type: 'START_DATA_LOAD', payload: stateRef.current })

    async function loadAll() {
      const revision = revisionRef.current
      const cacheKey = `state:${businessId}:${selectedBranchId}:${business?.dataEpoch || 0}`
      const cached = await readLocal(cacheKey).catch(() => null)
      if (cancelled) return
      if (cached && !stateRef.current.dataLoaded) {
        stateRef.current = { ...cached, dataLoaded: true, loading: false, dataError: null }
        rawDispatch({ type: 'LOAD_ALL', payload: cached })
      }
      const pending = (await listOperations()).some(operation => operation.businessId === businessId && operation.uid === currentUser?.id && operation.epoch === (business?.dataEpoch || 0))
      if (!navigator.onLine || pending) {
        if (!cached) rawDispatch({ type: 'SET_DATA_ERROR', payload: 'Conecta este equipo a internet para descargar los datos del negocio antes de trabajar sin conexión.' })
        return
      }
      try {
        const [products, liquids, customers, suppliers, sales, users, purchases, cashSessions, settings, fiscalConfigRows, ncfSequences, fiscalInvoices] = await withLoadDeadline(Promise.all([
          bizGetAll(businessId, 'products',      [where('active', '==', true), orderBy('name')]),
          bizGetAll(businessId, 'liquids',        [orderBy('name')]),
          bizGetAll(businessId, 'customers',      [orderBy('name')]),
          bizGetAll(businessId, 'suppliers',      [orderBy('name')]),
          bizGetAll(businessId, 'sales',          [orderBy('createdAt', 'desc')]),
          bizGetAll(businessId, 'users',          []),
          bizGetAll(businessId, 'purchases',      [orderBy('createdAt', 'desc')]),
          bizGetAll(businessId, 'cash_sessions',  [orderBy('createdAt', 'desc')]),
          getBusinessSettings(businessId, branchesEnabled ? selectedBranchId : null),
          bizGetAll(businessId, 'fiscalConfig', []),
          bizGetAll(businessId, 'ncfSequences', []),
          bizGetAll(businessId, 'fiscalInvoices', [orderBy('createdAt', 'desc')]),
        ]))

        const matchesBranch = item => !branchesEnabled || (selectedBranchId === 'main' ? !item.branchId || item.branchId === 'main' : item.branchId === selectedBranchId)
        const branchProducts = products.filter(matchesBranch)
        const branchLiquids = liquids.filter(matchesBranch)
        const branchSales = sales.filter(matchesBranch)
        const branchPurchases = purchases.filter(matchesBranch)
        const branchCashSessions = cashSessions.filter(matchesBranch)
        const branchFiscalInvoices = fiscalInvoices.filter(matchesBranch)

        // Caja: buscar sesion abierta activa de la sucursal
        const openSession = branchCashSessions.find(s => s.open === true) || null

        // Calcular saleCounter desde las ventas existentes
        const maxCounter = branchSales.reduce((max, s) => {
          const num = parseInt(s.saleNumber?.split('-').pop() || '0')
          return num > max ? num : max
        }, 0)

        const loaded = {
          type: 'LOAD_ALL',
          payload: {
            products: branchProducts, liquids: branchLiquids, customers: recalculateCustomerLoyalty(customers, sales), suppliers, sales: branchSales, users, purchases: branchPurchases,
            fiscalConfig: fiscalConfigRows.find(f => f.id === 'config') || null,
            ncfSequences, fiscalInvoices: branchFiscalInvoices,
            settings: settings || stateRef.current.settings,
            saleCounter: maxCounter,
            cashSession:  openSession || { open: false, sales: 0, expenses: 0, openAmount: 0, expenseList: [] },
            cashSessions: branchCashSessions,
          },
        }
        if (cancelled) return
        if (getSyncStatus().pending || revision !== revisionRef.current) {
          if (!stateRef.current.dataLoaded) rawDispatch({ type: 'SET_DATA_ERROR', payload: 'Hay cambios locales pendientes. Reintenta la carga sin borrar los datos de la aplicación.' })
          return
        }
        stateRef.current = reducer(stateRef.current, loaded)
        rawDispatch(loaded)
        await writeLocal(cacheKey, reducer(getInitialState(), loaded))
      } catch (err) {
        console.warn('loadAll failed:', err.message)
        if (!cancelled) rawDispatch(cached ? { type: 'SET_DATA_LOADED' } : { type: 'SET_DATA_ERROR', payload: 'No se pudieron descargar los datos del negocio. Revisa la conexión e intenta nuevamente.' })
      }
    }

    let cancelled = false
    loadAll()
    const refresh = () => loadAll()
    window.addEventListener('vapepos-synced', refresh)
    return () => { cancelled = true; window.removeEventListener('vapepos-synced', refresh) }
  }, [businessId, branchesEnabled, selectedBranchId, business?.dataEpoch, business?.resetInProgress])

  useEffect(() => {
    rawDispatch({ type: 'CLEAR_CART' })
  }, [selectedBranchId])

  // Alertas reactivas
  const alerts = []
  state.products.forEach(p => {
    if (p.active && p.stock <= p.minStock) {
      alerts.push({ id: `low-stock-${p.id}`, type: 'danger', msg: `${p.name}: Stock bajo (${p.stock} uds)`, module: 'inventory' })
    }
  })
  state.liquids.forEach(l => {
    if (l.hasActive) {
      const pct = Math.round((l.activeSaldo / l.activeCapacity) * 100)
      if (pct <= (state.settings.lowBottleAlert || 10)) {
        alerts.push({ id: `low-bottle-${l.id}`, type: 'warning', msg: `${l.name}: Botella al ${pct}%`, module: 'refills' })
      }
      if (l.activeSaldo <= 0) {
        alerts.push({ id: `empty-${l.id}`, type: 'danger', msg: `${l.name}: Botella agotada`, module: 'refills' })
      }
    }
  })

  return (
    <AppContext.Provider value={{
      state: { ...state, alerts, currentUser: currentUser || state.currentUser, businessId, branchesEnabled, branchId: branchesEnabled ? selectedBranchId : null, selectedBranch },
      dispatch,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
