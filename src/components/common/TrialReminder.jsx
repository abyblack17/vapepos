import React, { useState } from 'react'
import PurchaseOptions from './PurchaseOptions'
import { trialDeadline, trialReminderDue } from '../../config/trial'

export default function TrialReminder({ business, now }) {
  const key = `vapepos:trial-reminder:${business?.id}:${trialDeadline(business)}`
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === 'dismissed' ? key : null } catch { return null }
  })
  if (!trialReminderDue(business, now) || dismissed === key) return null
  const skip = () => {
    try { localStorage.setItem(key, 'dismissed') } catch { /* Permitir saltar sin almacenamiento. */ }
    setDismissed(key)
  }
  const days = Math.ceil((trialDeadline(business) - now) / 86400000)
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="trial-reminder-title" className="card p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-5">
        <h2 id="trial-reminder-title" className="text-xl font-bold text-slate-100">Tu prueba termina en {days} {days === 1 ? 'día' : 'días'}</h2>
        <p className="text-slate-300">Puedes seguir usando VapePos durante tu prueba. Al finalizar los 3 días, contacta a soporte para adquirir acceso de por vida.</p>
        <PurchaseOptions />
        <button className="btn-primary w-full" onClick={skip} autoFocus>Saltar y continuar con la prueba</button>
      </section>
    </div>
  )
}
