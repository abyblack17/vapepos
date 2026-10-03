import { exportToExcel } from './exportService'
import { loadExcelLibrary as loadXLSX } from './exportLibraries'

const normalize = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '')

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback
  const cleaned = String(value).replace(/rd\$|,/gi, '').trim()
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : fallback
}

const toBool = (value, fallback = true) => {
  if (value === null || value === undefined || value === '') return fallback
  const text = String(value).trim().toLowerCase()
  if (['si', 'sí', 'true', '1', 'activo', 'activa', 'yes'].includes(text)) return true
  if (['no', 'false', '0', 'inactivo', 'inactiva'].includes(text)) return false
  return fallback
}

const toText = (value, fallback = '') => String(value ?? fallback).trim()

export const EXCEL_SCHEMAS = {
  products: {
    title: 'Inventario de Productos',
    filename: 'Inventario-Productos',
    sheetName: 'Productos',
    required: ['name'],
    columns: [
      { key: 'id', label: 'ID', width: 18 },
      { key: 'name', label: 'Nombre', width: 28, required: true },
      { key: 'category', label: 'Categoria', width: 18 },
      { key: 'brand', label: 'Marca', width: 18 },
      { key: 'sku', label: 'SKU', width: 18 },
      { key: 'barcode', label: 'Codigo de Barras', width: 22 },
      { key: 'cost', label: 'Costo', width: 12, type: 'number' },
      { key: 'price', label: 'Precio', width: 12, type: 'number' },
      { key: 'taxIncluded', label: 'ITBIS Incluido', width: 14, type: 'boolean' },
      { key: 'stock', label: 'Stock', width: 10, type: 'number' },
      { key: 'minStock', label: 'Stock Minimo', width: 12, type: 'number' },
      { key: 'supplier', label: 'Proveedor', width: 22 },
      { key: 'description', label: 'Descripcion', width: 34 },
      { key: 'imageUrl', label: 'Imagen URL', width: 36 },
      { key: 'color', label: 'Color', width: 12 },
      { key: 'active', label: 'Activo', width: 10, type: 'boolean' },
    ],
    normalizeRow(row) {
      return {
        id: toText(row.id),
        name: toText(row.name),
        category: toText(row.category, 'Otros') || 'Otros',
        brand: toText(row.brand),
        sku: toText(row.sku),
        barcode: toText(row.barcode),
        cost: toNumber(row.cost),
        price: toNumber(row.price),
        taxIncluded: toBool(row.taxIncluded, false),
        stock: toNumber(row.stock),
        minStock: toNumber(row.minStock, 5),
        supplier: toText(row.supplier),
        description: toText(row.description),
        imageUrl: toText(row.imageUrl),
        color: toText(row.color),
        active: toBool(row.active, true),
      }
    },
  },
  liquids: {
    title: 'Inventario de Líquidos / Recargas',
    filename: 'Inventario-Liquidos',
    sheetName: 'Liquidos',
    required: ['name'],
    columns: [
      { key: 'id', label: 'ID', width: 18 },
      { key: 'name', label: 'Nombre', width: 28, required: true },
      { key: 'brand', label: 'Marca', width: 18 },
      { key: 'flavor', label: 'Sabor', width: 18 },
      { key: 'category', label: 'Categoria', width: 16 },
      { key: 'sizeML', label: 'Tamano ML', width: 12, type: 'number' },
      { key: 'costPerBottle', label: 'Costo Botella', width: 14, type: 'number' },
      { key: 'pricePerBottle', label: 'Precio Botella', width: 14, type: 'number' },
      { key: 'taxIncluded', label: 'ITBIS Incluido', width: 14, type: 'boolean' },
      { key: 'closedBottles', label: 'Botellas Cerradas', width: 16, type: 'number' },
      { key: 'hasActive', label: 'Tiene Botella Activa', width: 18, type: 'boolean' },
      { key: 'activeCapacity', label: 'Capacidad Activa Pts', width: 18, type: 'number' },
      { key: 'activeSaldo', label: 'Saldo Activo Pts', width: 16, type: 'number' },
      { key: 'pointsR50', label: 'Pts RD$50', width: 12, type: 'number' },
      { key: 'pointsR100', label: 'Pts RD$100', width: 12, type: 'number' },
      { key: 'pointsR150', label: 'Pts RD$150', width: 12, type: 'number' },
      { key: 'nicotinaFreebase', label: 'Nicotina Freebase', width: 18 },
      { key: 'nicotinaSales', label: 'Nicotina Sales', width: 18 },
      { key: 'imageUrl', label: 'Imagen URL', width: 36 },
      { key: 'color', label: 'Color', width: 12 },
      { key: 'active', label: 'Activo', width: 10, type: 'boolean' },
    ],
    normalizeRow(row) {
      const activeCapacity = toNumber(row.activeCapacity, 100)
      return {
        id: toText(row.id),
        name: toText(row.name),
        brand: toText(row.brand),
        flavor: toText(row.flavor),
        category: toText(row.category, 'Frutas') || 'Frutas',
        sizeML: toNumber(row.sizeML, 100),
        costPerBottle: toNumber(row.costPerBottle),
        pricePerBottle: toNumber(row.pricePerBottle),
        taxIncluded: toBool(row.taxIncluded, false),
        closedBottles: toNumber(row.closedBottles),
        hasActive: toBool(row.hasActive, false),
        activeCapacity,
        activeSaldo: toNumber(row.activeSaldo, 0),
        pointsR50: toNumber(row.pointsR50, 10),
        pointsR100: toNumber(row.pointsR100, 20),
        pointsR150: toNumber(row.pointsR150, 30),
        totalRechargesAllTime: toNumber(row.totalRechargesAllTime, 0),
        totalRevenueAllTime: toNumber(row.totalRevenueAllTime, 0),
        nicotinaFreebase: toText(row.nicotinaFreebase, 'ninguna') || 'ninguna',
        nicotinaSales: toText(row.nicotinaSales, 'ninguna') || 'ninguna',
        imageUrl: toText(row.imageUrl),
        color: toText(row.color),
        active: toBool(row.active, true),
      }
    },
  },
  customers: {
    title: 'Clientes',
    filename: 'Clientes',
    sheetName: 'Clientes',
    required: ['name'],
    columns: [
      { key: 'id', label: 'ID', width: 18 },
      { key: 'code', label: 'Codigo', width: 14 },
      { key: 'name', label: 'Nombre', width: 28, required: true },
      { key: 'phone', label: 'Telefono', width: 16 },
      { key: 'email', label: 'Email', width: 26 },
      { key: 'totalSpent', label: 'Total Comprado', width: 16, type: 'number' },
      { key: 'creditBalance', label: 'Deuda', width: 12, type: 'number' },
      { key: 'refillRewards', label: 'Recargas Acumuladas', width: 20, type: 'number' },
      { key: 'rewardPoints', label: 'Puntos', width: 12, type: 'number' },
      { key: 'totalTransactions', label: 'Transacciones', width: 14, type: 'number' },
      { key: 'lastPurchase', label: 'Ultima Compra', width: 16 },
      { key: 'notes', label: 'Notas', width: 34 },
    ],
    normalizeRow(row) {
      const totalSpent = toNumber(row.totalSpent)
      return {
        id: toText(row.id),
        code: toText(row.code),
        name: toText(row.name),
        phone: toText(row.phone),
        email: toText(row.email),
        totalSpent,
        creditBalance: toNumber(row.creditBalance),
        refillRewards: toNumber(row.refillRewards),
        totalRefills: toNumber(row.refillRewards),
        rewardPoints: row.rewardPoints === '' || row.rewardPoints === undefined ? Math.floor(totalSpent / 50) : toNumber(row.rewardPoints),
        totalTransactions: toNumber(row.totalTransactions),
        lastPurchase: row.lastPurchase || null,
        notes: toText(row.notes),
        createdAt: new Date(),
      }
    },
  },
  suppliers: {
    title: 'Proveedores',
    filename: 'Proveedores',
    sheetName: 'Proveedores',
    required: ['name'],
    columns: [
      { key: 'id', label: 'ID', width: 18 },
      { key: 'name', label: 'Nombre', width: 28, required: true },
      { key: 'phone', label: 'Telefono', width: 16 },
      { key: 'email', label: 'Email', width: 26 },
      { key: 'address', label: 'Direccion', width: 34 },
      { key: 'products', label: 'Productos', width: 34 },
      { key: 'notes', label: 'Notas', width: 34 },
    ],
    normalizeRow(row) {
      return {
        id: toText(row.id),
        name: toText(row.name),
        phone: toText(row.phone),
        email: toText(row.email),
        address: toText(row.address),
        products: toText(row.products),
        notes: toText(row.notes),
        createdAt: new Date(),
      }
    },
  },
  purchases: {
    title: 'Compras',
    filename: 'Compras',
    sheetName: 'Compras',
    required: ['supplier', 'itemsText'],
    columns: [
      { key: 'id', label: 'ID', width: 18 },
      { key: 'date', label: 'Fecha', width: 14 },
      { key: 'time', label: 'Hora', width: 12 },
      { key: 'supplier', label: 'Proveedor', width: 24, required: true },
      { key: 'itemsText', label: 'Articulos', width: 60, required: true },
      { key: 'total', label: 'Total', width: 14, type: 'number' },
      { key: 'registeredBy', label: 'Registrado Por', width: 18 },
      { key: 'notes', label: 'Notas', width: 34 },
    ],
    toRow(purchase) {
      return {
        ...purchase,
        itemsText: (purchase.items || []).map(i => `${i.name}|${i.qty}|${i.unitPrice}`).join('; '),
      }
    },
    normalizeRow(row) {
      const items = String(row.itemsText || '').split(';').map(part => {
        const [name, qty, unitPrice] = part.split('|').map(v => String(v || '').trim())
        const nQty = toNumber(qty, 1)
        const nPrice = toNumber(unitPrice, 0)
        return name ? { name, qty: nQty, unitPrice: nPrice, total: nQty * nPrice } : null
      }).filter(Boolean)
      const total = row.total === '' || row.total === undefined
        ? items.reduce((a, i) => a + i.total, 0)
        : toNumber(row.total)
      return {
        id: toText(row.id),
        date: row.date || new Date().toISOString().split('T')[0],
        time: row.time || new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
        supplier: toText(row.supplier, 'Sin proveedor') || 'Sin proveedor',
        items,
        total,
        registeredBy: toText(row.registeredBy, 'Importado') || 'Importado',
        notes: toText(row.notes),
        createdAt: new Date(),
      }
    },
  },
  users: {
    title: 'Usuarios',
    filename: 'Usuarios',
    sheetName: 'Usuarios',
    required: ['name', 'email', 'role'],
    columns: [
      { key: 'id', label: 'ID', width: 22 },
      { key: 'name', label: 'Nombre', width: 26, required: true },
      { key: 'email', label: 'Email', width: 30, required: true },
      { key: 'role', label: 'Rol', width: 18, required: true },
      { key: 'active', label: 'Activo', width: 10, type: 'boolean' },
      { key: 'password', label: 'Password Solo Importar', width: 22 },
    ],
    normalizeRow(row) {
      return {
        id: toText(row.id),
        name: toText(row.name),
        email: toText(row.email),
        role: toText(row.role, 'Empleado') || 'Empleado',
        active: toBool(row.active, true),
        password: toText(row.password),
        createdAt: new Date(),
      }
    },
  },
}

