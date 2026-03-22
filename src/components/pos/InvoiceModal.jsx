import React, { useRef, useState } from 'react'
import { useApp } from '../../contexts/AppContext'
import { fmt, formatDate } from '../../utils/helpers'
import toast from 'react-hot-toast'

export function buildWhatsAppText(sale, settings) {
  const biz    = settings?.businessName || 'VapePOS'
  const footer = settings?.invoiceFooter || 'Gracias por su compra!'
  const lines  = []
  lines.push(`*${biz}*`)
  lines.push(`Factura ${sale.saleNumber}`)
  lines.push(`${sale.date}  ${sale.time}`)
  if (sale.customerName) lines.push(`Cliente: ${sale.customerName}`)
  lines.push(`Cajero: ${sale.user}`)
  lines.push('-----------------')
  if (sale.items?.length)      { lines.push('*Productos:*');        sale.items.forEach(i       => lines.push(`  ${i.name} x${i.qty}  ${fmt(i.price * i.qty)}`)) }
  if (sale.refills?.length)    { lines.push('*Recargas:*');         sale.refills.forEach(r     => lines.push(`  ${r.liquidName} ${r.type}  ${fmt(r.price)}`)) }
  if (sale.bottleSales?.length){ lines.push('*Frascos:*');          sale.bottleSales.forEach(b => lines.push(`  ${b.liquidName} x${b.qty}  ${fmt(b.price * b.qty)}`)) }
  if (sale.services?.length)   { lines.push('*Servicios:*');        sale.services.forEach(s   => lines.push(`  ${s.name} x${s.qty}  ${fmt(s.price * s.qty)}`)) }
  if (sale.discounts?.length)  { lines.push('*Descuentos:*');       sale.discounts.forEach(d  => lines.push(`  ${d.name}  -${fmt(d.amount)}`)) }
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

export default function InvoiceModal({ sale, onClose, onNewSale }) {
  const { state } = useApp()
  const { settings } = state
  const printRef = useRef(null)
  if (!sale) return null

  const handlePrint = () => {
    const content = printRef.current?.innerHTML
    if (!content) return
    const paperSize  = settings?.paperSize  || '80mm'
    const copies     = parseInt(settings?.printCopies || '1')
    const paperWidth = paperSize === '58mm' ? '58mm' : '80mm'
    const fontSize   = paperSize === '58mm' ? '10px' : '12px'
    const padding    = paperSize === '58mm' ? '4px' : '8px'

    // Build content for N copies separated by page breaks
    let bodyContent = ''
    for (let i = 0; i < copies; i++) {
      bodyContent += `<div class="ticket">${content}</div>`
      if (i < copies - 1) bodyContent += '<div style="page-break-after:always"></div>'
    }

    const win = window.open('', '_blank', 'width=400,height=700')
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>Factura ${sale.saleNumber}</title>
      <style>
        @page { margin: 0; size: ${paperWidth} auto; }
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family:'Courier New',monospace; font-size:${fontSize}; color:#000; background:#fff; }
        .ticket { width:${paperWidth}; padding:${padding}; }
        .biz-name  { font-size:14px; font-weight:bold; text-align:center; margin-bottom:2px; }
        .biz-sub   { font-size:10px; text-align:center; margin-bottom:8px; color:#444; }
        .divider   { border-top:1px dashed #000; margin:6px 0; }
        .row       { display:flex; justify-content:space-between; margin-bottom:2px; }
        .label     { color:#555; font-size:10px; }
        .section-title { font-weight:bold; margin:5px 0 2px; font-size:10px; text-transform:uppercase; }
        .total-row { font-size:13px; font-weight:bold; }
        .footer    { text-align:center; margin-top:10px; font-size:10px; color:#444; }
        .discount  { color:#cc0000; }
        .credit-row { border:1px dashed #cc0000; padding:3px; margin-top:3px; }
        .change-row { border:1px solid #000; padding:3px; margin-top:3px; font-weight:bold; }
        img.logo   { max-width:60px; max-height:40px; display:block; margin:0 auto 4px; }
        @media print {
          body { width:${paperWidth}; }
          .ticket { width:100%; }
        }
      </style></head><body>${bodyContent}</body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 300)
  }

  const [downloading, setDownloading] = useState(false)

  const handleDownloadImage = async () => {
    if (!printRef.current) return
    setDownloading(true)
    try {
      // Load html2canvas if not already loaded
      if (!window.html2canvas) {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
        document.head.appendChild(script)
        await new Promise((resolve, reject) => {
          script.onload = resolve
          script.onerror = reject
        })
      }

      // Pre-convert logo to base64 to avoid CORS issues
      const logoImg = printRef.current.querySelector('img.logo')
      if (logoImg && logoImg.src && !logoImg.src.startsWith('data:')) {
        try {
          const resp = await fetch(logoImg.src)
          const blob = await resp.blob()
          const b64  = await new Promise(res => {
            const r = new FileReader()
            r.onload = () => res(r.result)
            r.readAsDataURL(blob)
          })
          logoImg.src = b64
          await new Promise(r => setTimeout(r, 100))
        } catch { /* logo fetch failed, skip */ }
      }

      // Capture only the receipt area
      const canvas = await window.html2canvas(printRef.current, {
        backgroundColor: '#0c1424',
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
      })

      // Download as JPG
      const link = document.createElement('a')
      link.download = `Factura-${sale.saleNumber}.jpg`
      link.href = canvas.toDataURL('image/jpeg', 0.95)
      link.click()
    } catch (err) {
      toast.error('Error al generar imagen')
      console.warn('html2canvas error:', err)
    }
    setDownloading(false)
  }

  const biz = settings?.businessName || 'VapePOS'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-6" onClick={onClose}>
      <div className="bg-[#0c1424] border border-white/10 rounded-2xl w-full max-w-md mx-4 my-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <div className="font-display font-bold text-slate-100">Factura</div>
            <div className="text-xs text-[#00e5a0] font-mono">{sale.saleNumber}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="text-xs px-3 py-1.5 rounded-lg bg-[#1a2848] border border-white/10 text-slate-400 hover:text-slate-200 transition-all">🖨 Imprimir</button>
            <button onClick={handleDownloadImage} disabled={downloading}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#1a2848] border border-white/10 text-slate-400 hover:text-[#00c4e8] hover:border-[#00c4e8]/30 transition-all">
              {downloading ? 'Generando...' : '📷 JPG'}
            </button>
            {sale.customerName && (
              <button onClick={() => { const txt = buildWhatsAppText(sale, settings); window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`) }}
                className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30 transition-all">WhatsApp</button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all">x</button>
          </div>
        </div>

        {/* Receipt body */}
        <div className="px-6 py-5" ref={printRef}>
          {settings?.printLogo !== false && settings?.logoUrl && (
            <img src={settings.logoUrl} alt="logo" className="logo"
              crossOrigin="anonymous"
              style={{ maxWidth: '80px', maxHeight: '60px', display: 'block', margin: '0 auto 8px' }} />
          )}
          <div className="biz-name text-center font-bold text-slate-100 text-lg">{biz}</div>
          {settings?.printAddress !== false && settings?.address && (
            <div className="biz-sub text-center text-xs text-slate-400">{settings.address}</div>
          )}
          {settings?.printPhone !== false && settings?.phone && (
            <div className="biz-sub text-center text-xs text-slate-400">Tel: {settings.phone}</div>
          )}
          <div className="divider border-t border-dashed border-white/20 my-3" />

          <div className="space-y-1 text-xs text-slate-400 mb-3">
            <div className="flex justify-between"><span>Factura</span><span className="font-mono text-slate-200">{sale.saleNumber}</span></div>
            <div className="flex justify-between"><span>Fecha</span><span className="font-mono text-slate-200">{sale.date} {sale.time}</span></div>
            {sale.customerName && <div className="flex justify-between"><span>Cliente</span><span className="font-mono text-slate-200">{sale.customerName}</span></div>}
            <div className="flex justify-between"><span>Cajero</span><span className="font-mono text-slate-200">{sale.user}</span></div>
          </div>

          <div className="divider border-t border-dashed border-white/20 my-3" />

          {/* Products */}
          {sale.items?.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-slate-300 mb-2">Productos</div>
              {sale.items.map((i, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{i.name} x{i.qty}</span>
                  <span className="font-mono text-slate-200">{fmt(i.price * i.qty)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Refills */}
          {sale.refills?.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-[#00c4e8] mb-2">Recargas</div>
              {sale.refills.map((r, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{r.liquidName} {r.type}</span>
                  <span className="font-mono text-slate-200">{fmt(r.price)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Bottle sales */}
          {sale.bottleSales?.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-[#a78bfa] mb-2">Frascos</div>
              {sale.bottleSales.map((b, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{b.liquidName} x{b.qty}</span>
                  <span className="font-mono text-slate-200">{fmt(b.price * b.qty)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Services */}
          {sale.services?.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-[#f59e0b] mb-2">Servicios</div>
              {sale.services.map((s, idx) => (
                <div key={idx} className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>{s.name} x{s.qty}</span>
                  <span className="font-mono text-slate-200">{fmt(s.price * s.qty)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Discounts */}
          {sale.discounts?.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-bold text-red-400 mb-2">Descuentos</div>
              {sale.discounts.map((d, idx) => (
                <div key={idx} className="flex justify-between text-xs text-red-400 mb-1">
                  <span>{d.name}</span>
                  <span className="font-mono">-{fmt(d.amount)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="divider border-t border-dashed border-white/20 my-3" />

          {/* Totals */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-400"><span>Subtotal</span><span className="font-mono">{fmt(sale.subtotal)}</span></div>
            {sale.discountTotal > 0 && <div className="flex justify-between text-xs text-red-400"><span>Descuento</span><span className="font-mono">-{fmt(sale.discountTotal)}</span></div>}
            {sale.tax > 0 && <div className="flex justify-between text-xs text-slate-400"><span>ITBIS ({settings?.taxRate}%)</span><span className="font-mono">{fmt(sale.tax)}</span></div>}
            <div className="flex justify-between font-bold text-slate-100 pt-1 border-t border-white/10">
              <span>TOTAL</span><span className="font-mono text-[#00e5a0] text-lg">{fmt(sale.total)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400"><span>Metodo de pago</span><span className="font-mono text-slate-200">{sale.payment}</span></div>
            {sale.amountReceived > sale.total && (
              <>
                <div className="flex justify-between text-xs text-slate-400"><span>Recibido</span><span className="font-mono text-slate-200">{fmt(sale.amountReceived)}</span></div>
                <div className="flex justify-between text-sm font-bold text-[#00e5a0] bg-[#00e5a0]/10 rounded-lg px-2 py-1.5">
                  <span>Cambio</span><span className="font-mono">{fmt(sale.change)}</span>
                </div>
              </>
            )}
            {sale.creditAdded > 0 && (
              <div className="flex justify-between text-sm font-bold text-red-400 bg-red-500/10 rounded-lg px-2 py-1.5">
                <span>A credito</span><span className="font-mono">{fmt(sale.creditAdded)}</span>
              </div>
            )}
            {sale.creditAdded > 0 && (
              <div className="flex justify-between text-xs text-red-400">
                <span>Deuda total del cliente</span>
                <span className="font-mono">{fmt((sale.creditPreviousBalance || 0) + sale.creditAdded)}</span>
              </div>
            )}
          </div>

          <div className="divider border-t border-dashed border-white/20 my-3" />
          <div className="text-center text-xs text-slate-500">{settings?.invoiceFooter || 'Gracias por su compra!'}</div>
        </div>

        {onNewSale && (
          <div className="px-6 pb-5">
            <button onClick={onNewSale} className="btn-primary w-full text-sm">+ Nueva Venta</button>
          </div>
        )}
      </div>
    </div>
  )
}
