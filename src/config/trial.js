export const TRIAL_MESSAGE = 'Tu prueba ha concluido. Por favor, contacta a soporte para adquirir el programa de forma permanente.'
export const PURCHASE_OPTIONS = [
  { id: 'autonomo', name: 'Plan Autónomo', price: 5000, months: 2, description: 'Configuras inventario, facturación y los demás módulos por tu cuenta.' },
  { id: 'remoto', name: 'Plan Remoto', price: 8000, months: 3, description: 'Configuración por videollamada, carga de los datos suministrados, inventario, facturación y capacitación. Sistema entregado funcional.' },
  { id: 'presencial', name: 'Plan Presencial', price: 14000, months: 5, description: 'Configuración presencial, organización del inventario, facturación, ventas, sucursales y capacitación para tu equipo. Sistema entregado funcional.' },
]
export function trialDeadline(business) {
  return timestampMillis(business?.trialExpiresAt)
}
export function timestampMillis(value) {
  if (!value) return NaN
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000
  return new Date(value).getTime()
}
export function trialExpired(business, now = Date.now()) {
  return business?.licenseType === 'trial' && (!Number.isFinite(trialDeadline(business)) || now >= trialDeadline(business))
}
export function trialReminderDue(business, now = Date.now()) {
  const remaining = trialDeadline(business) - now
  return business?.licenseType === 'trial' && remaining > 0 && remaining <= 48 * 60 * 60 * 1000
}
