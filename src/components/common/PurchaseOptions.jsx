import React from 'react'
import { PURCHASE_OPTIONS } from '../../config/trial'
export default function PurchaseOptions() {
  return <div className="space-y-3 text-left">
    <p className="text-sm text-slate-400">Acceso de por vida · Pago único · Activación por soporte</p>
    {PURCHASE_OPTIONS.map(option => <div key={option.name} className="rounded-xl border border-white/10 p-3">
      <div className="flex justify-between gap-3 text-slate-100 font-semibold"><span>{option.name}</span><span>RD${option.price.toLocaleString('en-US')}</span></div>
      <p className="text-xs text-slate-400 mt-1">{option.description}</p>
      <p className="text-xs text-[#00e5a0] mt-2">{option.months} meses de Pro incluidos.</p>
    </div>)}
    <p className="text-xs text-slate-400">Pro opcional: RD$600 al mes para mayor inventario y usuarios, soporte, actualizaciones y respaldo en la nube. Al vencer, sigues en Básico sin perder tus datos ni el acceso comprado.</p>
  </div>
}
