// ============================================================
// useFirestoreSync.js — v3
//
// REGLA CLAVE: Para documentos que ya existen en Firestore
// (products, liquids, customers, etc.) usamos bizUpdate()
// que actualiza por ID sin riesgo de crear documentos nuevos.
//
// Para documentos nuevos usamos bizSet() con el ID local.
// Para ventas/compras usamos bizSet() porque son siempre nuevos.
// ============================================================

import { useCallback } from 'react'
import {
  bizAdd, bizUpdate, bizDelete, bizSet,
  saveBusinessSettings, serverTimestamp,
} from '../services/firestoreService'

export function useFirestoreSync(businessId) {

  const sync = useCallback(async (action, newState) => {
    if (!businessId) return

    try {
      switch (action.type) {

        // ════════════════════════════════════════════════════
        // PRODUCTS
        // ════════════════════════════════════════════════════
        case 'ADD_PRODUCT': {
          // Nuevo producto: usar bizSet con el id local generado
          const { id, ...data } = action.payload
          await bizSet(businessId, 'products', id, { ...data, active: true })
          break
        }
        case 'UPDATE_PRODUCT': {
          // Producto existente: bizUpdate solo los campos que cambiaron
          const product = newState.products.find(p => p.id === action.payload.id)
          if (product) {
            const { id, ...data } = product
            await bizUpdate(businessId, 'products', id, data)
          }
          break
        }
        case 'DELETE_PRODUCT':
          await bizDelete(businessId, 'products', action.payload)
          break
        case 'DEDUCT_STOCK': {
          const product = newState.products.find(p => p.id === action.payload.productId)
          if (product) {
            await bizUpdate(businessId, 'products', product.id, { stock: product.stock })
          }
          break
        }

        // ════════════════════════════════════════════════════
        // LIQUIDS
        // Usamos bizUpdate para documentos existentes
        // y bizSet solo para documentos nuevos
        // ════════════════════════════════════════════════════
        case 'ADD_LIQUID': {
          const { id, ...data } = action.payload
          await bizSet(businessId, 'liquids', id, data)
          break
        }
        case 'EDIT_LIQUID':
        case 'UPDATE_LIQUID': {
          // Actualizar solo los campos del payload — no el documento completo
          // para evitar pegar el id incorrecto
          const { id, ...fields } = action.payload
          await bizUpdate(businessId, 'liquids', id, fields)
          break
        }
        case 'DELETE_LIQUID':
          await bizDelete(businessId, 'liquids', action.payload)
          break
        case 'OPEN_BOTTLE': {
          const liq = newState.liquids.find(l => l.id === action.payload.liquidId)
          if (liq) {
            await bizUpdate(businessId, 'liquids', liq.id, {
              closedBottles:  liq.closedBottles,
              hasActive:      liq.hasActive,
              activeSaldo:    liq.activeSaldo,
              activeOpenedAt: new Date(),
            })
          }
          break
        }
        case 'CONSUME_REFILL': {
          const liq = newState.liquids.find(l => l.id === action.payload.liquidId)
          if (liq) {
            await bizUpdate(businessId, 'liquids', liq.id, {
              activeSaldo:           liq.activeSaldo,
              totalRechargesAllTime: liq.totalRechargesAllTime,
              totalRevenueAllTime:   liq.totalRevenueAllTime,
            })
          }
          break
        }
        case 'ADJUST_SALDO': {
          await bizUpdate(businessId, 'liquids', action.payload.liquidId, {
            activeSaldo: parseInt(action.payload.newSaldo),
          })
          break
        }
        case 'CLOSE_BOTTLE':
          await bizUpdate(businessId, 'liquids', action.payload.liquidId, {
            hasActive: false, activeSaldo: 0,
          })
          break
        case 'SELL_CLOSED_BOTTLE': {
          const liq = newState.liquids.find(l => l.id === action.payload.liquidId)
          if (liq) {
            await bizUpdate(businessId, 'liquids', liq.id, {
              closedBottles: liq.closedBottles,
            })
          }
          break
        }

        // ════════════════════════════════════════════════════
        // SALES — siempre nuevos, usar bizSet
        // ════════════════════════════════════════════════════
        case 'ADD_SALE': {
          const sale = newState.sales[0]
          if (sale) {
            const { id, ...saleData } = sale
            await bizSet(businessId, 'sales', id, {
              ...saleData,
              createdAt: serverTimestamp(),
            })
          }
          // Also update cash session sales total in Firestore
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              sales: newState.cashSession.sales,
            })
          }
          break
        }
        case 'DELETE_SALE': {
          await bizDelete(businessId, 'sales', action.payload)
          // Revert product stock in Firestore
          const productsToUpdate = newState.products.filter(p => {
            const sale = action._sale
            return sale?.items?.some(i => i.productId === p.id)
          })
          for (const p of productsToUpdate) {
            await bizUpdate(businessId, 'products', p.id, { stock: p.stock })
          }
          // Revert liquid saldo in Firestore
          const liquidsToUpdate = newState.liquids.filter(l => {
            const sale = action._sale
            return sale?.refills?.some(r => r.liquidId === l.id) ||
                   sale?.bottleSales?.some(b => b.liquidId === l.id)
          })
          for (const l of liquidsToUpdate) {
            await bizUpdate(businessId, 'liquids', l.id, {
              activeSaldo:           l.activeSaldo,
              totalRechargesAllTime: l.totalRechargesAllTime,
              totalRevenueAllTime:   l.totalRevenueAllTime,
              closedBottles:         l.closedBottles,
            })
          }
          // Update cash session
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, { sales: session.sales })
          }
          // Revert customer stats in Firestore
          if (action._sale?.customerId) {
            const customer = newState.customers.find(c => c.id === action._sale.customerId)
            if (customer) {
              await bizUpdate(businessId, 'customers', customer.id, {
                totalSpent:        customer.totalSpent,
                totalTransactions: customer.totalTransactions,
                creditBalance:     customer.creditBalance,
              })
            }
          }
          break
        }

        // ════════════════════════════════════════════════════
        // CUSTOMERS
        // ════════════════════════════════════════════════════
        case 'ADD_CUSTOMER': {
          const { id, ...data } = action.payload
          await bizSet(businessId, 'customers', id, data)
          break
        }
        case 'UPDATE_CUSTOMER': {
          const { id, ...data } = action.payload
          if (id) await bizUpdate(businessId, 'customers', id, data)
          break
        }
        case 'DELETE_CUSTOMER':
          await bizDelete(businessId, 'customers', action.payload)
          break

        // ════════════════════════════════════════════════════
        // SUPPLIERS
        // ════════════════════════════════════════════════════
        case 'ADD_SUPPLIER': {
          const { id, ...data } = action.payload
          await bizSet(businessId, 'suppliers', id, data)
          break
        }
        case 'UPDATE_SUPPLIER': {
          const { id, ...data } = action.payload
          await bizUpdate(businessId, 'suppliers', id, data)
          break
        }
        case 'DELETE_SUPPLIER':
          await bizDelete(businessId, 'suppliers', action.payload)
          break

        // ════════════════════════════════════════════════════
        // CASH SESSIONS
        // ════════════════════════════════════════════════════
        case 'OPEN_CASH': {
          const sessionData = {
            ...action.payload,
            open:        true,
            sales:       0,
            expenses:    0,
            expenseList: [],
          }
          const saved = await bizAdd(businessId, 'cash_sessions', sessionData)
          if (saved?.id) {
            setTimeout(() => { window.__vapepos_set_cash_id?.(saved.id) }, 100)
          }
          break
        }
        case 'CLOSE_CASH': {
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              open:      false,
              closeTime: new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
              sales:     session.sales,
              expenses:  session.expenses,
            })
          }
          break
        }
        case 'ADD_EXPENSE':
        case 'ADD_EXPENSE_DETAIL': {
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              expenses:    session.expenses,
              expenseList: session.expenseList || [],
            })
          }
          break
        }
        case 'UPDATE_CASH_SALES': {
          // Triggered when credit payment is received
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              sales:       session.sales,
              creditPayments: session.creditPayments || [],
            })
          }
          break
        }
        case 'EDIT_EXPENSE': {
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              expenses:    session.expenses,
              expenseList: session.expenseList || [],
            })
          }
          break
        }
        case 'DELETE_EXPENSE': {
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              expenses:    session.expenses,
              expenseList: session.expenseList || [],
            })
          }
          break
        }

        // ════════════════════════════════════════════════════
        // PURCHASES — siempre nuevos
        // ════════════════════════════════════════════════════
        case 'ADD_PURCHASE': {
          const { id, ...data } = action.payload
          await bizSet(businessId, 'purchases', id, data)
          break
        }

        // ════════════════════════════════════════════════════
        // SETTINGS
        // ════════════════════════════════════════════════════
        case 'UPDATE_SETTINGS':
          await saveBusinessSettings(businessId, newState.settings)
          break

        default:
          break
      }
    } catch (err) {
      console.error(`[FirestoreSync] Error en ${action.type}:`, err.message)
    }
  }, [businessId])

  return sync
}
