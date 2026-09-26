export const normalizeText = (value = '') =>
  String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')

export const hasDuplicateName = (rows = [], name = '', currentId = null) => {
  const target = normalizeText(name)
  if (!target) return false
  return rows.some(row => row?.id !== currentId && normalizeText(row?.name) === target)
}

export const hasDuplicateCode = (rows = [], code = '', currentId = null) => {
  const target = normalizeText(code)
  if (!target) return false
  return rows.some(row => row?.id !== currentId && normalizeText(row?.code || row?.sku) === target)
}

export const makeUniqueCode = (rows = [], prefix = '', digits = 6, field = 'code') => {
  const used = new Set(rows.map(row => normalizeText(row?.[field])).filter(Boolean))
  const max = 10 ** digits
  for (let i = 0; i < 60; i += 1) {
    const number = String(Math.floor(Math.random() * max)).padStart(digits, '0')
    const code = `${prefix}${number}`
    if (!used.has(normalizeText(code))) return code
  }
  return `${prefix}${Date.now().toString().slice(-digits)}`
}

export const makeProductSku = (products = []) => makeUniqueCode(products, 'PRD-', 6, 'sku')
export const makeLiquidCode = (liquids = []) => makeUniqueCode(liquids, 'LIQ-', 6, 'sku')
export const makeCustomerCode = (customers = []) => makeUniqueCode(customers, '', 6, 'code')

export const findExistingByNameOrCode = (rows = [], row = {}, codeField = 'sku') => {
  const id = row.id ? String(row.id) : ''
  const name = normalizeText(row.name)
  const code = normalizeText(row[codeField])
  return rows.find(item =>
    (id && String(item.id) === id) ||
    (code && normalizeText(item[codeField]) === code) ||
    (name && normalizeText(item.name) === name)
  )
}