function rowFromSheet(raw, columns) {
  const aliases = {}
  columns.forEach(col => {
    aliases[normalize(col.label)] = col.key
    aliases[normalize(col.key)] = col.key
  })
  return Object.entries(raw).reduce((acc, [header, value]) => {
    const key = aliases[normalize(header)]
    if (key) acc[key] = value
    return acc
  }, {})
}

export async function exportEntityToExcel(entity, rows = []) {
  const schema = EXCEL_SCHEMAS[entity]
  if (!schema) throw new Error('Tipo de exportacion no soportado')
  const exportRows = rows.map(row => schema.toRow ? schema.toRow(row) : row)
  const filename = `${schema.filename}-${new Date().toISOString().split('T')[0]}`
  await exportToExcel(exportRows, schema.columns, filename, schema.sheetName)
}

export async function downloadImportTemplate(entity) {
  const schema = EXCEL_SCHEMAS[entity]
  if (!schema) throw new Error('Tipo de plantilla no soportado')
  const sample = schema.columns.reduce((acc, col) => ({ ...acc, [col.key]: '' }), {})
  await exportToExcel([sample], schema.columns, `Plantilla-${schema.filename}`, schema.sheetName)
}

export async function parseEntityExcelFile(entity, file) {
  const schema = EXCEL_SCHEMAS[entity]
  if (!schema) throw new Error('Tipo de importacion no soportado')
  const XLSX = await loadXLSX()
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

  const rows = rawRows.map(raw => schema.normalizeRow(rowFromSheet(raw, schema.columns)))
    .filter(row => schema.required.every(key => row[key] !== undefined && row[key] !== null && row[key] !== ''))

  return rows
}
