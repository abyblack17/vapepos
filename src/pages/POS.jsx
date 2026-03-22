import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import ProductCard from '../components/pos/ProductCard'
import RefillButtons from '../components/pos/RefillButtons'
import SaleCart from '../components/pos/SaleCart'
import InvoiceModal from '../components/pos/InvoiceModal'
import { fmt, today } from '../utils/helpers'
import toast from 'react-hot-toast'
import BarcodeScanner from '../components/pos/BarcodeScanner'

const TABS = [
  { id: 'products', label: 'Productos' },
  { id: 'refills',  label: 'Líquidos'  },
  { id: 'recent',   label: 'Recientes' },
]

export default function POS() {
  const { state, dispatch } = useApp()
  const [tab, setTab]           = useState('products')
  const [search, setSearch]     = useState('')
  const [catFilter, setCatFilter] = useState('Todos')
  const [viewSale, setViewSale]       = useState(null)
  const [showScanner, setShowScanner] = useState(false)

  const products   = state.products.filter(p => p.active)
  const categories = ['Todos', ...new Set(products.map(p => p.category))]
  const filtered   = products.filter(p => {
    const ms = p.name.toLowerCase().includes(search.toLowerCase()) ||
               p.sku.toLowerCase().includes(search.toLowerCase())
    const mc = catFilter === 'Todos' || p.category === catFilter
    return ms && mc
  })

  const todaySales = state.sales.filter(s => s.date === today())

  const handleBarcodeDetected = (code) => {
    // Search by barcode/SKU
    const product = state.products.find(p =>
      p.barcode === code || p.sku === code
    )
    if (product) {
      handleAddProduct(product)
      toast.success(`${product.name} encontrado`, { icon: '📷' })
    } else {
      toast.error(`No se encontro producto con codigo: ${code}`)
    }
    setShowScanner(false)
  }

  const handleAddProduct = (product) => {
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: product.id, type: 'product', name: product.name, price: product.price, cost: product.cost },
    })
    toast.success(`${product.name} agregado`, { duration: 1000 })
  }

  return (
    <>
      <div className="pos-layout animate-fade-in">
      {/* ── Left panel ── */}
      <div className="flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex gap-1 bg-[#101c35] rounded-xl p-1 mb-4">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
                tab === t.id ? 'bg-neon-green text-[#080d18]' : 'text-slate-400 hover:text-slate-200'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Products ── */}
          {tab === 'products' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2">
                  <span className="text-slate-500 text-sm">🔍</span>
                  <input
                    className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
                    placeholder="Buscar producto o SKU..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <button onClick={() => setShowScanner(true)}
                  className="flex items-center justify-center w-10 h-10 bg-[#101c35] border border-white/10 rounded-lg text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all flex-shrink-0"
                  title="Escanear codigo de barras">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12v.01M4 18v.01M4 4v.01M8 4v.01M8 20v.01M20 4v.01M20 8v.01M20 12v.01" />
                  </svg>
                </button>
              </div>

              {/* Category pills */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setCatFilter(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                      catFilter === cat
                        ? 'bg-[#00e5a0]/10 border-[#00e5a0]/30 text-[#00e5a0]'
                        : 'bg-[#101c35] border-white/10 text-slate-400 hover:border-white/25'
                    }`}>
                    {cat}
                  </button>
                ))}
              </div>

              {/* Product grid */}
              <div className="grid grid-cols-3 gap-2.5">
                {filtered.map(p => (
                  <ProductCard key={p.id} product={p} onAdd={handleAddProduct} />
                ))}
                {filtered.length === 0 && (
                  <div className="col-span-3 py-12 text-center text-slate-500 text-sm">
                    No se encontraron productos
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Liquids / Refills ── */}
          {tab === 'refills' && (
            <RefillButtons onAdd={item => dispatch({ type: 'ADD_TO_CART', payload: item })} />
          )}

          {/* ── Recent sales today ── */}
          {tab === 'recent' && (
            <div className="space-y-2">
              <div className="text-xs text-slate-500 mb-3">
                {todaySales.length} ventas hoy
              </div>
              {todaySales.map(s => (
                <div key={s.id} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-200">
                        {s.customerName || 'Cliente general'}
                      </div>
                      <div className="text-xs text-slate-500">{s.saleNumber} · {s.time}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-mono font-bold text-[#00e5a0]">{fmt(s.total)}</div>
                        <span className="badge badge-blue text-xs">{s.payment}</span>
                      </div>
                      <button
                        onClick={() => setViewSale(s)}
                        className="text-xs px-2 py-1 rounded-lg border border-white/10 text-slate-400
                                   hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all"
                      >
                        🧾
                      </button>
                    </div>
                  </div>
                  {s.items?.length > 0 && (
                    <div className="text-xs text-slate-500">
                      📦 {s.items.map(i => `${i.name} ×${i.qty}`).join(', ')}
                    </div>
                  )}
                  {s.refills?.length > 0 && (
                    <div className="text-xs text-[#00c4e8]">
                      💧 {s.refills.map(r => `${r.liquidName} ${r.type}`).join(', ')}
                    </div>
                  )}
                  {s.bottleSales?.length > 0 && (
                    <div className="text-xs text-[#a78bfa]">
                      🍶 {s.bottleSales.map(b => `${b.liquidName} ×${b.qty}`).join(', ')}
                    </div>
                  )}
                </div>
              ))}
              {todaySales.length === 0 && (
                <div className="py-12 text-center text-slate-500 text-sm">
                  Sin ventas registradas hoy
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Cart ── */}
      <SaleCart />

      {/* ── Invoice viewer from recent tab ── */}
      {viewSale && (
        <InvoiceModal sale={viewSale} onClose={() => setViewSale(null)} />
      )}
    </div>

    {showScanner && (
      <BarcodeScanner
        onDetected={handleBarcodeDetected}
        onClose={() => setShowScanner(false)}
      />
    )}
    </>
  )
}