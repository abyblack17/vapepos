import React from 'react'

const ACCENT_MAP = {
  green: 'stat-card-green',
  blue: 'stat-card-blue',
  purple: 'stat-card-purple',
  amber: 'stat-card-amber',
}

const VALUE_COLOR = {
  green: 'text-[#00e5a0]',
  blue: 'text-[#00c4e8]',
  purple: 'text-[#a78bfa]',
  amber: 'text-[#f59e0b]',
}

export default function StatCard({ label, value, sub, accent = 'green', icon, onClick }) {
  return (
    <div
      className={`stat-card ${ACCENT_MAP[accent]} relative overflow-hidden ${onClick ? 'cursor-pointer hover:scale-[1.02] transition-transform duration-150' : ''}`}
      onClick={onClick}
    >
      {icon && (
        <div className="absolute top-3 right-3 text-2xl opacity-70 select-none">{icon}</div>
      )}
      <div className="label text-slate-500">{label}</div>
      <div className={`font-display font-black mt-2 mb-1 tracking-tight leading-tight ${VALUE_COLOR[accent]}`}
        style={{ fontSize: 'clamp(14px, 4vw, 28px)' }}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}
