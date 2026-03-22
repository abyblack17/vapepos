import React, { useState, useEffect } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import { genId, today, formatTime } from '../utils/helpers'
import { bizAdd, bizUpdate, bizGetAll, orderBy } from '../services/firestoreService'
import { db } from '../config/firebase'
import { collection, getDocs, query, orderBy as fbOrderBy, updateDoc, doc } from 'firebase/firestore'
import toast from 'react-hot-toast'

const TYPES = [
  { id: 'bug',        label: 'Error / Bug',        icon: '🐛', color: 'text-red-400',    border: 'border-red-500/20',    bg: 'bg-red-500/5'    },
  { id: 'mejora',     label: 'Mejora',              icon: '✨', color: 'text-[#00e5a0]', border: 'border-[#00e5a0]/20', bg: 'bg-[#00e5a0]/5' },
  { id: 'sugerencia', label: 'Sugerencia',          icon: '💡', color: 'text-[#f59e0b]', border: 'border-[#f59e0b]/20', bg: 'bg-[#f59e0b]/5' },
  { id: 'consulta',   label: 'Consulta / Pregunta', icon: '❓', color: 'text-[#00c4e8]', border: 'border-[#00c4e8]/20', bg: 'bg-[#00c4e8]/5' },
]

const STATUS_INFO = {
  nuevo:    { label: 'Enviado',    color: 'badge-blue'   },
  leido:    { label: 'En revision', color: 'badge-amber'  },
  resuelto: { label: 'Resuelto',   color: 'badge-green'  },
  cerrado:  { label: 'Cerrado',    color: 'badge-gray'   },
}

function StarRating({ value, onChange, readonly = false }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button key={star}
          disabled={readonly}
          onClick={() => !readonly && onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`text-2xl transition-all ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'} ${
            star <= (hover || value) ? 'text-[#f59e0b]' : 'text-slate-600'
          }`}>
          ★
        </button>
      ))}
    </div>
  )
}

