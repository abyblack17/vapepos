// ============================================================
// usePlan.js — Hook central del sistema de planes
// ============================================================

import { useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useApp }  from '../contexts/AppContext'
import { PLANS }   from '../config/plans'

export function usePlan() {
  const { business }   = useAuth()
  const { state }      = useApp()

  // ── Determinar si es trial o plan de pago ────────────────
  const isTrial = business?.trialUsed === true && business?.trialStartedAt != null

  // ── Días restantes ───────────────────────────────────────
  const daysLeft = useMemo(() => {
    if (!business?.planExpiresAt) return null
    const expires = business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)
    return Math.ceil((expires - new Date()) / (1000 * 60 * 60 * 24))
  }, [business])

  // ── Período de gracia ────────────────────────────────────
  // Trial: sin gracia (al vencer baja inmediatamente)
  // Pago:  1 día de gracia
  const GRACE_DAYS = isTrial ? 0 : 1

  // ── Plan activo ──────────────────────────────────────────
  const planKey = useMemo(() => {
    if (!business) return 'basic'
    const plan = business.plan || 'basic'
    if (plan !== 'pro') return 'basic'

    if (business.planExpiresAt) {
      const expires = business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)
      const diffDays = Math.ceil((new Date() - expires) / (1000 * 60 * 60 * 24))
      // Vencido y sin gracia restante → básico
      if (diffDays > GRACE_DAYS) return 'basic'
    }
    return 'pro'
  }, [business, GRACE_DAYS])

  const plan    = PLANS[planKey] || PLANS.basic
  const isPro   = planKey === 'pro'
  const isBasic = planKey === 'basic'

  // ── En período de gracia ─────────────────────────────────
  // Solo aplica a planes de pago (no trial), cuando venció hace <= 1 día
  const inGrace = useMemo(() => {
    if (isTrial) return false              // trial no tiene gracia
    if (!business?.planExpiresAt) return false
    const expires = business.planExpiresAt?.toDate?.() || new Date(business.planExpiresAt)
    const diffDays = Math.ceil((new Date() - expires) / (1000 * 60 * 60 * 24))
    return diffDays >= 0 && diffDays <= GRACE_DAYS
  }, [business, isTrial, GRACE_DAYS])

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
