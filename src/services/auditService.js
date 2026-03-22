// ============================================================
// auditService.js
// Escritura de audit logs desde el cliente (v1).
//
// LIMITACIONES CONOCIDAS (ver plan de migración en README):
//   - El usuario podría mentir en campos no validados por Rules
//   - No garantiza atomicidad con la acción principal
//   - sin `before` confiable para eliminaciones
//
// MITIGACIÓN EN RULES:
//   - userId debe coincidir con request.auth.uid
//   - role debe coincidir con myRole() del token
//   - campos obligatorios validados
//
// MIGRACIÓN FUTURA: Los triggers onDelete/onWrite en Cloud Functions
// reemplazarán este servicio para acciones sensibles.
// ============================================================

import { bizAdd } from './firestoreService'

// Acciones que se registran en audit log
export const AUDIT_ACTIONS = {
  // Ventas
  DELETE_SALE:        'DELETE_SALE',
  // Inventario
  DELETE_PRODUCT:     'DELETE_PRODUCT',
  // Líquidos
  DELETE_LIQUID:      'DELETE_LIQUID',
  ADJUST_SALDO:       'ADJUST_SALDO',
  OPEN_BOTTLE:        'OPEN_BOTTLE',
  // Caja
  CLOSE_CASH:         'CLOSE_CASH',
  // Configuración
  UPDATE_SETTINGS:    'UPDATE_SETTINGS',
  // Clientes / Proveedores
  DELETE_CUSTOMER:    'DELETE_CUSTOMER',
  DELETE_SUPPLIER:    'DELETE_SUPPLIER',
}

export const AUDIT_MODULES = {
  SALES:      'sales',
  INVENTORY:  'inventory',
  LIQUIDS:    'liquids',
  CASH:       'cash',
  SETTINGS:   'settings',
  CUSTOMERS:  'customers',
  SUPPLIERS:  'suppliers',
  USERS:      'users',
}

/**
 * Escribe un audit log en /businesses/{businessId}/audit_logs
 *
 * @param {string} businessId
 * @param {object} params
 * @param {string} params.action        - AUDIT_ACTIONS.*
 * @param {string} params.module        - AUDIT_MODULES.*
 * @param {object} params.currentUser   - { id/uid, name, role }
 * @param {string} params.targetId      - id del documento afectado
 * @param {string} params.targetName    - nombre legible del elemento
 * @param {object} [params.before]      - snapshot antes (opcional, no siempre confiable)
 * @param {object} [params.after]       - snapshot después (opcional)
 */
export async function writeAuditLog(businessId, {
  action,
  module,
  currentUser,
  targetId,
  targetName,
  before = null,
  after  = null,
}) {
  if (!businessId || !action || !currentUser?.id) {
    console.warn('writeAuditLog: faltan parámetros requeridos')
    return
  }

  try {
    await bizAdd(businessId, 'audit_logs', {
      action,
      module,
      userId:     currentUser.id || currentUser.uid,
      userName:   currentUser.name   || 'Usuario',
      role:       currentUser.role   || 'Cajero',
      targetId:   targetId           || '',
      targetName: targetName         || '',
      before,
      after,
      // businessId se añade automáticamente por bizAdd
    })
  } catch (err) {
    // El audit log nunca debe bloquear la acción principal
    console.warn('writeAuditLog failed (non-blocking):', err.message)
  }
}
