import React from 'react'
import { getBottlePct, getActiveTotalCapacity, getOpenBottleCount } from '../../services/liquidService'

export default function BottleProgress({ liquid, showLabel = true, compact = false }) {
  const pct = getBottlePct(liquid)
  const capacity = getActiveTotalCapacity(liquid)
  const bottleCount = getOpenBottleCount(liquid)
  const fillClass =
    pct > 50 ? 'bottle-fill-green' :
    pct > 25 ? 'bottle-fill-yellow' :
    'bottle-fill-red'
  const textClass =
    pct > 50 ? 'text-[#00e5a0]' :
    pct > 25 ? 'text-amber-400' :
    'text-red-400'

  if (!liquid.hasActive) {
    return (
      <div className="text-xs text-slate-500 italic">
        Sin botella activa
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'space-y-1.5'}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Saldo activo ({bottleCount} frasco{bottleCount === 1 ? '' : 's'})</span>
          <span className={`font-mono font-bold ${textClass}`}>
            {liquid.activeSaldo}/{capacity} ml ({pct}%)
          </span>
        </div>
      )}
      <div className="bottle-progress">
        <div
          className={`h-full rounded transition-all duration-500 ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!compact && pct <= 25 && (
        <div className="text-xs text-red-400">
          ⚠ Botella casi agotada — prepara una nueva
        </div>
      )}
    </div>
  )
}
