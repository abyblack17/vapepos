import React, { useRef } from 'react'
import { fmt } from '../../utils/helpers'

const CATEGORY_COLORS = {
  Desechables:  '#00e5a0',
  Dispositivos: '#00c4e8',
  Pods:         '#a78bfa',
  Repuestos:    '#f59e0b',
  Accesorios:   '#f59e0b',
  Atomizadores: '#ef4444',
  Otros:        '#64748b',
}

export default function ProductCard({ product, onAdd }) {
  const isLowStock   = product.stock <= product.minStock
  const isOutOfStock = product.stock === 0
  const clickTimer   = useRef(null)
  const clickCount   = useRef(0)

  const handleClick = () => {
    if (isOutOfStock) return
    clickCount.current += 1
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      const times = clickCount.current
      clickCount.current = 0
      // Add product N times based on how many clicks
      for (let i = 0; i < times; i++) onAdd(product)
    }, 300)
  }

  const accentColor = CATEGORY_COLORS[product.category] || '#64748b'

  return (
    <button
      onClick={handleClick}
      disabled={isOutOfStock}
      className={`relative text-left rounded-xl border overflow-hidden transition-all duration-150 group w-full ${
        isOutOfStock
          ? 'opacity-40 cursor-not-allowed border-white/5 bg-[#111e38]'
          : 'border-white/10 bg-[#111e38] hover:border-[#00e5a0]/30 active:scale-95 cursor-pointer'
      }`}
    >
      {/* Image or color block */}
      {product.imageUrl ? (
        <div className="w-full h-28 overflow-hidden">
          <img src={product.imageUrl} alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
        </div>
      ) : (
        <div className="w-full h-28 flex items-center justify-center text-3xl"
          style={{ background: product.color || `${accentColor}15` }}>
          {product.color ? '' : '📦'}
        </div>
      )}

      {/* Info */}
      <div className="p-2.5">
        <div className="text-xs text-slate-500 mb-0.5 truncate">{product.category}</div>
        <div className="text-sm font-semibold text-slate-200 leading-tight mb-1.5 line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </div>
        <div className="font-mono font-bold text-sm" style={{ color: accentColor }}>
          {fmt(product.price)}
        </div>
        <div className={`text-xs mt-0.5 font-medium ${isLowStock ? 'text-amber-400' : 'text-slate-500'}`}>
          {isOutOfStock ? '✕ Sin stock' : isLowStock ? `⚠ ${product.stock}` : `${product.stock} uds`}
        </div>
      </div>

      {/* Click hint */}
      {!isOutOfStock && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-[#00e5a0] text-[#080d18] text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
          +
        </div>
      )}
    </button>
  )
}
