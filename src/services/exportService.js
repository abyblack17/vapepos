// ── exportService.js ──────────────────────────────────────────
// Exportar datos a Excel (.xlsx) y PDF usando CDN libraries
// xlsx (SheetJS) y jsPDF + jspdf-autotable

const XLSX_CDN    = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
const JSPDF_CDN   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
const AUTOTABLE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js'

async function loadScript(src) {
  if (document.querySelector(`script[src="${src}"]`)) {
    await new Promise(r => setTimeout(r, 100))
    return
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = reject
    document.head.appendChild(s)
  })
}

// ── EXCEL ─────────────────────────────────────────────────────
export async function exportToExcel(rows, columns, filename, sheetName = 'Datos') {
  await loadScript(XLSX_CDN)
  const XLSX = window.XLSX

  const header = columns.map(c => c.label)
  const data   = rows.map(row => columns.map(c => row[c.key] ?? ''))

  const ws = XLSX.utils.aoa_to_sheet([header, ...data])

  // Column widths
  ws['!cols'] = columns.map(c => ({ wch: c.width || 15 }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, `${filename}.xlsx`)
}

// ── PDF ───────────────────────────────────────────────────────
export async function exportToPDF(rows, columns, filename, title, businessName = 'VapePOS') {
  await loadScript(JSPDF_CDN)
  await loadScript(AUTOTABLE_CDN)

  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Header
  doc.setFontSize(16)
  doc.setTextColor(0, 229, 160)
  doc.text('VapePOS', 14, 15)

  doc.setFontSize(11)
  doc.setTextColor(100, 100, 100)
  doc.text(businessName, 14, 22)

  doc.setFontSize(13)
  doc.setTextColor(30, 30, 30)
  doc.text(title, 14, 30)

  doc.setFontSize(9)
  doc.setTextColor(150, 150, 150)
  doc.text(`Generado: ${new Date().toLocaleDateString('es-DO')}`, 14, 36)

  // Table
  doc.autoTable({
    head:       [columns.map(c => c.label)],
    body:       rows.map(row => columns.map(c => row[c.key] ?? '')),
    startY:     42,
    styles:     { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [0, 229, 160], textColor: [8, 13, 24], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: columns.reduce((acc, c, i) => {
      if (c.align) acc[i] = { halign: c.align }
      return acc
    }, {}),
  })

  doc.save(`${filename}.pdf`)
}

// ── INVENTORY EXPORT ──────────────────────────────────────────
export async function exportInventory(products, format, businessName) {
  const columns = [
    { key: 'name',     label: 'Producto',    width: 25 },
    { key: 'category', label: 'Categoria',   width: 15 },
    { key: 'brand',    label: 'Marca',       width: 15 },
    { key: 'sku',      label: 'SKU/Codigo',  width: 12 },
    { key: 'stock',    label: 'Stock',       width: 8,  align: 'right' },
    { key: 'minStock', label: 'Stock Min',   width: 10, align: 'right' },
    { key: 'cost',     label: 'Costo',       width: 12, align: 'right' },
    { key: 'price',    label: 'Precio',      width: 12, align: 'right' },
    { key: 'supplier', label: 'Proveedor',   width: 18 },
    { key: 'status',   label: 'Estado',      width: 12 },
  ]

  const rows = products.map(p => ({
    name:     p.name,
    category: p.category || '—',
    brand:    p.brand    || '—',
    sku:      p.sku      || '—',
    stock:    p.stock,
    minStock: p.minStock || 0,
    cost:     `RD$${p.cost || 0}`,
    price:    `RD$${p.price || 0}`,
    supplier: p.supplier || '—',
    status:   p.stock <= 0 ? 'Sin stock' : p.stock <= (p.minStock || 5) ? 'Stock bajo' : 'OK',
  }))

  const filename = `Inventario-${new Date().toISOString().split('T')[0]}`
  if (format === 'excel') {
    await exportToExcel(rows, columns, filename, 'Inventario')
  } else {
    await exportToPDF(rows, columns, filename, 'Reporte de Inventario', businessName)
  }
}

// ── SALES REPORT EXPORT ───────────────────────────────────────
export async function exportSalesReport(sales, format, businessName, canViewProfit) {
  const columns = [
    { key: 'saleNumber',  label: 'Recibo',    width: 12 },
    { key: 'date',        label: 'Fecha',     width: 14 },
    { key: 'time',        label: 'Hora',      width: 10 },
    { key: 'customerName',label: 'Cliente',   width: 18 },
    { key: 'user',        label: 'Cajero',    width: 18 },
    { key: 'payment',     label: 'Pago',      width: 14 },
    { key: 'total',       label: 'Total',     width: 12, align: 'right' },
    ...(canViewProfit ? [{ key: 'profit', label: 'Ganancia', width: 12, align: 'right' }] : []),
  ]

  const rows = sales.map(s => ({
    saleNumber:   s.saleNumber || '—',
    date:         s.date       || '—',
    time:         s.time       || '—',
    customerName: s.customerName || 'General',
    user:         s.user       || '—',
    payment:      s.payment    || '—',
    total:        `RD$${s.total || 0}`,
    profit:       `RD$${s.profit || 0}`,
  }))

  // Add totals row
  const totalVentas  = sales.reduce((a, s) => a + (s.total  || 0), 0)
  const totalGanancia = sales.reduce((a, s) => a + (s.profit || 0), 0)
  rows.push({
    saleNumber: 'TOTAL',
    date: '', time: '', customerName: '', user: '', payment: '',
    total:  `RD$${totalVentas}`,
    profit: `RD$${totalGanancia}`,
  })

  const filename = `Reporte-Ventas-${new Date().toISOString().split('T')[0]}`
  if (format === 'excel') {
    await exportToExcel(rows, columns, filename, 'Ventas')
  } else {
    await exportToPDF(rows, columns, filename, 'Reporte de Ventas', businessName)
  }
}
