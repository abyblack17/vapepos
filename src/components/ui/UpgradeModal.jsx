import React, { useState } from 'react'
import Modal from './Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useApp }  from '../../contexts/AppContext'
import { usePlan } from '../../hooks/usePlan'
import { storage } from '../../config/firebase'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { bizAdd } from '../../services/firestoreService'
import toast from 'react-hot-toast'

const PAYMENT_INFO = [
  {
    bank:     'Banreservas',
    color:    'text-[#00c4e8]',
    icon:     '🏦',
    fields: [
      { label: 'Cuenta',     value: '9602950558'      },
      { label: 'Cédula/RNC', value: '031-0560328-0'   },
      { label: 'Nombre',     value: 'Abimael Polanco' },
    ],
  },
  {
    bank:     'Banco Popular',
    color:    'text-[#a78bfa]',
    icon:     '🏦',
    fields: [
      { label: 'Cuenta',     value: '825171077'        },
      { label: 'Cédula/RNC', value: '031-0560328-0'    },
      { label: 'Nombre',     value: 'Abimael Polanco'  },
    ],
  },
]

export default function UpgradeModal({ onClose }) {
  const { businessId, business, currentUser } = useAuth()
  const { state }       = useApp()
  const { isPro } = usePlan()

  const [step, setStep]               = useState(1)
  const [uploading, setUploading]     = useState(false)
  const [file, setFile]               = useState(null)
  const [preview, setPreview]         = useState(null)
  const [notes, setNotes]             = useState('')
  const [copied, setCopied]           = useState(null)

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const handleFileChange = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { toast.error('La imagen no puede superar 5MB'); return }
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => setPreview(reader.result)
    reader.readAsDataURL(f)
  }

  // ── Enviar comprobante ───────────────────────────────────────
  const handleSubmit = async () => {
    if (!file) { toast.error('Sube el comprobante de pago'); return }
    setUploading(true)
    try {
      const storageRef = ref(storage, `businesses/${businessId}/upgrade_requests/${Date.now()}_${file.name}`)
      await uploadBytes(storageRef, file)
      const imageUrl = await getDownloadURL(storageRef)

      await bizAdd(businessId, 'upgrade_requests', {
        businessId,
        businessName:  state.settings?.businessName || business?.name || '',
        ownerName:     currentUser?.name  || 'Admin',
        ownerEmail:    currentUser?.email || '',
        currentPlan:   business?.plan     || 'basic',
        requestedPlan: 'pro',
        imageUrl,
        notes,
        status:   'pending',
        createdAt: new Date(),
      })

      setStep(3)
    } catch (err) {
      toast.error('Error al enviar la solicitud: ' + err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal title="Actualizar a Plan Pro" onClose={onClose} size="sm">

      {/* ── Paso 1: Info + opciones ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-[#00e5a0]/10 to-[#00c4e8]/10 border border-[#00e5a0]/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <div className="font-display font-bold text-[#00e5a0] text-lg">Plan Pro</div>
                  <div className="text-xs text-slate-400">Más capacidad y acompañamiento</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display font-black text-[#00e5a0] text-2xl">RD$600</div>
                <div className="text-xs text-slate-400">por mes</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs text-[#00e5a0]">
              {[
                '✓ Productos ilimitados',
                '✓ Clientes ilimitados',
                '✓ Usuarios ilimitados',
                '✓ Ventas ilimitadas',
                '✓ Historial completo',
                '✓ Exportar Excel/PDF',
                '✓ Backup y restauración',
                '✓ Proveedores',
                '✓ Rendimiento líquidos',
                '✓ Gestión de sucursales',
                '✓ Soporte y actualizaciones',
              ].map((f, i) => <div key={i}>{f}</div>)}
            </div>
          </div>


          {!isPro && (
            <div className="bg-slate-700/20 border border-white/10 rounded-xl p-3 text-center">
              <div className="text-xs text-slate-400">Pro es un servicio opcional de acompañamiento: RD$600 al mes.</div>
              <div className="text-xs text-slate-500 mt-0.5">Tu compra mantiene el acceso de por vida en Básico. Los datos existentes no se eliminan al vencer Pro.</div>
            </div>
          )}

          {/* Datos de pago */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Elige cómo pagar <span className="text-[#00e5a0]">RD$600</span>:
            </div>

            {/* Toke — opción principal */}
            <div className="bg-gradient-to-br from-[#5b43d6]/20 to-[#00c4e8]/10 border border-[#8b5cf6]/30 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-bold text-[#a78bfa]">Toke — Pago con QR</div>
                  <div className="text-xs text-slate-400 mt-0.5">Transferencia inmediata desde Toke, Popular o Qik</div>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#00e5a0] bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded-full px-2.5 py-1">
                  Recomendado
                </span>
              </div>
              <a
                href="/images/payments/toke-qr.png"
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-white rounded-xl p-2"
                title="Abrir QR de Toke en tamaño completo"
              >
                <img
                  src="/images/payments/toke-qr.png"
                  alt="Código QR de Toke para pagar la membresía de VapePos"
                  className="w-full max-h-72 object-contain rounded-lg"
                />
              </a>
              <div className="text-xs text-slate-400 text-center mt-2">
                Escanea el código o tócalo para abrirlo en tamaño completo.
              </div>
            </div>

            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-2">
              O paga mediante transferencia bancaria:
            </div>
            {PAYMENT_INFO.map((bank, bi) => (
              <div key={bi} className="bg-[#101c35] rounded-xl p-4">
                <div className={`text-xs font-bold ${bank.color} mb-2`}>{bank.icon} {bank.bank}</div>
                <div className="space-y-1.5">
                  {bank.fields.map((f, fi) => {
                    const copyKey = `${bi}-${fi}`
                    return (
                      <div key={fi} className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">{f.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-200 font-mono">{f.value}</span>
                          <button
                            onClick={() => handleCopy(f.value, copyKey)}
                            className="text-xs text-slate-500 hover:text-[#00e5a0] transition-colors"
                          >
                            {copied === copyKey ? '✓' : '⎘'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            <div className="text-xs text-slate-500 text-center pt-1">
              Esta opción manual se verifica en menos de 24 horas hábiles.
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-secondary" onClick={onClose}>Cerrar</button>
            <button className="btn-primary" onClick={() => setStep(2)}>
              Ya pagué → Subir comprobante
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 2: Subir comprobante ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="text-sm text-slate-400">
            Sube una foto o captura de pantalla de tu comprobante de pago por <span className="text-[#00e5a0] font-semibold">RD$600</span>.
          </div>
          <div
            onClick={() => document.getElementById('upgrade-file-input').click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
              preview
                ? 'border-[#00e5a0]/40 bg-[#00e5a0]/5'
                : 'border-white/10 hover:border-[#00e5a0]/30 hover:bg-[#00e5a0]/5'
            }`}
          >
            {preview ? (
              <img src={preview} alt="Comprobante" className="max-h-52 mx-auto rounded-lg object-contain" />
            ) : (
              <div className="space-y-2">
                <div className="text-4xl">📎</div>
                <div className="text-sm text-slate-400">Toca para seleccionar imagen</div>
                <div className="text-xs text-slate-500">JPG, PNG — máx 5MB</div>
              </div>
            )}
          </div>
          <input id="upgrade-file-input" type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          {preview && (
            <button onClick={() => { setFile(null); setPreview(null) }}
              className="text-xs text-slate-500 hover:text-red-400 transition-colors">
              ✕ Cambiar imagen
            </button>
          )}
          <div>
            <label className="label">Notas adicionales (opcional)</label>
            <textarea className="input resize-none" rows={2}
              placeholder="Ej: Pagué el 23 de marzo, referencia #12345..."
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <button className="btn-secondary" onClick={() => setStep(1)}>← Atrás</button>
            <button className="btn-primary" disabled={!file || uploading} onClick={handleSubmit}>
              {uploading ? 'Enviando...' : 'Enviar Solicitud'}
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Éxito pago enviado ── */}
      {step === 3 && (
        <div className="text-center space-y-4 py-6">
          <div className="text-5xl">✅</div>
          <div>
            <div className="font-display font-bold text-slate-100 text-lg mb-2">¡Solicitud enviada!</div>
            <div className="text-slate-400 text-sm leading-relaxed">
              Revisaremos tu comprobante y activaremos tu plan Pro en menos de{' '}
              <span className="text-[#00e5a0] font-semibold">24 horas hábiles</span>.
            </div>
          </div>
          <div className="bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded-xl p-3 text-xs text-[#00e5a0]">
            Si tienes alguna duda puedes escribirnos desde la sección de Sugerencias.
          </div>
          <button className="btn-primary w-full" onClick={onClose}>Entendido</button>
        </div>
      )}


    </Modal>
  )
}
