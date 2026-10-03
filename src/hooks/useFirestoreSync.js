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
import { queueOperation } from '../services/offlineSync'
import {
  bizAdd, bizUpdate, bizDelete, bizSet,
  saveBusinessSettings, serverTimestamp,
} from '../services/firestoreService'

export function useFirestoreSync(businessId, branchId = null) {

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
          await bizSet(businessId, 'products', id, { ...data, active: true, ...(branchId ? { branchId } : {}) })
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
          await bizSet(businessId, 'liquids', id, { ...data, ...(branchId ? { branchId } : {}) })
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
          await queueOperation('openLiquidBottle', { liquidId: action.payload.liquidId }, businessId)
          break
        }
        case 'CONSUME_REFILL': {
          throw new Error('Las recargas se guardan junto con su venta mediante commitSale.')
          break
        }
        case 'ADJUST_SALDO': {
          if (!action.payload.reason?.trim()) throw new Error('El ajuste requiere un motivo registrado.')
          await queueOperation('adjustLiquidBalance', { liquidId: action.payload.liquidId, newBalance: Number(action.payload.newSaldo), reason: action.payload.reason }, businessId)
          break
        }
        case 'CLOSE_BOTTLE':
          if (!action.payload.reason?.trim()) throw new Error('Cerrar un frasco requiere un ajuste con motivo registrado.')
          await queueOperation('adjustLiquidBalance', { liquidId: action.payload.liquidId, newBalance: 0, reason: action.payload.reason }, businessId)
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
              ...saleData, ...(branchId ? { branchId } : {}),
              createdAt: serverTimestamp(),
            })
          }
          // Also update cash session sales total in Firestore
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              sales: newState.cashSession.sales,
              salePayments: newState.cashSession.salePayments || 0,
            })
          }
          break
        }
        case 'DELETE_SALE': {
          await queueOperation('reverseSale', { saleId: action.payload }, businessId)
          break
        }

        // ════════════════════════════════════════════════════
        // FISCAL / NCF
        // ════════════════════════════════════════════════════
        case 'UPDATE_FISCAL_CONFIG': {
          await bizSet(businessId, 'fiscalConfig', 'config', action.payload)
          break
        }
        case 'ADD_NCF_SEQUENCE':
        case 'UPDATE_NCF_SEQUENCE': {
          const { id, ...data } = action.payload
          await bizSet(businessId, 'ncfSequences', id, data)
          break
        }
        case 'DELETE_NCF_SEQUENCE':
          await bizDelete(businessId, 'ncfSequences', action.payload)
          break
        case 'ADD_FISCAL_INVOICE': {
          const { id, ...data } = action.payload
          await bizSet(businessId, 'fiscalInvoices', id, {
            ...data, ...(branchId ? { branchId } : {}),
            createdAt: serverTimestamp(),
          })
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
            ...action.payload, ...(branchId ? { branchId } : {}),
            open:        true,
            sales:       0,
            expenses:    0,
            expenseList: [],
          }
          const saved = await bizSet(businessId, 'cash_sessions', action.payload.id, sessionData)
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
              salePayments: session.salePayments || 0,
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
        case 'UPDATE_CASH_SALES':
        case 'EDIT_CREDIT_PAYMENT':
        case 'DELETE_CREDIT_PAYMENT': {
          // Triggered when credit payment is created, edited or deleted
          const session = newState.cashSession
          if (session?.id) {
            await bizUpdate(businessId, 'cash_sessions', session.id, {
              sales:       session.sales,
              salePayments: session.salePayments || 0,
              creditPayments: session.creditPayments || [],
            })
          }
          const affectedCustomerId = action.payload?.customerId || action._customerId
          const affected = affectedCustomerId ? newState.customers.filter(c => c.id === affectedCustomerId) : newState.customers
          for (const customer of affected) {
            if (customer?.id) await bizUpdate(businessId, 'customers', customer.id, { creditBalance: customer.creditBalance || 0 })
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
          await bizSet(businessId, 'purchases', id, { ...data, ...(branchId ? { branchId } : {}) })
          break
        }

        // ════════════════════════════════════════════════════
        // SETTINGS
        // ════════════════════════════════════════════════════
        case 'UPDATE_SETTINGS':
          await saveBusinessSettings(businessId, newState.settings, branchId)
          break

        default:
          break
      }
    } catch (err) {
      console.error(`[FirestoreSync] Error en ${action.type}:`, err.message)
    }
  }, [businessId, branchId])

  return sync
}
