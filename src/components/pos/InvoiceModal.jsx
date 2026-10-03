import React, { useEffect, useRef, useState } from 'react'
import { useApp } from '../../contexts/AppContext'
import { fmt } from '../../utils/helpers'
import toast from 'react-hot-toast'
import { isBluetoothPrinterSupported, printSaleByBluetooth } from '../../services/bluetoothPrinterService'
import { loadPDFLibrary, loadReceiptCapture } from '../../services/exportLibraries'

export function buildWhatsAppText(sale, settings) {
  const biz = settings?.businessName || 'VapePOS'
  const footer = settings?.invoiceFooter || 'Gracias por su compra!'
  const lines = []
  lines.push(`*${biz}*`)
  if (settings?.rnc) lines.push(`RNC: ${settings.rnc}`)
  if (settings?.email) lines.push(settings.email)
  lines.push(`Factura ${sale.saleNumber}`)
  lines.push(`${sale.date}  ${sale.time}`)
  if (sale.fiscal?.ncf) {
    lines.push(`${sale.fiscal.typeLabel || 'Comprobante fiscal'}`)
    lines.push(`NCF: ${sale.fiscal.ncf}`)
    if (sale.fiscal.expiresAt) lines.push(`Vence NCF: ${sale.fiscal.expiresAt}`)
  }
  if (sale.customerName) lines.push(`Cliente: ${sale.customerName}`)
  if (sale.fiscal?.customer?.rnc || sale.customerRnc) lines.push(`RNC/Cédula Cliente: ${sale.fiscal?.customer?.rnc || sale.customerRnc}`)
  lines.push(`Cajero: ${sale.user}`)
  lines.push('-----------------')
  if (sale.items?.length) { lines.push('*Productos:*'); sale.items.forEach(i => lines.push(`  ${i.name} x${i.qty}  ${fmt(i.price * i.qty)}`)) }
  if (sale.refills?.length) { lines.push('*Recargas:*'); sale.refills.forEach(r => lines.push(`  ${r.liquidName} ${r.type}  ${fmt(r.price)}`)) }
  if (sale.bottleSales?.length) { lines.push('*Frascos:*'); sale.bottleSales.forEach(b => lines.push(`  ${b.liquidName} x${b.qty}  ${fmt(b.price * b.qty)}`)) }
  if (sale.services?.length) { lines.push('*Servicios:*'); sale.services.forEach(s => lines.push(`  ${s.name} x${s.qty}  ${fmt(s.price * s.qty)}`)) }
  if (sale.discounts?.length) { lines.push('*Descuentos:*'); sale.discounts.forEach(d => lines.push(`  ${d.name}  -${fmt(d.amount)}`)) }
  lines.push('-----------------')
  lines.push(`Subtotal: ${fmt(sale.subtotal)}`)
  if (sale.discountTotal > 0) lines.push(`Descuento: -${fmt(sale.discountTotal)}`)
  if (sale.tax > 0) lines.push(`ITBIS: ${fmt(sale.tax)}`)
  lines.push(`*TOTAL: ${fmt(sale.total)}*`)
  lines.push(`Pago: ${sale.payment}`)
  if (sale.amountReceived && sale.amountReceived > sale.total) {
    lines.push(`Recibido: ${fmt(sale.amountReceived)}`)
    lines.push(`Cambio: ${fmt(sale.change)}`)
  }
  lines.push('-----------------')
  lines.push(footer)
  return lines.join('\n')
}

