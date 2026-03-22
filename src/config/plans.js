// ============================================================
// plans.js — Configuración central de planes VapePOS
// Todos los límites y features se definen aquí.
// Para cambiar un límite, solo toca este archivo.
// ============================================================

export const PLANS = {
  basic: {
    id:          'basic',
    name:        'Básico',
    price:       0,
    color:       '#94a3b8',
    badge:       'badge-gray',

    // ── Límites numéricos ──────────────────────────────────
    limits: {
      products:       25,    // máx productos activos
      customers:      30,    // máx clientes
      users:          1,     // máx empleados (sin contar al admin)
      branches:       0,     // sin sucursales
      monthlySales:   500,   // ventas por mes
      historyDays:    15,    // días de historial en reportes
    },

    // ── Features disponibles ──────────────────────────────
    features: {
      dashboard:           true,
      insights:            true,
      pos:                 true,
      refills:             true,
      refillRendimiento:   false,  // pestaña Rendimiento bloqueada
      history:             true,
      inventory:           true,
      purchases:           true,
      customers:           true,
      suppliers:           false,  // sin acceso a proveedores
      reports:             true,   // solo últimos 15 días
      cash:                true,
      users:               true,
      settings:            true,
      suggestions:         true,
      branches:            false,  // sin sucursales
      exportInventory:     false,  // sin exportar inventario
      exportReports:       false,  // sin exportar reportes
      exportBackup:        false,  // sin copia de seguridad
    },
  },

  pro: {
    id:          'pro',
    name:        'Pro',
    price:       15,         // USD/mes
    color:       '#00e5a0',
    badge:       'badge-green',

    // ── Sin límites en Pro ─────────────────────────────────
    limits: {
      products:       Infinity,
      customers:      Infinity,
      users:          Infinity,
      branches:       Infinity,
      monthlySales:   Infinity,
      historyDays:    Infinity,
    },

    // ── Todas las features ─────────────────────────────────
    features: {
      dashboard:           true,
      insights:            true,
      pos:                 true,
      refills:             true,
      refillRendimiento:   true,
      history:             true,
      inventory:           true,
      purchases:           true,
      customers:           true,
      suppliers:           true,
      reports:             true,
      cash:                true,
      users:               true,
      settings:            true,
      suggestions:         true,
      branches:            true,
      exportInventory:     true,
      exportReports:       true,
      exportBackup:        true,
    },
  },
}

// ── Días de gracia antes de degradar ──────────────────────
export const GRACE_PERIOD_DAYS = 3

// ── Porcentaje para mostrar advertencia de límite cercano ─
export const LIMIT_WARNING_PCT = 80

// ── Helpers ───────────────────────────────────────────────

export function getPlan(planId) {
  return PLANS[planId] || PLANS.basic
}

export function getPlanLimit(planId, resource) {
  return getPlan(planId).limits[resource] ?? 0
}

export function getPlanFeature(planId, feature) {
  return getPlan(planId).features[feature] ?? false
}

// Verifica si un negocio está en período de gracia
export function isInGracePeriod(business) {
  if (!business?.planExpiresAt) return false
  const expires = business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)
  const now     = new Date()
  const diff    = Math.floor((now - expires) / (1000 * 60 * 60 * 24))
  return diff >= 0 && diff <= GRACE_PERIOD_DAYS
}

// Verifica si el plan está vencido (fuera del período de gracia)
export function isPlanExpired(business) {
  if (!business?.planExpiresAt) return false
  const expires = business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)
  const now     = new Date()
  const diff    = Math.floor((now - expires) / (1000 * 60 * 60 * 24))
  return diff > GRACE_PERIOD_DAYS
}

// Días restantes del plan (negativo = vencido)
export function daysRemaining(business) {
  if (!business?.planExpiresAt) return null
  const expires = business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)
  const now     = new Date()
  return Math.ceil((expires - now) / (1000 * 60 * 60 * 24))
}

// Porcentaje de uso de un límite
export function usagePct(current, planId, resource) {
  const limit = getPlanLimit(planId, resource)
  if (limit === Infinity) return 0
  return Math.round((current / limit) * 100)
}
