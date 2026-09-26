export const FISCAL_TYPES = {
  none: { code: 'NONE', prefix: '', label: 'Venta normal / Sin NCF', shortLabel: 'Sin NCF', requiresCustomer: false },
  B02:  { code: 'B02', prefix: 'B02', label: 'Factura de Consumo', shortLabel: 'Consumo', requiresCustomer: false },
  B01:  { code: 'B01', prefix: 'B01', label: 'Crédito Fiscal', shortLabel: 'Crédito Fiscal', requiresCustomer: true },
  B15:  { code: 'B15', prefix: 'B15', label: 'Gubernamental', shortLabel: 'Gubernamental', requiresCustomer: true },
  B14:  { code: 'B14', prefix: 'B14', label: 'Regímenes Especiales', shortLabel: 'Rég. Especial', requiresCustomer: true },
  B04:  { code: 'B04', prefix: 'B04', label: 'Nota de Crédito', shortLabel: 'Nota Crédito', requiresCustomer: true },
  B03:  { code: 'B03', prefix: 'B03', label: 'Nota de Débito', shortLabel: 'Nota Débito', requiresCustomer: true },
}

export const FISCAL_TYPE_OPTIONS = Object.values(FISCAL_TYPES).filter(t => t.code !== 'NONE')

export function fiscalTypeLabel(code) {
  return FISCAL_TYPES[code]?.label || code || 'Venta normal'
}

export function padNCFNumber(value) {
  return String(Number(value || 0)).padStart(8, '0')
}

export function buildNCF(prefix, number) {
  return `${prefix}${padNCFNumber(number)}`
}

export function isSequenceExpired(sequence, todayStr = new Date().toISOString().split('T')[0]) {
  return !!sequence?.expiresAt && sequence.expiresAt < todayStr
}

export function sequenceAvailable(sequence) {
  if (!sequence || sequence.active === false) return false
  if (isSequenceExpired(sequence)) return false
  return Number(sequence.nextNumber || 0) <= Number(sequence.endNumber || 0)
}

export function sequenceRemaining(sequence) {
  if (!sequence) return 0
  return Math.max(0, Number(sequence.endNumber || 0) - Number(sequence.nextNumber || 0) + 1)
}

export function findActiveSequence(sequences, typeCode) {
  return (sequences || []).find(s => s.typeCode === typeCode && sequenceAvailable(s)) || null
}

export function validateRncCedula(value) {
  const clean = String(value || '').replace(/\D/g, '')
  return clean.length === 9 || clean.length === 11
}

export function fiscalConfigFromSettings(settings = {}) {
  return {
    businessName: settings.businessName || '',
    legalName: settings.legalName || settings.businessName || '',
    rnc: settings.rnc || '',
    address: settings.address || '',
    phone: settings.phone || '',
    email: settings.email || '',
    fiscalRegime: settings.fiscalRegime || '',
    enabled: settings.fiscalEnabled ?? false,
  }
}
