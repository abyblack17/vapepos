const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

async function service() {
  const XLSX = await import('xlsx')
  const { jsPDF } = await import('jspdf')
  const { autoTable } = await import('jspdf-autotable')
  const downloads = []
  function TestPDF(options) {
    const doc = new jsPDF(options)
    doc.save = name => downloads.push({ name, buffer: Buffer.from(doc.output('arraybuffer')) })
    return doc
  }
  const context = {
    loadExcelLibrary: async () => ({ ...XLSX, writeFile(wb, name) {
      downloads.push({ name, workbook: XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }) })
    } }),
    loadPDFLibraries: async () => ({ jsPDF: TestPDF, autoTable }),
  }
  const source = fs.readFileSync(path.join(root, 'src/services/exportService.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/export async function/g, 'async function')
  vm.createContext(context)
  vm.runInContext(source, context)
  return { context, downloads, XLSX }
}

test('sales XLSX round-trips, retains total and respects profit permission', async () => {
  const { context, downloads, XLSX } = await service()
  const sales = [{ saleNumber: 'V-01', date: '2026-10-02', total: 850, profit: 350 }]
  for (const profit of [false, true]) {
    await context.exportSalesReport(sales, 'excel', 'Prueba', profit)
    const wb = downloads.at(-1).workbook
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Ventas, { header: 1 })
    assert.equal(rows[0].includes('Ganancia'), profit)
    assert.equal(rows[1][0], 'V-01')
    assert.ok(rows[2].includes('RD$850'))
  }
})

test('sales, inventory and fiscal exports create real PDF files without DOM or CDN globals', async () => {
  const { context, downloads } = await service()
  await context.exportSalesReport([{ total: 850 }], 'pdf', 'Negocio de prueba', true)
  await context.exportInventory([{ name: 'Mango', stock: 2, cost: 500, price: 850 }], 'pdf', 'Negocio de prueba')
  await context.exportFiscalReport([{ ncf: 'B0200000001', total: 850 }], 'pdf', 'Negocio de prueba')
  assert.equal(downloads.length, 3)
  for (const download of downloads) {
    assert.match(download.name, /\.pdf$/)
    assert.equal(download.buffer.subarray(0, 5).toString(), '%PDF-')
    assert.ok(download.buffer.length > 1000)
  }
})

test('export and receipt modules no longer inject external scripts or read CDN globals', () => {
  for (const file of ['src/services/exportService.js', 'src/services/excelDataService.js', 'src/components/pos/InvoiceModal.jsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    assert.doesNotMatch(source, /cdnjs\.cloudflare|window\.XLSX|window\.jspdf|window\.html2canvas|ensureExternalScript/)
    if (file.endsWith('.jsx')) assert.doesNotThrow(() => require('esbuild').transformSync(source, { loader: 'jsx' }))
  }
})