function ReceiptLine({ label, value, strong = false }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'font-bold text-sm' : 'text-xs'} text-black`}>
      <span className="shrink-0">{label}</span>
      <span className="font-mono text-right break-words">{value}</span>
    </div>
  )
}

function ReceiptSection({ title, children }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-bold text-black mb-2 uppercase tracking-wide">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export default function InvoiceModal({ sale, onClose, onNewSale }) {
  const { state } = useApp()
  const { settings } = state
  const printRef = useRef(null)
  const [downloading, setDownloading] = useState(false)
  const [printingBluetooth, setPrintingBluetooth] = useState(false)
  const [logoSrc, setLogoSrc] = useState(settings?.logoUrl || '')
  const bluetoothSupported = isBluetoothPrinterSupported()

  useEffect(() => {
    setLogoSrc(settings?.logoUrl || '')
  }, [settings?.logoUrl])

  if (!sale) return null

  const prepareLogoForCapture = async () => {
    const logoImg = printRef.current?.querySelector('img.logo')
    if (!logoImg || !logoImg.src || logoImg.src.startsWith('data:')) return
    try {
      const resp = await fetch(logoImg.src, { mode: 'cors' })
      const blob = await resp.blob()
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer el logo'))
        reader.readAsDataURL(blob)
      })
      logoImg.src = b64
      setLogoSrc(b64)
      await logoImg.decode?.().catch(() => {})
    } catch (error) {
      console.warn('No se pudo preparar el logo para exportar:', error)
    }
  }

  const handleDownloadPDF = async () => {
    if (!printRef.current) return
    setDownloading(true)
    try {
      const [html2canvas, jsPDF] = await Promise.all([loadReceiptCapture(), loadPDFLibrary()])
      await prepareLogoForCapture()
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, useCORS: true, allowTaint: false, logging: false, scrollX: 0, scrollY: 0 })
      const imgData = canvas.toDataURL('image/jpeg', 0.96)
      const pdfWidth = settings?.paperSize === '80mm' ? 80 : settings?.paperSize === '48mm' ? 48 : 58
      const pdfHeight = Math.max(120, (canvas.height * pdfWidth) / canvas.width)
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pdfWidth, pdfHeight] })
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, (canvas.height * pdfWidth) / canvas.width)
      pdf.save(`Factura-${sale.saleNumber}.pdf`)
      toast.success('Factura PDF descargada')
    } catch (err) {
      toast.error('Error al generar PDF')
      console.warn('PDF error:', err)
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadImage = async () => {
    if (!printRef.current) return
    setDownloading(true)
    try {
      const html2canvas = await loadReceiptCapture()
      await prepareLogoForCapture()
      const canvas = await html2canvas(printRef.current, { backgroundColor: '#ffffff', scale: 2, useCORS: true, allowTaint: false, logging: false, scrollX: 0, scrollY: 0 })
      const link = document.createElement('a')
      link.download = `Factura-${sale.saleNumber}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.95)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      toast.error('Error al generar imagen')
      console.warn('html2canvas error:', err)
    } finally {
      setDownloading(false)
    }
  }

  const handleWhatsAppShare = () => {
    try {
      const url = `https://wa.me/?text=${encodeURIComponent(buildWhatsAppText(sale, settings))}`
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error('No se pudo preparar la factura para WhatsApp')
      console.warn('WhatsApp share error:', err)
    }
  }

  const handleBluetoothPrint = async () => {
    setPrintingBluetooth(true)
    try {
      const printerName = await printSaleByBluetooth(sale, settings)
      toast.success(`Factura enviada a ${printerName}`)
    } catch (err) {
      toast.error(err?.message || 'No se pudo imprimir por Bluetooth')
      console.warn('Bluetooth print error:', err)
    } finally {
      setPrintingBluetooth(false)
    }
  }

  const biz = settings?.businessName || 'VapePOS'

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-2 sm:p-4 overflow-hidden" onClick={onClose}>
      <div className="bg-[#0c1424] border border-white/10 rounded-2xl w-full max-w-md mx-auto h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <div className="font-display font-bold text-slate-100">Factura</div>
            <div className="text-xs text-[#00e5a0] font-mono">{sale.saleNumber}</div>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={handleDownloadPDF} disabled={downloading} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a2848] border border-white/10 text-slate-300 hover:text-white transition-all">{downloading ? 'Generando...' : '📄 PDF'}</button>
            <button onClick={handleBluetoothPrint} disabled={!bluetoothSupported || printingBluetooth} className="text-xs px-3 py-1.5 rounded-lg bg-[#00c4e8]/10 border border-[#00c4e8]/30 text-[#00c4e8] hover:bg-[#00c4e8]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all">{printingBluetooth ? 'Enviando...' : 'Bluetooth'}</button>
            <button onClick={handleDownloadImage} disabled={downloading} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a2848] border border-white/10 text-slate-300 hover:text-[#00c4e8] hover:border-[#00c4e8]/30 transition-all">{downloading ? 'Generando...' : '📷 JPG'}</button>
            <button onClick={handleWhatsAppShare} className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30 transition-all">WhatsApp</button>
            <button onClick={onClose} aria-label="Cerrar factura" className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 hover:text-white hover:bg-red-500/20 transition-all text-lg leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain bg-slate-200/5">
          <div className="px-4 sm:px-6 py-5 bg-white text-black font-mono min-h-max" ref={printRef}>
            {settings?.printLogo !== false && logoSrc && (
              <img src={logoSrc} alt="Logo del negocio" className="logo" crossOrigin="anonymous" referrerPolicy="no-referrer" onError={() => setLogoSrc('')} style={{ maxWidth: '96px', maxHeight: '72px', display: 'block', margin: '0 auto 10px', objectFit: 'contain' }} />
            )}
            <div className="text-center font-bold text-black text-lg leading-tight">{biz}</div>
            {settings?.printAddress !== false && settings?.address && <div className="text-center text-xs text-black">{settings.address}</div>}
            {settings?.printPhone !== false && settings?.phone && <div className="text-center text-xs text-black">Tel: {settings.phone}</div>}
            {settings?.printRNC !== false && settings?.rnc && <div className="text-center text-xs text-black">RNC: {settings.rnc}</div>}
            {settings?.printEmail !== false && settings?.email && <div className="text-center text-xs text-black">{settings.email}</div>}
            {settings?.legalName && settings.legalName !== biz && <div className="text-center text-xs text-black">Razón social: {settings.legalName}</div>}

            {sale.fiscal?.ncf && (
              <div className="mt-3 border border-black/30 bg-white rounded-lg p-2 text-center">
                <div className="text-[10px] uppercase tracking-wider text-black font-bold">{sale.fiscal.typeLabel}</div>
                <div className="text-sm font-mono font-bold text-black">NCF: {sale.fiscal.ncf}</div>
                {sale.fiscal.expiresAt && <div className="text-[10px] text-black">Vence NCF: {sale.fiscal.expiresAt}</div>}
              </div>
            )}

            <div className="border-t border-dashed border-black/40 my-3" />
            <div className="space-y-1 mb-3">
              <ReceiptLine label="Factura" value={sale.saleNumber} />
              <ReceiptLine label="Fecha" value={`${sale.date} ${sale.time}`} />
              {sale.customerName && <ReceiptLine label="Cliente" value={sale.customerName} />}
              {(sale.fiscal?.customer?.rnc || sale.customerRnc) && <ReceiptLine label="RNC/Cédula" value={sale.fiscal?.customer?.rnc || sale.customerRnc} />}
              {sale.fiscal?.customer?.address && <ReceiptLine label="Dirección" value={sale.fiscal.customer.address} />}
              <ReceiptLine label="Cajero" value={sale.user} />
            </div>
            <div className="border-t border-dashed border-black/40 my-3" />

            {sale.items?.length > 0 && <ReceiptSection title="Productos">{sale.items.map((i, idx) => <ReceiptLine key={idx} label={`${i.name} x${i.qty}`} value={fmt(i.price * i.qty)} />)}</ReceiptSection>}
            {sale.refills?.length > 0 && <ReceiptSection title="Recargas">{sale.refills.map((r, idx) => <ReceiptLine key={idx} label={`${r.liquidName} ${r.type}`} value={fmt(r.price)} />)}</ReceiptSection>}
            {sale.bottleSales?.length > 0 && <ReceiptSection title="Frascos">{sale.bottleSales.map((b, idx) => <ReceiptLine key={idx} label={`${b.liquidName} x${b.qty}`} value={fmt(b.price * b.qty)} />)}</ReceiptSection>}
            {sale.services?.length > 0 && <ReceiptSection title="Servicios">{sale.services.map((s, idx) => <ReceiptLine key={idx} label={`${s.name} x${s.qty}`} value={fmt(s.price * s.qty)} />)}</ReceiptSection>}
            {sale.discounts?.length > 0 && <ReceiptSection title="Descuentos">{sale.discounts.map((d, idx) => <ReceiptLine key={idx} label={d.name} value={`-${fmt(d.amount)}`} />)}</ReceiptSection>}

            <div className="border-t border-dashed border-black/40 my-3" />
            <div className="space-y-1.5">
              <ReceiptLine label="Subtotal" value={fmt(sale.subtotal)} />
              {sale.discountTotal > 0 && <ReceiptLine label="Descuento" value={`-${fmt(sale.discountTotal)}`} />}
              {sale.tax > 0 && <ReceiptLine label={`ITBIS (${settings?.taxRate}%)`} value={fmt(sale.tax)} />}
              <div className="flex justify-between gap-3 font-bold text-black pt-1 border-t border-black/20">
                <span>TOTAL</span><span className="font-mono text-lg">{fmt(sale.total)}</span>
              </div>
              <ReceiptLine label="Método de pago" value={sale.payment} />
              {sale.amountReceived > sale.total && <><ReceiptLine label="Recibido" value={fmt(sale.amountReceived)} /><ReceiptLine label="Cambio" value={fmt(sale.change)} strong /></>}
              {sale.creditAdded > 0 && <><ReceiptLine label="A crédito" value={fmt(sale.creditAdded)} strong /><ReceiptLine label="Deuda total" value={fmt((sale.creditPreviousBalance || 0) + sale.creditAdded)} /></>}
            </div>

            <div className="border-t border-dashed border-black/40 my-3" />
            <div className="text-center text-xs text-black">{settings?.invoiceFooter || 'Gracias por su compra!'}</div>
          </div>

          {onNewSale && (
            <div className="px-4 sm:px-6 py-4 bg-[#0c1424] border-t border-white/10 sticky bottom-0">
              <button onClick={onNewSale} className="btn-primary w-full text-sm">+ Nueva Venta</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
