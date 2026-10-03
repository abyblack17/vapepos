import React, { useState, useEffect } from 'react'
import { useApp } from '../../contexts/AppContext'
import { buildRefillCartItem, canRefill, getNicotinaLabel, getPointsForType, getRefillButtons } from '../../services/liquidService'
import BottleProgress from '../ui/BottleProgress'
import toast from 'react-hot-toast'
import { fmt } from '../../utils/helpers'

export default function RefillButtons({ onAdd }) {
  const { state } = useApp()

  const availableLiquids = state.liquids.filter(l =>
    l.active && (l.hasActive || l.closedBottles > 0)
  )

  const [selectedLiquidId, setSelectedLiquidId] = useState('')

  // Sync selectedLiquidId when liquids load or change
  useEffect(() => {
    if (!selectedLiquidId && availableLiquids.length > 0) {
      setSelectedLiquidId(availableLiquids[0].id)
    }
  }, [availableLiquids.length])

  // Always find liquid by its exact ID from state
  const liquid = state.liquids.find(l => l.id === selectedLiquidId) || null

  // Points already committed in cart for this specific liquid
  const cartPointsForLiquid = (liquidId) =>
    state.cart
      .filter(c => c.type === 'refill' && c.liquidId === liquidId)
      .reduce((a, c) => a + c.points * c.qty, 0)

  const cartPoints   = liquid ? cartPointsForLiquid(liquid.id) : 0
  const realSaldo    = liquid?.activeSaldo ?? 0
  const saldoLeft    = Math.max(0, realSaldo - cartPoints)

  const canAddRefill = (price) => {
    if (!liquid?.hasActive) return false
    const pts = getPointsForType(liquid, price, state.settings)
    return pts > 0 && saldoLeft >= pts
  }

  const handleRefill = (price) => {
    if (!liquid?.hasActive) {
      toast.error('No hay botella activa para este liquido')
      return
    }
    const pts = getPointsForType(liquid, price, state.settings)
    if (saldoLeft < pts) {
      toast.error(`Saldo insuficiente. Disponible: ${saldoLeft} pts, necesitas ${pts} pts`)
      return
    }
    try {
      const item = buildRefillCartItem(liquid, price, state.settings)
      // Double check with current saldo in state
      if (cartPoints + item.points > realSaldo) {
        toast.error(`Saldo insuficiente. Solo quedan ${saldoLeft} pts`)
        return
      }
      onAdd(item)
      toast.success(`Recarga RD$${price} agregada`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleSellBottle = () => {
    if (!liquid) { toast.error('Selecciona un liquido'); return }
    if ((liquid.closedBottles ?? 0) < 1) {
      toast.error('No hay frascos cerrados disponibles')
      return
    }
    const item = {
      id:         `bottle_${liquid.id}_${Date.now()}`,
      type:       'bottle',
      name:       `Frasco ${liquid.name} (${liquid.sizeML}ml)`,
      liquidId:   liquid.id,
      liquidName: liquid.name,
      price:      liquid.pricePerBottle || Math.round(liquid.costPerBottle * 1.5),
      cost:       liquid.costPerBottle,
      qty:        1,
      taxIncluded: liquid.taxIncluded === true,
    }
    onAdd(item)
    toast.success(`Frasco de "${liquid.name}" agregado al carrito`)
  }

  const handleSellHalfBottle = () => {
    if (!liquid) { toast.error('Selecciona un liquido'); return }
    if ((liquid.closedBottles ?? 0) < 1) {
      toast.error('No hay frascos cerrados disponibles')
      return
    }
    const fullPrice = liquid.pricePerBottle || Math.round(liquid.costPerBottle * 1.5)
    const halfPrice = Math.round(fullPrice / 2)
    const item = {
      id:         `half_${liquid.id}_${Date.now()}`,
      type:       'bottle',
      name:       `Medio Frasco ${liquid.name} (${liquid.sizeML}ml)`,
      liquidId:   liquid.id,
      liquidName: liquid.name,
      price:      halfPrice,
      cost:       Math.round(liquid.costPerBottle / 2),
      qty:        1,
      taxIncluded: liquid.taxIncluded === true,
      isHalf:     true,
    }
    onAdd(item)
    toast.success(`Medio frasco de "${liquid.name}" agregado`)
  }

  if (availableLiquids.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-500">
        <div className="text-4xl">💧</div>
        <p className="text-sm text-center">
          No hay liquidos disponibles.<br />
          Ve a Recargas para registrar liquidos.
        </p>
      </div>
    )
  }

  const styleCycle = [
    { border: 'border-[#00e5a0]/30', bg: 'bg-[#00e5a0]/10', text: 'text-[#00e5a0]' },
    { border: 'border-[#00c4e8]/30', bg: 'bg-[#00c4e8]/10', text: 'text-[#00c4e8]' },
    { border: 'border-[#8b5cf6]/30', bg: 'bg-[#8b5cf6]/10', text: 'text-[#a78bfa]' },
    { border: 'border-[#f59e0b]/30', bg: 'bg-[#f59e0b]/10', text: 'text-[#fbbf24]' },
    { border: 'border-red-400/30', bg: 'bg-red-400/10', text: 'text-red-300' },
  ]
  const REFILL_OPTIONS = getRefillButtons(state.settings).map((btn, index) => ({
    ...btn,
    label: `RD$${btn.price}`,
    pts: liquid ? getPointsForType(liquid, btn.price, state.settings) : btn.points,
    ...styleCycle[index % styleCycle.length],
  }))

  return (
    <div className="space-y-4">
      {/* Liquid selector */}
      <div>
        <label className="label">Liquido</label>
        <select
          className="select"
          value={selectedLiquidId}
          onChange={e => setSelectedLiquidId(e.target.value)}
        >
          {availableLiquids.map(l => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.hasActive ? ` — ${l.activeSaldo}pts` : ' — sin botella activa'}
              {l.closedBottles > 0 ? ` · ${l.closedBottles} cerradas` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Liquid info */}
      {liquid && (
        <div className="bg-[#111e38] border border-white/5 rounded-xl p-3 space-y-2">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-sm font-semibold text-slate-300">{liquid.name}</div>
              <div className="text-xs text-slate-500">{liquid.brand} · {liquid.flavor}</div>
              {getNicotinaLabel(liquid) !== 'Sin nicotina' && (
                <div className="text-xs text-[#a78bfa] font-semibold mt-0.5">{getNicotinaLabel(liquid)}</div>
              )}
            </div>
            <div className="flex gap-2 flex-wrap justify-end">
              {liquid.hasActive && <span className="badge badge-green text-xs">Activa</span>}
              {liquid.closedBottles > 0 && <span className="badge badge-blue text-xs">{liquid.closedBottles} cerradas</span>}
            </div>
          </div>

          {liquid.hasActive && (
            <>
              {/* Show real saldo vs cart-adjusted saldo */}
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">Saldo disponible</span>
                <span className={`font-mono font-bold ${saldoLeft <= 0 ? 'text-red-400' : 'text-[#00e5a0]'}`}>
                  {saldoLeft} / {realSaldo} pts
                </span>
              </div>
              <BottleProgress liquid={{ ...liquid, activeSaldo: saldoLeft }} />

              {cartPoints > 0 && (
                <div className="text-xs text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-lg px-2 py-1">
                  {cartPoints} pts en carrito · {saldoLeft} pts disponibles
                </div>
              )}

              {saldoLeft === 0 && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1">
                  Saldo agotado — abre un nuevo frasco
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Refill buttons */}
      {liquid?.hasActive && (
        <>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recargas por precio</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {REFILL_OPTIONS.map(opt => {
              const enabled = canAddRefill(opt.price)
              return (
                <button key={opt.price}
                  onClick={() => handleRefill(opt.price)}
                  disabled={!enabled}
                  className={`rounded-xl border-2 ${opt.border} ${opt.bg} ${opt.text}
                    p-4 text-center transition-all duration-150 font-bold
                    ${enabled
                      ? 'hover:scale-105 active:scale-95 cursor-pointer'
                      : 'opacity-30 cursor-not-allowed'
                    }`}>
                  <div className="text-2xl mb-1">💧</div>
                  <div className="text-lg">{opt.label}</div>
                  <div className="text-xs opacity-70 mt-0.5 font-mono">{opt.pts} pts</div>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Sell closed bottle */}
      {liquid && liquid.closedBottles > 0 && (
        <>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Frasco Completo</div>
          <button onClick={handleSellBottle}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl
                       border border-[#8b5cf6]/20 bg-[#8b5cf6]/5 text-[#a78bfa]
                       hover:bg-[#8b5cf6]/10 transition-all">
            <div className="flex items-center gap-3">
              <span className="text-xl">🍶</span>
              <div className="text-left">
                <div className="font-semibold text-sm">Vender Frasco Completo</div>
                <div className="text-xs opacity-70">
                  {liquid.sizeML}ml · {liquid.closedBottles} disponible(s) · {fmt(liquid.pricePerBottle || Math.round(liquid.costPerBottle * 1.5))}
                </div>
              </div>
            </div>
            <span className="text-xl">+</span>
          </button>
        </>
      )}

      {/* Sell half bottle */}
      {liquid && liquid.closedBottles > 0 && (
        <button onClick={handleSellHalfBottle}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl
                     border border-[#00c4e8]/20 bg-[#00c4e8]/5 text-[#00c4e8]
                     hover:bg-[#00c4e8]/10 transition-all">
          <div className="flex items-center gap-3">
            <span className="text-xl">🍶</span>
            <div className="text-left">
              <div className="font-semibold text-sm">Vender Medio Frasco</div>
              <div className="text-xs opacity-70">
                50% · {fmt(Math.round((liquid.pricePerBottle || Math.round(liquid.costPerBottle * 1.5)) / 2))}
              </div>
            </div>
          </div>
          <span className="text-xl">+</span>
        </button>
      )}

      {liquid && !liquid.hasActive && liquid.closedBottles === 0 && (
        <div className="alert-info text-xs">
          Sin saldo ni frascos cerrados para este liquido.
        </div>
      )}

      {liquid && !liquid.hasActive && liquid.closedBottles > 0 && (
        <div className="alert-info text-xs">
          Sin botella activa. Ve a Recargas para abrir un frasco.
        </div>
      )}
    </div>
  )
}