export default function Suggestions() {
  const { state } = useApp()
  const { businessId } = useAuth()
  const { currentUser, settings } = state

  const [tab, setTab]             = useState('nueva')
  const [type, setType]           = useState('sugerencia')
  const [subject, setSubject]     = useState('')
  const [message, setMessage]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [mySuggestions, setMySuggestions] = useState([])
  const [loadingList, setLoadingList]     = useState(false)
  const [selected, setSelected]   = useState(null)
  const [allRatings, setAllRatings]       = useState([])

  // Load my suggestions and all ratings
  useEffect(() => {
    if (businessId) {
      loadMySuggestions()
      loadAllRatings()
    }
  }, [businessId])

  const loadMySuggestions = async () => {
    setLoadingList(true)
    try {
      const list = await bizGetAll(businessId, 'suggestions', [orderBy('createdAt', 'desc')])
      setMySuggestions(list)
    } catch {}
    setLoadingList(false)
  }

  // Load ratings from ALL businesses for global satisfaction score
  const loadAllRatings = async () => {
    try {
      // Get all businesses suggestions that have ratings
      const bizSnap = await getDocs(collection(db, 'businesses'))
      const allR = []
      for (const bizDoc of bizSnap.docs) {
        const sugSnap = await getDocs(
          query(collection(db, 'businesses', bizDoc.id, 'suggestions'), fbOrderBy('createdAt', 'desc'))
        )
        sugSnap.docs.forEach(d => {
          const data = d.data()
          if (data.rating) allR.push({ id: d.id, ...data })
        })
      }
      setAllRatings(allR)
    } catch {}
  }

  // Submit new suggestion
  const handleSubmit = async () => {
    if (!subject.trim()) return toast.error('Escribe un asunto')
    if (!message.trim()) return toast.error('Escribe tu mensaje')
    setLoading(true)
    try {
      await bizAdd(businessId, 'suggestions', {
        type,
        subject:      subject.trim(),
        message:      message.trim(),
        businessName: settings?.businessName || 'Sin nombre',
        userId:       currentUser?.id || '',
        userName:     currentUser?.name || 'Usuario',
        userEmail:    currentUser?.email || '',
        status:       'nuevo',
        date:         today(),
        time:         formatTime(),
        response:     null,
        rating:       null,
        resolved:     null,
      })
      toast.success('Mensaje enviado. Te responderemos pronto.')
      setSubject('')
      setMessage('')
      setTab('misTickets')
      await loadMySuggestions()
    } catch {
      toast.error('Error al enviar. Intenta de nuevo.')
    }
    setLoading(false)
  }

  // User decides if resolved
  const handleResolved = async (sug, resolved) => {
    if (resolved) {
      // Resolved → ask for rating
      setSelected({ ...sug, awaitingRating: true })
      await updateDoc(doc(db, 'businesses', businessId, 'suggestions', sug.id), {
        resolved: true, status: 'cerrado',
      })
      setMySuggestions(prev => prev.map(s => s.id === sug.id ? { ...s, resolved: true, status: 'cerrado', awaitingRating: true } : s))
    } else {
      // Not resolved → reopen
      await updateDoc(doc(db, 'businesses', businessId, 'suggestions', sug.id), {
        resolved: false, status: 'nuevo', response: null,
      })
      setMySuggestions(prev => prev.map(s => s.id === sug.id ? { ...s, resolved: false, status: 'nuevo', response: null } : s))
      setSelected(null)
      toast.success('Ticket reabierto. Puedes agregar mas informacion.')
    }
    await loadMySuggestions()
  }

  // Submit rating
  const handleRating = async (sug, rating, comment) => {
    await updateDoc(doc(db, 'businesses', businessId, 'suggestions', sug.id), {
      rating, ratingComment: comment, ratedAt: new Date(), status: 'cerrado',
    })
    setSelected(null)
    setMySuggestions(prev => prev.map(s => s.id === sug.id ? { ...s, rating, ratingComment: comment, status: 'cerrado' } : s))
    await loadAllRatings()
    toast.success('Gracias por tu calificacion!')
  }

  // Global satisfaction stats
  const avgRating   = allRatings.length ? (allRatings.reduce((a, r) => a + r.rating, 0) / allRatings.length).toFixed(1) : null
  const ratingDist  = [5,4,3,2,1].map(n => ({ stars: n, count: allRatings.filter(r => r.rating === n).length }))
  const pendingResponse = mySuggestions.filter(s => s.response && s.resolved === null)

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-slate-100 text-xl">Sugerencias y Soporte</h2>
          <p className="text-sm text-slate-400 mt-0.5">Reporta errores, sugiere mejoras o consultas al equipo de VapePOS.</p>
        </div>
        {pendingResponse.length > 0 && (
          <div className="bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-bold px-3 py-1.5 rounded-full animate-pulse">
            {pendingResponse.length} respuesta{pendingResponse.length > 1 ? 's' : ''} esperando
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#101c35] rounded-xl p-1 w-fit">
        {[
          { id: 'nueva',      label: 'Nueva consulta' },
          { id: 'misTickets', label: `Mis tickets (${mySuggestions.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id ? 'bg-[#00e5a0] text-[#080d18]' : 'text-slate-400 hover:text-slate-200'
            }`}>
            {t.label}
            {t.id === 'misTickets' && pendingResponse.length > 0 && (
              <span className="ml-2 bg-[#f59e0b] text-[#080d18] text-xs w-4 h-4 rounded-full inline-flex items-center justify-center font-bold">
                {pendingResponse.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ NUEVA CONSULTA ══ */}
      {tab === 'nueva' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {TYPES.map(t => (
              <button key={t.id} onClick={() => setType(t.id)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  type === t.id ? `${t.bg} ${t.border} ${t.color}` : 'bg-[#101c35] border-white/10 text-slate-400 hover:border-white/20'
                }`}>
                <div className="text-2xl mb-1">{t.icon}</div>
                <div className="font-semibold text-sm">{t.label}</div>
              </button>
            ))}
          </div>

          <div className="card p-6 space-y-4">
            <div>
              <label className="label">Asunto *</label>
              <input className="input" placeholder="Resume brevemente tu mensaje..."
                value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div>
              <label className="label">Mensaje *</label>
              <textarea className="input resize-none" rows={5}
                placeholder="Describe con detalle. Si es un error, indica en que pagina ocurre..."
                value={message} onChange={e => setMessage(e.target.value)} />
            </div>
            <div className="bg-[#101c35] rounded-xl p-3 text-xs text-slate-400 space-y-1">
              <div className="flex justify-between"><span>Negocio</span><span className="text-slate-200">{settings?.businessName || '—'}</span></div>
              <div className="flex justify-between"><span>Usuario</span><span className="text-slate-200">{currentUser?.name} ({currentUser?.role})</span></div>
            </div>
            <button onClick={handleSubmit} disabled={loading} className="btn-primary w-full py-3">
              {loading ? 'Enviando...' : 'Enviar mensaje'}
            </button>
          </div>
        </div>
      )}

      {/* ══ MIS TICKETS ══ */}
      {tab === 'misTickets' && (
        <div className="space-y-4">
          {loadingList ? (
            <div className="text-center py-10 text-slate-500">Cargando...</div>
          ) : mySuggestions.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-4xl mb-3">📭</div>
              <div className="text-slate-400">No has enviado ninguna consulta aun</div>
              <button onClick={() => setTab('nueva')} className="btn-primary mt-4 text-sm">Enviar primera consulta</button>
            </div>
          ) : (
            mySuggestions.map(sug => {
              const isOpen = selected?.id === sug.id
              const hasResponse = !!sug.response
              const awaitingDecision = hasResponse && sug.resolved === null
              const status = STATUS_INFO[sug.status] || STATUS_INFO.nuevo

              return (
                <div key={sug.id}
                  className={`card p-5 space-y-3 cursor-pointer transition-all ${
                    awaitingDecision ? 'border-[#f59e0b]/30 bg-[#f59e0b]/5' : ''
                  } ${isOpen ? 'border-[#00c4e8]/20' : ''}`}
                  onClick={() => setSelected(isOpen ? null : sug)}>

                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{TYPES.find(t => t.id === sug.type)?.icon || '💬'}</span>
                      <div>
                        <div className="font-semibold text-slate-100">{sug.subject}</div>
                        <div className="text-xs text-slate-500">{sug.date} {sug.time}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {awaitingDecision && (
                        <span className="text-xs bg-[#f59e0b]/20 border border-[#f59e0b]/30 text-[#f59e0b] px-2 py-0.5 rounded-full font-bold animate-pulse">
                          Respuesta recibida
                        </span>
                      )}
                      {sug.rating && <StarRating value={sug.rating} readonly />}
                      <span className={`badge ${status.color}`}>{status.label}</span>
                    </div>
                  </div>

                  {/* Expandido */}
                  {isOpen && (
                    <div className="space-y-3 pt-2 border-t border-white/10" onClick={e => e.stopPropagation()}>

                      {/* Mensaje original */}
                      <div className="bg-[#101c35] rounded-xl p-4">
                        <div className="text-xs text-slate-500 mb-1">Tu mensaje</div>
                        <div className="text-sm text-slate-300">{sug.message}</div>
                      </div>

                      {/* Respuesta del equipo */}
                      {hasResponse && (
                        <div className="bg-[#00e5a0]/5 border border-[#00e5a0]/20 rounded-xl p-4">
                          <div className="text-xs text-[#00e5a0] font-bold mb-2">Respuesta del equipo VapePOS</div>
                          <div className="text-sm text-slate-200">{sug.response}</div>
                        </div>
                      )}

                      {/* Pregunta: resolvimos tu problema? */}
                      {awaitingDecision && (
                        <div className="bg-[#101c35] border border-[#f59e0b]/20 rounded-xl p-4 space-y-3">
                          <div className="font-semibold text-slate-100 text-sm">Resolvimos tu problema?</div>
                          <div className="flex gap-3">
                            <button onClick={() => handleResolved(sug, true)}
                              className="flex-1 py-2.5 rounded-xl bg-[#00e5a0]/15 border border-[#00e5a0]/30 text-[#00e5a0] font-semibold text-sm hover:bg-[#00e5a0]/25 transition-all">
                              Si, resuelto ✓
                            </button>
                            <button onClick={() => handleResolved(sug, false)}
                              className="flex-1 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-semibold text-sm hover:bg-red-500/20 transition-all">
                              No, necesito mas ayuda
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Formulario de calificacion */}
                      {selected?.awaitingRating && selected?.id === sug.id && (
                        <RatingForm sug={sug} onSubmit={handleRating} />
                      )}

                      {/* Calificacion ya dada */}
                      {sug.rating && !selected?.awaitingRating && (
                        <div className="bg-[#101c35] rounded-xl p-4">
                          <div className="text-xs text-slate-500 mb-2">Tu calificacion</div>
                          <StarRating value={sug.rating} readonly />
                          {sug.ratingComment && (
                            <div className="text-xs text-slate-400 mt-2 italic">"{sug.ratingComment}"</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* ── Tasa de satisfaccion global ─────────────────── */}
          {allRatings.length > 0 && (
            <div className="card p-5 space-y-4">
              <div className="font-display font-bold text-slate-100">Tasa de Satisfaccion Global</div>

              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="font-display font-black text-5xl text-[#f59e0b]">{avgRating}</div>
                  <StarRating value={Math.round(parseFloat(avgRating))} readonly />
                  <div className="text-xs text-slate-500 mt-1">{allRatings.length} calificaciones</div>
                </div>

                <div className="flex-1 space-y-1.5">
                  {ratingDist.map(({ stars, count }) => {
                    const pct = allRatings.length ? Math.round((count / allRatings.length) * 100) : 0
                    return (
                      <div key={stars} className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 w-3">{stars}</span>
                        <span className="text-[#f59e0b] text-xs">★</span>
                        <div className="flex-1 bg-[#101c35] rounded-full h-2">
                          <div className="bg-[#f59e0b] h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Ultimas calificaciones */}
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Ultimas calificaciones</div>
                {allRatings.slice(0, 3).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/5">
                    <StarRating value={r.rating} readonly />
                    <div className="flex-1 min-w-0">
                      {r.ratingComment && <div className="text-xs text-slate-400 truncate italic">"{r.ratingComment}"</div>}
                      <div className="text-xs text-slate-600">{r.businessName}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Rating Form Component ─────────────────────────────────────
function RatingForm({ sug, onSubmit }) {
  const [rating, setRating]   = useState(0)
  const [comment, setComment] = useState('')

  return (
    <div className="bg-[#8b5cf6]/5 border border-[#8b5cf6]/20 rounded-xl p-5 space-y-4">
      <div className="font-semibold text-slate-100">Califica nuestra atencion</div>
      <div className="text-sm text-slate-400">¿Como calificarias la resolucion de tu caso?</div>

      <div className="space-y-2">
        <StarRating value={rating} onChange={setRating} />
        <div className="flex justify-between text-xs text-slate-600">
          <span>Pesimo</span>
          <span>Excelente</span>
        </div>
      </div>

      <div>
        <label className="label">Comentario (opcional)</label>
        <textarea className="input resize-none" rows={2}
          placeholder="Cuéntanos como fue tu experiencia..."
          value={comment} onChange={e => setComment(e.target.value)} />
      </div>

      <button
        disabled={rating === 0}
        onClick={() => onSubmit(sug, rating, comment)}
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Enviar calificacion
      </button>
    </div>
  )
}
