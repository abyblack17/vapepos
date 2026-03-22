import React, { createContext, useContext, useReducer, useEffect, useRef } from 'react'
import { orderBy, where } from 'firebase/firestore'
import { useAuth } from './AuthContext'
import { bizGetAll, getBusinessSettings } from '../services/firestoreService'
import { useFirestoreSync } from '../hooks/useFirestoreSync'

// ── Estado inicial vacío ──────────────────────────────────────
function getInitialState() {
  return {
    products:        [],
    liquids:         [],
    customers:       [],
    suppliers:       [],
    sales:           [],
    users:           [],
    purchases:       [],
    cashSession:     { open: false, sales: 0, expenses: 0, openAmount: 0, expenseList: [] },
    settings: {
      businessName: '', phone: '', address: '', currency: 'RD$', taxRate: 18,
      defaultPointsR50: 10, defaultPointsR100: 20, defaultPointsR150: 30,
      defaultBottleCapacity: 100, lowStockThreshold: 5, lowBottleAlert: 10,
      invoiceHeader: 'VapePOS', invoiceFooter: 'Gracias por su compra!',
      invoicePrefix: 'VPS',
      discounts: [], services: [],
      paperSize: '80mm', printCopies: '1',
      printLogo: true, printAddress: true, printPhone: true,
      printTax: true, printProfit: false, printQR: false,
    },
    cashSessions:    [],
    cart:            [],
    selectedPayment: 'Efectivo',
    saleCounter:     0,
    loading:         false,
    dataLoaded:      false,
  }
}

const AppContext = createContext(null)

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':     return { ...state, loading: action.payload }
    case 'SET_DATA_LOADED': return { ...state, dataLoaded: true, loading: false }
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
          ? { ...l, closedBottles: Math.max(0, l.closedBottles - 1), hasActive: true, activeSaldo: l.activeCapacity, activeOpenedAt: new Date() }
          : l
      )}
    case 'CONSUME_REFILL':
      return { ...state, liquids: state.liquids.map(l =>
        l.id === action.payload.liquidId
          ? { ...l,
              activeSaldo:           Math.max(0, l.activeSaldo - action.payload.points),
              totalRechargesAllTime: l.totalRechargesAllTime + (action.payload.qty || 1),
              totalRevenueAllTime:   l.totalRevenueAllTime + action.payload.price,
            }
          : l
      )}
    case 'ADJUST_SALDO':
      return { ...state, liquids: state.liquids.map(l => l.id === action.payload.liquidId ? { ...l, activeSaldo: parseInt(action.payload.newSaldo) } : l) }
    case 'CLOSE_BOTTLE':
      return { ...state, liquids: state.liquids.map(l => l.id === action.payload.liquidId ? { ...l, hasActive: false, activeSaldo: 0 } : l) }
    case 'SELL_CLOSED_BOTTLE':
      return { ...state, liquids: state.liquids.map(l =>
        l.id === action.payload.liquidId ? { ...l, closedBottles: Math.max(0, l.closedBottles - (action.payload.qty || 1)) } : l
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
        cashSession: {
          ...state.cashSession,
          // Ventas: solo suma lo realmente cobrado (total - credito - devuelve cambio)
          sales: (state.cashSession.sales || 0) +
            (sale.amountReceived || sale.total) -
            Math.max(0, sale.change || 0),
        },
      }
    }
    case 'DELETE_SALE': {
      const saleToDelete = state.sales.find(s => s.id === action.payload)
      if (!saleToDelete) return { ...state, sales: state.sales.filter(s => s.id !== action.payload) }

      // Revert product stock
      let updatedProducts = state.products
      if (saleToDelete.items?.length) {
        updatedProducts = state.products.map(p => {
          const soldItem = saleToDelete.items.find(i => i.productId === p.id)
          if (soldItem) return { ...p, stock: p.stock + soldItem.qty }
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
                activeSaldo:           Math.min(liq.activeCapacity, liq.activeSaldo + (r.pointsConsumed || 0)),
                totalRechargesAllTime: Math.max(0, liq.totalRechargesAllTime - 1),
                totalRevenueAllTime:   Math.max(0, liq.totalRevenueAllTime - r.price),
              }
            }
          })
          // Revert bottle sales
          saleToDelete.bottleSales?.forEach(b => {
            if (b.liquidId === l.id) {
              liq = { ...liq, closedBottles: liq.closedBottles + (b.qty || 1) }
            }
          })
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
          }
        })
      }

      return {
        ...state,
        sales:     state.sales.filter(s => s.id !== action.payload),
        products:  updatedProducts,
        liquids:   updatedLiquids,
        customers: updatedCustomers,
        cashSession: {
          ...state.cashSession,
          sales: Math.max(0, (state.cashSession.sales || 0) - paidAmount),
        },
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
      return { ...state, cashSession: { ...action.payload, open: true, sales: 0, expenses: 0, expenseList: [] } }
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
    case 'UPDATE_CASH_SALES':
      return {
        ...state,
        cashSession: {
          ...state.cashSession,
          sales: (state.cashSession.sales || 0) + action.payload.amount,
          creditPayments: [...(state.cashSession.creditPayments || []), action.payload],
        },
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

    default:
      return state
  }
}

