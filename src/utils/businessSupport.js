import { timestampMillis, trialDeadline, trialExpired } from '../config/trial.js'

export function businessLicenseStatus(business, now = Date.now()) {
  if (business.licenseType === 'trial') return trialExpired(business, now) ? 'expired' : 'trial'
  if (business.licenseType === 'permanent') return 'permanent'
  return 'legacy'
}
export const LICENSE_LABELS = { trial: 'En prueba', expired: 'Prueba vencida', permanent: 'Acceso permanente', legacy: 'Sin tipo de licencia registrado' }
export function trialRemainingLabel(business, now = Date.now()) {
  if (businessLicenseStatus(business, now) !== 'trial') return ''
  const hours = Math.ceil((trialDeadline(business) - now) / 3600000)
  return hours > 24 ? `${Math.ceil(hours / 24)} días restantes` : `${hours} h restantes`
}
export function lastActivityLabel(value, now = Date.now()) {
  const ms = timestampMillis(value)
  if (!Number.isFinite(ms)) return 'Sin actividad registrada'
  const minutes = Math.max(0, Math.floor((now - ms) / 60000))
  const relative = minutes < 1 ? 'Hace un momento' : minutes < 60 ? `Hace ${minutes} minuto${minutes === 1 ? '' : 's'}` : minutes < 1440 ? `Hace ${Math.floor(minutes / 60)} hora${Math.floor(minutes / 60) === 1 ? '' : 's'}` : `Hace ${Math.floor(minutes / 1440)} día${Math.floor(minutes / 1440) === 1 ? '' : 's'}`
  return `${relative} · ${new Date(ms).toLocaleString('es-DO')}`
}
