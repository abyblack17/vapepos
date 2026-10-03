// ============================================================
// usePlan.js — Hook central del sistema de planes
// ============================================================

import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useApp }  from '../contexts/AppContext'
import { PLANS }   from '../config/plans'
import { timestampMillis } from '../config/trial'

export function usePlan() {
  const { business, accessNow }   = useAuth()
  const { state }      = useApp()

  // ── Determinar si es trial o plan de pago ────────────────
  const isTrial = business?.licenseType === 'trial' || (business?.licenseType !== 'permanent' && business?.trialUsed === true && business?.trialStartedAt != null)

  // ── Días restantes ───────────────────────────────────────
  const daysLeft = useMemo(() => {
    if (!business?.planExpiresAt) return null
    const expires = new Date(timestampMillis(business.planExpiresAt))
    return Math.ceil((expires - accessNow) / (1000 * 60 * 60 * 24))
  }, [business, accessNow])

  // ── Período de gracia ────────────────────────────────────
  // Trial: sin gracia (al vencer baja inmediatamente)
  // Pago:  1 día de gracia
  const GRACE_DAYS = 0

  // ── Plan activo ──────────────────────────────────────────
  const planKey = useMemo(() => {
    if (!business) return 'basic'
    const plan = business.plan || 'basic'
    if (plan !== 'pro') return 'basic'

    if (business.planExpiresAt) {
      const expires = new Date(timestampMillis(business.planExpiresAt))
      const diffDays = accessNow >= expires.getTime() ? 1 : 0
      // Vencido y sin gracia restante → básico
      if (diffDays > GRACE_DAYS) return 'basic'
    }
    return 'pro'
  }, [business, GRACE_DAYS, accessNow])

  const plan    = PLANS[planKey] || PLANS.basic
  const isPro   = planKey === 'pro'
  const isBasic = planKey === 'basic'

  // ── En período de gracia ─────────────────────────────────
  // Solo aplica a planes de pago (no trial), cuando venció hace <= 1 día
  const inGrace = false // Pro vence sin bloquear el acceso comprado a la plataforma.

  // ── Prueba gratuita ──────────────────────────────────────
  const trialUsed = business?.trialUsed === true

  // ── Contadores actuales ──────────────────────────────────
  const counts = useMemo(() => {
    const now        = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    return {
      products:     (state.products  || []).filter(p => p.active && !p.planLocked).length,
      customers:    (state.customers || []).filter(c => !c.planLocked).length,
      users:        (state.users     || []).filter(u => u.role !== 'Administrador' && !u.planLocked).length,
      monthlySales: (state.sales     || []).filter(s => s.date >= monthStart).length,
    }
  }, [state.products, state.customers, state.users, state.sales])

  const canAdd = (resource) => {
    if (isPro) return true
    const limit = plan.limits?.[resource]
    if (limit === undefined || limit === Infinity) return true
    return counts[resource] < limit
  }

  const hasFeature = (feature) => {
    if (isPro) return true
    return plan.features?.[feature] === true
  }

  const getLimit = (resource) => {
    if (isPro) return Infinity
    return plan.limits?.[resource] ?? Infinity
  }

  const usage = (resource) => {
    const current = counts[resource] || 0
    const limit   = getLimit(resource)
    const pct     = limit === Infinity ? 0 : Math.round((current / limit) * 100)
    return {
      current,
      limit,
      pct,
      isUnlimited: limit === Infinity,
      nearLimit:   limit !== Infinity && pct >= 80,
      atLimit:     limit !== Infinity && current >= limit,
    }
  }

  const isLocked = (resource, item) => item?.planLocked === true

  const upgradeMessage = (resource) => {
    const limit = getLimit(resource)
    const msgs = {
      products:     `Has alcanzado el límite de ${limit} productos del plan Básico.`,
      customers:    `Has alcanzado el límite de ${limit} clientes del plan Básico.`,
      users:        `Has alcanzado el límite de ${limit} empleado del plan Básico.`,
      monthlySales: `Has alcanzado el límite de ${limit} ventas mensuales del plan Básico.`,
    }
    return msgs[resource] || `Límite del plan Básico alcanzado.`
  }

  return {
    planKey,
    plan,
    isPro,
    isBasic,
    isTrial,
    daysLeft,
    inGrace,
    trialUsed,
    counts,
    canAdd,
    hasFeature,
    getLimit,
    usage,
    isLocked,
    upgradeMessage,
  }
}