// ── Acciones que NO deben sincronizarse con Firestore ─────────
const NO_SYNC_ACTIONS = new Set([
  'SET_LOADING', 'SET_DATA_LOADED', 'LOAD_ALL',
  'ADD_TO_CART', 'REMOVE_FROM_CART', 'UPDATE_CART_QTY',
  'CLEAR_CART', 'SET_PAYMENT',
  // Products and liquids are handled directly in page handlers
  // to guarantee correct Firestore IDs — skip auto-sync for these
  'ADD_LIQUID', 'EDIT_LIQUID', 'UPDATE_LIQUID', 'DELETE_LIQUID',
  'ADD_PRODUCT', 'UPDATE_PRODUCT', 'DELETE_PRODUCT',
])

export function AppProvider({ children }) {
  const { businessId, currentUser } = useAuth()
  const syncRef = useRef(null)

  // Wrapper reducer que captura el estado nuevo para el sync
  const [state, rawDispatch] = useReducer(reducer, getInitialState())
  const stateRef = useRef(state)
  stateRef.current = state

  const sync = useFirestoreSync(businessId)

  // dispatch sincronizador
  // Calculamos el nuevo estado manualmente ANTES de llamar sync
  // y actualizamos stateRef inmediatamente para que dispatches
  // consecutivos (como en handleCobrar) usen el estado correcto
  const dispatch = (action) => {
    rawDispatch(action)
    // Siempre calculamos el nuevo estado para mantener stateRef actualizado
    const nextState = reducer(stateRef.current, action)
    stateRef.current = nextState
    if (!NO_SYNC_ACTIONS.has(action.type)) {
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
    dispatch({ type: 'SET_LOADING', payload: true })

    async function loadAll() {
      try {
        const [products, liquids, customers, suppliers, sales, users, purchases, cashSessions, settings] = await Promise.all([
          bizGetAll(businessId, 'products',      [where('active', '==', true), orderBy('name')]),
          bizGetAll(businessId, 'liquids',        [orderBy('name')]),
          bizGetAll(businessId, 'customers',      [orderBy('name')]),
          bizGetAll(businessId, 'suppliers',      [orderBy('name')]),
          bizGetAll(businessId, 'sales',          [orderBy('createdAt', 'desc')]),
          bizGetAll(businessId, 'users',          []),
          bizGetAll(businessId, 'purchases',      [orderBy('createdAt', 'desc')]),
          bizGetAll(businessId, 'cash_sessions',  [orderBy('createdAt', 'desc')]),
          getBusinessSettings(businessId),
        ])

        // Caja: buscar sesion abierta activa
        const openSession = cashSessions.find(s => s.open === true) || null

        // Calcular saleCounter desde las ventas existentes
        const maxCounter = sales.reduce((max, s) => {
          const num = parseInt(s.saleNumber?.split('-').pop() || '0')
          return num > max ? num : max
        }, 0)

        rawDispatch({
          type: 'LOAD_ALL',
          payload: {
            products, liquids, customers, suppliers, sales, users, purchases,
            settings: settings || stateRef.current.settings,
            saleCounter: maxCounter,
            cashSession:  openSession || stateRef.current.cashSession,
        cashSessions: cashSessions,
          },
        })
      } catch (err) {
        console.warn('loadAll failed:', err.message)
        rawDispatch({ type: 'SET_DATA_LOADED' })
      }
    }

    loadAll()
  }, [businessId])

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
      state: { ...state, alerts, currentUser: currentUser || state.currentUser, businessId },
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
