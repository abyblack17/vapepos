import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../config/firebase'
import {
  collection, getDocs, query, orderBy as fbOrderBy,
  updateDoc, deleteDoc, doc, addDoc, serverTimestamp,
} from 'firebase/firestore'
import { fmt } from '../utils/helpers'
import toast from 'react-hot-toast'

const TABS = ['Resumen', 'Negocios', 'Usuarios', 'Upgrades', 'Sugerencias', 'Directorio', 'Anuncios']

const TYPE_COLORS = {
  bug:        'text-red-400 bg-red-500/10 border-red-500/20',
  mejora:     'text-[#00e5a0] bg-[#00e5a0]/10 border-[#00e5a0]/20',
  sugerencia: 'text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/20',
  consulta:   'text-[#00c4e8] bg-[#00c4e8]/10 border-[#00c4e8]/20',
}
const STATUS_BADGE = { nuevo: 'badge-red', leido: 'badge-blue', resuelto: 'badge-green' }

const ts = (seconds) => seconds ? new Date(seconds * 1000).toLocaleDateString('es-DO') : '—'

export default function SuperAdmin() {
  const { logout, currentUser } = useAuth()
  const [tab, setTab]                       = useState('Resumen')
  const [businesses, setBusinesses]         = useState([])
  const [allUsers, setAllUsers]             = useState([])
  const [suggestions, setSuggestions]       = useState([])
  const [directory, setDirectory]           = useState([])
  const [announcements, setAnnouncements]   = useState([])
  const [upgradeRequests, setUpgradeRequests] = useState([])
  const [loading, setLoading]               = useState(true)
  const [selectedBiz, setSelectedBiz]       = useState(null)
  const [bizSales, setBizSales]             = useState([])
  const [loadingSales, setLoadingSales]     = useState(false)
  const [sugFilter, setSugFilter]           = useState('todos')
  const [upgradeFilter, setUpgradeFilter]   = useState('pending')
  const [announcement, setAnnouncement]     = useState({ title: '', message: '', type: 'info' })
  const [editingAnn, setEditingAnn]         = useState(null)
  const [sending, setSending]               = useState(false)
  const [bizSearch, setBizSearch]           = useState('')
  const [userSearch, setUserSearch]         = useState('')
  const [msgModal, setMsgModal]             = useState(null)
  const [msgText, setMsgText]               = useState('')
  const [sendingMsg, setSendingMsg]         = useState(false)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const bizSnap = await getDocs(query(collection(db, 'businesses'), fbOrderBy('createdAt', 'desc')))
      const bizList = bizSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setBusinesses(bizList)

      const userSnap = await getDocs(collection(db, 'users'))
      setAllUsers(userSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      const allSug = []
      for (const biz of bizList) {
        try {
          const s = await getDocs(query(collection(db, 'businesses', biz.id, 'suggestions'), fbOrderBy('createdAt', 'desc')))
          s.docs.forEach(d => allSug.push({ id: d.id, bizName: biz.name, bizId: biz.id, ...d.data() }))
        } catch {}
      }
      setSuggestions(allSug.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))

      const allUpgrades = []
      for (const biz of bizList) {
        try {
          const u = await getDocs(query(collection(db, 'businesses', biz.id, 'upgrade_requests'), fbOrderBy('createdAt', 'desc')))
          u.docs.forEach(d => allUpgrades.push({ id: d.id, bizId: biz.id, bizName: biz.name, ...d.data() }))
        } catch {}
      }
      setUpgradeRequests(allUpgrades.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))

      // Directorio — leer directamente de Firestore para obtener todos los campos
      const dirSnap = await getDocs(query(collection(db, 'providers_directory'), fbOrderBy('createdAt', 'desc')))
      setDirectory(dirSnap.docs.map(d => ({ id: d.id, ...d.data() })))

      const annSnap = await getDocs(query(collection(db, 'system_announcements'), fbOrderBy('createdAt', 'desc')))
      setAnnouncements(annSnap.docs.map(d => ({ id: d.id, ...d.data() })))

    } catch (err) {
      console.error('SuperAdmin loadAll:', err.message)
      toast.error('Error cargando datos: ' + err.message)
    }
    setLoading(false)
  }

  // ── Cargar ventas de un negocio ──────────────────────────
  const loadBizSales = async (biz) => {
    setLoadingSales(true)
    try {
      const snap = await getDocs(query(
        collection(db, 'businesses', biz.id, 'sales'),
        fbOrderBy('createdAt', 'desc')
      ))
      setBizSales(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (err) {
      console.warn('loadBizSales:', err.message)
      setBizSales([])
    }
    setLoadingSales(false)
  }

  const handleSelectBiz = (biz) => {
    if (selectedBiz?.id === biz.id) {
      setSelectedBiz(null)
      setBizSales([])
    } else {
      setSelectedBiz(biz)
      loadBizSales(biz)
    }
  }

  // ── Aprobar upgrade ──────────────────────────────────────
  const approveUpgrade = async (req) => {
    try {
      const now = new Date()
      const expiresAt = new Date(now)
      expiresAt.setDate(expiresAt.getDate() + 30)
      await updateDoc(doc(db, 'businesses', req.bizId), {
        plan: 'pro', planExpiresAt: expiresAt, planActivatedAt: now, updatedAt: serverTimestamp(),
      })
      await updateDoc(doc(db, 'businesses', req.bizId, 'upgrade_requests', req.id), {
        status: 'approved', approvedAt: serverTimestamp(), approvedBy: currentUser?.email,
      })
      setUpgradeRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'approved' } : r))
      setBusinesses(prev => prev.map(b => b.id === req.bizId ? { ...b, plan: 'pro', planExpiresAt: expiresAt } : b))
      toast.success(`Plan Pro activado para "${req.bizName}"`)
    } catch (err) { toast.error('Error al aprobar: ' + err.message) }
  }

  const rejectUpgrade = async (req) => {
    try {
      await updateDoc(doc(db, 'businesses', req.bizId, 'upgrade_requests', req.id), {
        status: 'rejected', rejectedAt: serverTimestamp(), rejectedBy: currentUser?.email,
      })
      setUpgradeRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'rejected' } : r))
      toast.success('Solicitud rechazada')
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  // ── Eliminar upgrade del historial ───────────────────────
  const deleteUpgrade = async (req) => {
    try {
      await deleteDoc(doc(db, 'businesses', req.bizId, 'upgrade_requests', req.id))
      setUpgradeRequests(prev => prev.filter(r => r.id !== req.id))
      toast.success('Solicitud eliminada')
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  // ── Cambiar plan ─────────────────────────────────────────
  const changePlan = async (biz, newPlan) => {
    try {
      const updates = { plan: newPlan, updatedAt: serverTimestamp() }
      if (newPlan === 'pro') {
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + 30)
        updates.planExpiresAt = expiresAt
        updates.planActivatedAt = new Date()
      } else {
        updates.planExpiresAt = null
      }
      await updateDoc(doc(db, 'businesses', biz.id), updates)
      setBusinesses(prev => prev.map(b => b.id === biz.id ? { ...b, ...updates } : b))
      if (selectedBiz?.id === biz.id) setSelectedBiz(prev => ({ ...prev, ...updates }))
      toast.success(`Plan de "${biz.name}" cambiado a ${newPlan}`)
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  const toggleBusiness = async (biz) => {
    await updateDoc(doc(db, 'businesses', biz.id), { active: !biz.active })
    setBusinesses(prev => prev.map(b => b.id === biz.id ? { ...b, active: !b.active } : b))
    toast.success(`Negocio ${biz.active ? 'suspendido' : 'activado'}`)
  }

  const toggleUser = async (user) => {
    await updateDoc(doc(db, 'users', user.id), { active: !user.active })
    setAllUsers(prev => prev.map(u => u.id === user.id ? { ...u, active: !user.active } : u))
    toast.success(`Usuario ${user.active ? 'desactivado' : 'activado'}`)
  }

  // ── Sugerencias ──────────────────────────────────────────
  const markSuggestion = async (sug, status) => {
    await updateDoc(doc(db, 'businesses', sug.bizId, 'suggestions', sug.id), { status })
    setSuggestions(prev => prev.map(s => s.id === sug.id ? { ...s, status } : s))
    toast.success('Estado actualizado')
  }

  const respondToSuggestion = async (sug, responseText) => {
    await updateDoc(doc(db, 'businesses', sug.bizId, 'suggestions', sug.id), {
      response: responseText, respondedAt: new Date(),
      respondedBy: currentUser?.email || 'Super Admin',
      status: 'leido',
    })
    setSuggestions(prev => prev.map(s => s.id === sug.id ? { ...s, response: responseText, status: 'leido' } : s))
    toast.success('Respuesta enviada')
  }

  const deleteSuggestion = async (sug) => {
    try {
      await deleteDoc(doc(db, 'businesses', sug.bizId, 'suggestions', sug.id))
      setSuggestions(prev => prev.filter(s => s.id !== sug.id))
      toast.success('Sugerencia eliminada')
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  // ── Directorio ───────────────────────────────────────────
  const deleteDirectory = async (entry) => {
    try {
      await deleteDoc(doc(db, 'providers_directory', entry.id))
      setDirectory(prev => prev.filter(d => d.id !== entry.id))
      toast.success('Proveedor eliminado del directorio')
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  // ── Anuncios ─────────────────────────────────────────────
  const sendAnnouncement = async () => {
    if (!announcement.title || !announcement.message) { toast.error('Completa titulo y mensaje'); return }
    setSending(true)
    try {
      const ref = await addDoc(collection(db, 'system_announcements'), {
        ...announcement, sentBy: currentUser?.email, active: true, createdAt: serverTimestamp(),
      })
      setAnnouncements(prev => [{ id: ref.id, ...announcement, active: true }, ...prev])
      setAnnouncement({ title: '', message: '', type: 'info' })
      toast.success('Anuncio enviado')
    } catch (err) { toast.error('Error: ' + err.message) }
    setSending(false)
  }

  const saveEditAnnouncement = async () => {
    if (!editingAnn?.title || !editingAnn?.message) { toast.error('Completa titulo y mensaje'); return }
    try {
      await updateDoc(doc(db, 'system_announcements', editingAnn.id), {
        title: editingAnn.title, message: editingAnn.message, type: editingAnn.type, updatedAt: serverTimestamp(),
      })
      setAnnouncements(prev => prev.map(a => a.id === editingAnn.id ? { ...a, ...editingAnn } : a))
      setEditingAnn(null)
      toast.success('Anuncio actualizado')
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  const deactivateAnnouncement = async (ann) => {
    await updateDoc(doc(db, 'system_announcements', ann.id), { active: false })
    setAnnouncements(prev => prev.map(a => a.id === ann.id ? { ...a, active: false } : a))
    toast.success('Anuncio desactivado')
  }

  const deleteAnnouncement = async (ann) => {
    try {
      await deleteDoc(doc(db, 'system_announcements', ann.id))
      setAnnouncements(prev => prev.filter(a => a.id !== ann.id))
      toast.success('Anuncio eliminado')
    } catch (err) { toast.error('Error: ' + err.message) }
  }

  // ── Mensaje privado al dueño ─────────────────────────────
  const sendPrivateMessage = async () => {
    if (!msgText.trim()) { toast.error('Escribe un mensaje'); return }
    setSendingMsg(true)
    try {
      await addDoc(collection(db, 'businesses', msgModal.id, 'suggestions'), {
        subject:     '📩 Mensaje del equipo VapePOS',
        message:     msgText.trim(),
        type:        'consulta',
        status:      'nuevo',
        userName:    'VapePOS',
        userEmail:   currentUser?.email || 'superadmin',
        userId:      'superadmin',
        date:        new Date().toISOString().split('T')[0],
        time:        new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
        fromAdmin:   true,
        createdAt:   serverTimestamp(),
      })
      toast.success(`Mensaje enviado a "${msgModal.name}"`)
      setMsgModal(null)
      setMsgText('')
    } catch (err) { toast.error('Error: ' + err.message) }
    setSendingMsg(false)
  }

  // ── Stats ────────────────────────────────────────────────
  const activeBusinesses = businesses.filter(b => b.active !== false).length
  const proBusinesses    = businesses.filter(b => b.plan === 'pro').length
  const realUsers        = allUsers.filter(u => u.role !== 'superadmin')
  const newSuggestions   = suggestions.filter(s => s.status === 'nuevo' && !s.fromAdmin).length
  const pendingUpgrades  = upgradeRequests.filter(r => r.status === 'pending').length

  const bizByMonth = businesses.reduce((acc, b) => {
    if (!b.createdAt?.seconds) return acc
    const d   = new Date(b.createdAt.seconds * 1000)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    acc[key]  = (acc[key] || 0) + 1
    return acc
  }, {})

  const filteredSuggestions = suggestions.filter(s =>
    !s.fromAdmin && (sugFilter === 'todos' || s.status === sugFilter || s.type === sugFilter)
  )
  const filteredBusinesses = businesses.filter(b =>
    !bizSearch || b.name?.toLowerCase().includes(bizSearch.toLowerCase()) ||
    b.phone?.includes(bizSearch) || b.address?.toLowerCase().includes(bizSearch.toLowerCase())
  )
  const filteredUsers = realUsers.filter(u =>
    !userSearch || u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase())
  )
  const filteredUpgrades = upgradeRequests.filter(r => upgradeFilter === 'todos' || r.status === upgradeFilter)

  // Stats del negocio seleccionado
  const bizTotalSales   = bizSales.reduce((a, s) => a + (s.total || 0), 0)
  const bizTotalProfit  = bizSales.reduce((a, s) => a + (s.profit || 0), 0)
  const bizTotalRefills = bizSales.reduce((a, s) => a + (s.refills?.length || 0), 0)

  return (
    <div className="min-h-screen bg-[#080d18]">
      {/* Header */}
      <div className="bg-[#0c1424] border-b border-white/5 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="font-display text-2xl font-black gradient-neon">VapePOS</div>
          <div className="bg-[#8b5cf6]/20 border border-[#8b5cf6]/30 text-[#a78bfa] text-xs font-bold px-3 py-1 rounded-full">SUPER ADMIN</div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={loadAll} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">Actualizar datos</button>
          <span className="text-sm text-slate-400">{currentUser?.email}</span>
          <button onClick={logout} className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all">
            Cerrar sesion
          </button>
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-[#101c35] rounded-xl p-1 w-fit flex-wrap">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all relative ${
                tab === t ? 'bg-[#8b5cf6] text-white' : 'text-slate-400 hover:text-slate-200'
              }`}>
              {t}
              {t === 'Sugerencias' && newSuggestions > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center">{newSuggestions}</span>
              )}
              {t === 'Upgrades' && pendingUpgrades > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#f59e0b] text-black text-xs w-4 h-4 rounded-full flex items-center justify-center">{pendingUpgrades}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-500 animate-pulse">Cargando datos de la plataforma...</div>
        ) : (<>

          {/* ══════════ RESUMEN ══════════ */}
          {tab === 'Resumen' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Negocios activos',     value: activeBusinesses,  sub: `${proBusinesses} en Pro`,           color: 'text-[#00e5a0]', icon: '🏪', goto: 'Negocios' },
                  { label: 'Usuarios registrados', value: realUsers.length,  sub: `${realUsers.filter(u=>u.active).length} activos`, color: 'text-[#00c4e8]', icon: '👥', goto: 'Usuarios' },
                  { label: 'Upgrades pendientes',  value: pendingUpgrades,   sub: `${upgradeRequests.length} totales`, color: 'text-[#f59e0b]', icon: '⚡', goto: 'Upgrades' },
                  { label: 'Sugerencias nuevas',   value: newSuggestions,    sub: `${filteredSuggestions.length} totales`, color: 'text-[#a78bfa]', icon: '💬', goto: 'Sugerencias' },
                ].map((s, i) => (
                  <div key={i} className="bg-[#0c1424] border border-white/10 rounded-xl p-5 cursor-pointer hover:border-white/20 transition-all"
                    onClick={() => setTab(s.goto)}>
                    <div className="text-2xl mb-2">{s.icon}</div>
                    <div className={`font-display font-bold text-3xl ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                    <div className="text-xs text-slate-600 mt-0.5">{s.sub}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0c1424] border border-white/10 rounded-xl p-5">
                  <div className="font-bold text-slate-100 mb-4">Negocios por mes</div>
                  {Object.entries(bizByMonth).slice(-6).map(([month, count]) => (
                    <div key={month} className="flex items-center gap-3 mb-2">
                      <span className="text-xs text-slate-500 w-16">{month}</span>
                      <div className="flex-1 bg-[#101c35] rounded-full h-2">
                        <div className="bg-[#00e5a0] h-2 rounded-full" style={{ width: `${(count / Math.max(...Object.values(bizByMonth))) * 100}%` }} />
                      </div>
                      <span className="text-xs font-bold text-[#00e5a0] w-4">{count}</span>
                    </div>
                  ))}
                  {Object.keys(bizByMonth).length === 0 && <div className="text-sm text-slate-500">Sin datos</div>}
                </div>
                <div className="bg-[#0c1424] border border-white/10 rounded-xl p-5">
                  <div className="font-bold text-slate-100 mb-4">Upgrades recientes</div>
                  {upgradeRequests.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-center justify-between py-1.5 border-b border-white/5">
                      <div>
                        <div className="text-sm text-slate-200">{r.bizName}</div>
                        <div className="text-xs text-slate-500">{r.ownerEmail}</div>
                      </div>
                      <span className={`badge ${r.status === 'pending' ? 'badge-amber' : r.status === 'approved' ? 'badge-green' : 'badge-red'}`}>
                        {r.status === 'pending' ? 'Pendiente' : r.status === 'approved' ? 'Aprobado' : 'Rechazado'}
                      </span>
                    </div>
                  ))}
                  {upgradeRequests.length === 0 && <div className="text-sm text-slate-500">Sin solicitudes</div>}
                </div>
              </div>
            </div>
          )}

          {/* ══════════ NEGOCIOS ══════════ */}
          {tab === 'Negocios' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2">
                  <span className="text-slate-500">🔍</span>
                  <input className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
                    placeholder="Buscar por nombre, telefono o ciudad..."
                    value={bizSearch} onChange={e => setBizSearch(e.target.value)} />
                </div>
                <div className="text-sm text-slate-400">{filteredBusinesses.length} negocios</div>
              </div>

              <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      {['Negocio', 'Contacto', 'Plan', 'Vence', 'Usuarios', 'Registro', 'Estado', 'Acciones'].map(h => (
                        <th key={h} className="table-header">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBusinesses.map(b => {
                      const bizUsers = allUsers.filter(u => u.businessId === b.id && u.role !== 'superadmin')
                      const expires  = b.planExpiresAt ? (b.planExpiresAt?.toDate?.() || new Date(b.planExpiresAt)) : null
                      return (
                        <tr key={b.id} className="table-row cursor-pointer" onClick={() => handleSelectBiz(b)}>
                          <td className="table-cell">
                            <div className="font-semibold text-slate-200">{b.name}</div>
                            <div className="text-xs text-slate-600 font-mono">{b.id.slice(0,10)}...</div>
                          </td>
                          <td className="table-cell text-slate-400 text-xs">{b.phone || '—'}</td>
                          <td className="table-cell">
                            <span className={`badge ${b.plan === 'pro' ? 'badge-green' : 'badge-gray'}`}>
                              {b.plan === 'pro' ? '⚡ Pro' : 'Básico'}
                            </span>
                          </td>
                          <td className="table-cell text-xs text-slate-400">
                            {expires ? expires.toLocaleDateString('es-DO') : '—'}
                          </td>
                          <td className="table-cell text-center"><span className="badge badge-blue">{bizUsers.length}</span></td>
                          <td className="table-cell text-slate-500 text-xs">{ts(b.createdAt?.seconds)}</td>
                          <td className="table-cell">
                            <span className={`badge ${b.active !== false ? 'badge-green' : 'badge-red'}`}>
                              {b.active !== false ? 'Activo' : 'Suspendido'}
                            </span>
                          </td>
                          <td className="table-cell" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-1 flex-wrap">
                              <button onClick={() => changePlan(b, b.plan === 'pro' ? 'basic' : 'pro')}
                                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                                  b.plan === 'pro'
                                    ? 'border-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/10'
                                    : 'border-[#00e5a0]/20 text-[#00e5a0] hover:bg-[#00e5a0]/10'
                                }`}>
                                {b.plan === 'pro' ? 'Bajar a Básico' : 'Subir a Pro'}
                              </button>
                              <button onClick={() => toggleBusiness(b)}
                                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                                  b.active !== false
                                    ? 'border-red-500/20 text-red-400 hover:bg-red-500/10'
                                    : 'border-[#00e5a0]/20 text-[#00e5a0] hover:bg-[#00e5a0]/10'
                                }`}>
                                {b.active !== false ? 'Suspender' : 'Activar'}
                              </button>
                              <button onClick={() => { setMsgModal(b); setMsgText('') }}
                                className="text-xs px-2.5 py-1 rounded-lg border border-[#00c4e8]/20 text-[#00c4e8] hover:bg-[#00c4e8]/10 transition-all">
                                ✉ Mensaje
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Panel de detalle del negocio */}
              {selectedBiz && (
                <div className="bg-[#0c1424] border border-[#00c4e8]/20 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-[#00c4e8] text-lg">📊 {selectedBiz.name}</div>
                    <button onClick={() => { setSelectedBiz(null); setBizSales([]) }} className="text-slate-500 hover:text-slate-300">✕</button>
                  </div>

                  {/* Info básica */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {[
                      { l: 'Plan', v: selectedBiz.plan === 'pro' ? '⚡ Pro' : 'Básico', c: selectedBiz.plan === 'pro' ? 'text-[#00e5a0]' : 'text-slate-300' },
                      { l: 'Empleados', v: allUsers.filter(u => u.businessId === selectedBiz.id).length, c: 'text-[#00c4e8]' },
                      { l: 'Teléfono', v: selectedBiz.phone || '—', c: 'text-slate-300' },
                      { l: 'Dirección', v: selectedBiz.address || '—', c: 'text-slate-300' },
                    ].map((s, i) => (
                      <div key={i} className="bg-[#101c35] rounded-lg p-3">
                        <div className="text-slate-500 mb-1">{s.l}</div>
                        <div className={`font-semibold ${s.c}`}>{s.v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Stats de ventas */}
                  {loadingSales ? (
                    <div className="text-center text-slate-500 text-sm py-4 animate-pulse">Cargando ventas...</div>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div className="bg-[#101c35] rounded-lg p-3 text-center">
                          <div className="text-slate-500 mb-1">Total ventas</div>
                          <div className="font-display font-bold text-[#00e5a0] text-lg">{bizSales.length}</div>
                        </div>
                        <div className="bg-[#101c35] rounded-lg p-3 text-center">
                          <div className="text-slate-500 mb-1">Ingresos totales</div>
                          <div className="font-display font-bold text-[#00c4e8]">{fmt(bizTotalSales)}</div>
                        </div>
                        <div className="bg-[#101c35] rounded-lg p-3 text-center">
                          <div className="text-slate-500 mb-1">Ganancia estimada</div>
                          <div className={`font-display font-bold ${bizTotalProfit >= 0 ? 'text-[#a78bfa]' : 'text-red-400'}`}>{fmt(bizTotalProfit)}</div>
                        </div>
                      </div>

                      {/* Últimas 5 ventas */}
                      {bizSales.length > 0 && (
                        <div>
                          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Últimas ventas</div>
                          <div className="space-y-1.5">
                            {bizSales.slice(0, 5).map(s => (
                              <div key={s.id} className="flex justify-between items-center bg-[#101c35] rounded-lg px-3 py-2 text-xs">
                                <span className="text-slate-400">{s.date} {s.time}</span>
                                <span className="text-slate-300">{s.customerName || 'Cliente general'}</span>
                                <span className="text-slate-400">{s.payment}</span>
                                <span className="font-mono font-bold text-[#00e5a0]">{fmt(s.total)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="text-xs text-slate-600">ID: {selectedBiz.id}</div>
                </div>
              )}
            </div>
          )}

          {/* ══════════ USUARIOS ══════════ */}
          {tab === 'Usuarios' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2">
                  <span className="text-slate-500">🔍</span>
                  <input className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
                    placeholder="Buscar por nombre o correo..."
                    value={userSearch} onChange={e => setUserSearch(e.target.value)} />
                </div>
                <div className="text-sm text-slate-400">{filteredUsers.length} usuarios</div>
              </div>
              <div className="bg-[#0c1424] border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      {['Usuario', 'Email', 'Rol', 'Negocio', 'Estado', 'Registro', 'Accion'].map(h => (
                        <th key={h} className="table-header">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => {
                      const biz = businesses.find(b => b.id === u.businessId)
                      const ROLE_BADGE = { Administrador: 'badge-purple', Encargado: 'badge-blue', Cajero: 'badge-green' }
                      return (
                        <tr key={u.id} className="table-row">
                          <td className="table-cell">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-[#8b5cf6]/15 border border-[#8b5cf6]/20 flex items-center justify-center text-xs font-bold text-[#a78bfa]">
                                {(u.displayName || u.email || '?')[0].toUpperCase()}
                              </div>
                              <span className="font-semibold text-slate-200 text-sm">{u.displayName || '—'}</span>
                            </div>
                          </td>
                          <td className="table-cell text-slate-400 text-xs">{u.email}</td>
                          <td className="table-cell"><span className={`badge ${ROLE_BADGE[u.role] || 'badge-gray'}`}>{u.role}</span></td>
                          <td className="table-cell text-slate-400 text-xs">{biz?.name || '—'}</td>
                          <td className="table-cell"><span className={`badge ${u.active ? 'badge-green' : 'badge-red'}`}>{u.active ? 'Activo' : 'Inactivo'}</span></td>
                          <td className="table-cell text-slate-500 text-xs">{ts(u.createdAt?.seconds)}</td>
                          <td className="table-cell">
                            <button onClick={() => toggleUser(u)}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                                u.active ? 'border-red-500/20 text-red-400 hover:bg-red-500/10' : 'border-[#00e5a0]/20 text-[#00e5a0] hover:bg-[#00e5a0]/10'
                              }`}>
                              {u.active ? 'Desactivar' : 'Activar'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={7} className="table-cell text-center text-slate-500 py-10">Sin usuarios</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════ UPGRADES ══════════ */}
          {tab === 'Upgrades' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="font-bold text-slate-100">Solicitudes de Upgrade</div>
                <div className="flex gap-2 ml-auto flex-wrap">
                  {['pending', 'approved', 'rejected', 'todos'].map(f => (
                    <button key={f} onClick={() => setUpgradeFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        upgradeFilter === f
                          ? 'bg-[#8b5cf6]/20 border-[#8b5cf6]/30 text-[#a78bfa]'
                          : 'bg-[#101c35] border-white/10 text-slate-400 hover:border-white/25'
                      }`}>
                      {f === 'pending' ? `Pendientes (${pendingUpgrades})` : f === 'approved' ? 'Aprobados' : f === 'rejected' ? 'Rechazados' : 'Todos'}
                    </button>
                  ))}
                </div>
              </div>

              {filteredUpgrades.length === 0 ? (
                <div className="bg-[#0c1424] border border-white/10 rounded-xl p-12 text-center text-slate-500">
                  No hay solicitudes {upgradeFilter !== 'todos' ? `con estado "${upgradeFilter}"` : ''}
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredUpgrades.map(r => (
                    <div key={r.id} className={`bg-[#0c1424] border rounded-xl p-5 ${r.status === 'pending' ? 'border-[#f59e0b]/30' : 'border-white/10'}`}>
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <div className="font-bold text-slate-100">{r.bizName}</div>
                            <span className={`badge ${r.status === 'pending' ? 'badge-amber' : r.status === 'approved' ? 'badge-green' : 'badge-red'}`}>
                              {r.status === 'pending' ? 'Pendiente' : r.status === 'approved' ? 'Aprobado' : 'Rechazado'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400">{r.ownerName} · {r.ownerEmail}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Plan actual: <span className="text-slate-300">{r.currentPlan}</span> →
                            Plan solicitado: <span className="text-[#00e5a0] font-semibold">⚡ {r.requestedPlan}</span>
                          </div>
                          {r.notes && (
                            <div className="mt-2 text-xs text-slate-400 bg-[#101c35] rounded-lg px-3 py-2">💬 {r.notes}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-xs text-slate-500">{r.createdAt?.seconds ? ts(r.createdAt.seconds) : '—'}</div>
                          <button onClick={() => deleteUpgrade(r)}
                            className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                            🗑 Eliminar
                          </button>
                        </div>
                      </div>

                      {r.imageUrl && (
                        <div className="mb-4">
                          <div className="text-xs font-semibold text-slate-400 mb-2">Comprobante de pago:</div>
                          <a href={r.imageUrl} target="_blank" rel="noopener noreferrer">
                            <img src={r.imageUrl} alt="Comprobante"
                              className="max-h-48 rounded-xl border border-white/10 object-contain cursor-pointer hover:opacity-90 transition-opacity" />
                          </a>
                          <div className="text-xs text-[#00c4e8] mt-1">Clic para ver en tamaño completo</div>
                        </div>
                      )}

                      {r.status === 'pending' && (
                        <div className="flex gap-3">
                          <button onClick={() => approveUpgrade(r)}
                            className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-[#00e5a0]/10 border border-[#00e5a0]/30 text-[#00e5a0] hover:bg-[#00e5a0]/20 transition-all">
                            ✓ Aprobar — Activar Plan Pro (30 días)
                          </button>
                          <button onClick={() => rejectUpgrade(r)}
                            className="px-6 py-2.5 rounded-xl font-bold text-sm bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all">
                            ✕ Rechazar
                          </button>
                        </div>
                      )}
                      {r.status === 'approved' && (
                        <div className="text-xs text-[#00e5a0] bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded-lg px-3 py-2">
                          ✓ Aprobado por {r.approvedBy}
                        </div>
                      )}
                      {r.status === 'rejected' && (
                        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                          ✕ Rechazado por {r.rejectedBy}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════ SUGERENCIAS ══════════ */}
          {tab === 'Sugerencias' && (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {['todos','nuevo','leido','resuelto','bug','mejora','sugerencia','consulta'].map(f => (
                  <button key={f} onClick={() => setSugFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      sugFilter === f ? 'bg-[#8b5cf6]/20 border-[#8b5cf6]/30 text-[#a78bfa]' : 'bg-[#101c35] border-white/10 text-slate-400 hover:border-white/25'
                    }`}>
                    {f}
                    {f === 'nuevo' && newSuggestions > 0 && (
                      <span className="ml-1 bg-red-500 text-white text-xs px-1 rounded-full">{newSuggestions}</span>
                    )}
                  </button>
                ))}
                <span className="text-xs text-slate-500 ml-auto self-center">{filteredSuggestions.length} resultados</span>
              </div>

              {filteredSuggestions.length === 0 ? (
                <div className="bg-[#0c1424] border border-white/10 rounded-xl p-12 text-center text-slate-500">Sin sugerencias</div>
              ) : (
                <div className="space-y-3">
                  {filteredSuggestions.map(s => (
                    <div key={s.id} className={`bg-[#0c1424] border rounded-xl p-5 ${s.status === 'nuevo' ? 'border-[#f59e0b]/20' : 'border-white/10'}`}>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${TYPE_COLORS[s.type] || 'text-slate-400 bg-slate-500/10 border-slate-500/20'}`}>{s.type}</span>
                          <span className={`badge ${STATUS_BADGE[s.status] || 'badge-gray'}`}>{s.status}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <div className="text-xs font-semibold text-slate-300">{s.bizName}</div>
                            <div className="text-xs text-slate-500">{s.userName} · {s.date} {s.time}</div>
                          </div>
                          <button onClick={() => deleteSuggestion(s)}
                            className="text-xs px-2 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                            🗑
                          </button>
                        </div>
                      </div>
                      <div className="font-semibold text-slate-100 mb-1">{s.subject}</div>
                      <div className="text-sm text-slate-400 mb-4 leading-relaxed">{s.message}</div>
                      <ResponseForm sug={s} onRespond={respondToSuggestion} />
                      <div className="flex gap-2 flex-wrap mt-3">
                        {s.status !== 'leido' && (
                          <button onClick={() => markSuggestion(s, 'leido')}
                            className="text-xs px-3 py-1.5 rounded-lg bg-[#00c4e8]/10 border border-[#00c4e8]/20 text-[#00c4e8] hover:bg-[#00c4e8]/20 transition-all">
                            Marcar leido
                          </button>
                        )}
                        {s.status !== 'resuelto' && (
                          <button onClick={() => markSuggestion(s, 'resuelto')}
                            className="text-xs px-3 py-1.5 rounded-lg bg-[#00e5a0]/10 border border-[#00e5a0]/20 text-[#00e5a0] hover:bg-[#00e5a0]/20 transition-all">
                            Marcar resuelto
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════ DIRECTORIO ══════════ */}
          {tab === 'Directorio' && (
            <div className="space-y-4">
              <div className="text-sm text-slate-400">{directory.length} proveedores en el directorio global</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {directory.map(d => (
                  <div key={d.id} className="bg-[#0c1424] border border-white/10 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-100">{d.name || d.businessName || '—'}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {d.category && <span>{d.category}</span>}
                          {d.category && d.location && <span> · </span>}
                          {d.location && <span>{d.location}</span>}
                        </div>
                        {d.phone && <div className="text-xs text-[#00c4e8] mt-1">📞 {d.phone}</div>}
                        {d.email && <div className="text-xs text-slate-400 mt-0.5">✉ {d.email}</div>}
                        {d.description && <div className="text-xs text-slate-500 mt-1">{d.description}</div>}
                        {d.products && <div className="text-xs text-slate-400 mt-1">🛍 {d.products}</div>}
                        {d.businessId && <div className="text-xs text-slate-600 mt-1 font-mono">Biz: {d.businessId.slice(0,12)}...</div>}
                      </div>
                      <button onClick={() => deleteDirectory(d)}
                        className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all shrink-0">
                        🗑 Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {directory.length === 0 && (
                  <div className="col-span-2 text-center text-slate-500 py-10">Sin proveedores en el directorio</div>
                )}
              </div>
            </div>
          )}

          {/* ══════════ ANUNCIOS ══════════ */}
          {tab === 'Anuncios' && (
            <div className="space-y-5">
              {/* Formulario crear / editar */}
              <div className="bg-[#0c1424] border border-[#8b5cf6]/20 rounded-xl p-5 space-y-4">
                <div className="font-bold text-slate-100">
                  {editingAnn ? '✏️ Editar anuncio' : 'Enviar anuncio a todos los negocios'}
                </div>
                <div className="alert-info text-xs">Los anuncios aparecen en el dashboard de todas las tiendas activas.</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Titulo *</label>
                    <input className="input"
                      placeholder="Ej: Nueva funcion disponible"
                      value={editingAnn ? editingAnn.title : announcement.title}
                      onChange={e => editingAnn
                        ? setEditingAnn(a => ({ ...a, title: e.target.value }))
                        : setAnnouncement(a => ({ ...a, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Tipo</label>
                    <select className="select"
                      value={editingAnn ? editingAnn.type : announcement.type}
                      onChange={e => editingAnn
                        ? setEditingAnn(a => ({ ...a, type: e.target.value }))
                        : setAnnouncement(a => ({ ...a, type: e.target.value }))}>
                      <option value="info">Informacion</option>
                      <option value="success">Buenas noticias</option>
                      <option value="warning">Advertencia</option>
                      <option value="update">Actualizacion</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Mensaje *</label>
                  <textarea className="input resize-none" rows={3}
                    placeholder="Escribe el mensaje que veran todos los usuarios..."
                    value={editingAnn ? editingAnn.message : announcement.message}
                    onChange={e => editingAnn
                      ? setEditingAnn(a => ({ ...a, message: e.target.value }))
                      : setAnnouncement(a => ({ ...a, message: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  {editingAnn ? (
                    <>
                      <button onClick={saveEditAnnouncement} className="btn-primary">Guardar cambios</button>
                      <button onClick={() => setEditingAnn(null)} className="btn-secondary">Cancelar</button>
                    </>
                  ) : (
                    <button onClick={sendAnnouncement} disabled={sending} className="btn-primary">
                      {sending ? 'Enviando...' : 'Enviar a todos los negocios'}
                    </button>
                  )}
                </div>
              </div>

              {/* Lista de anuncios */}
              <div>
                <div className="font-bold text-slate-100 mb-3">Anuncios enviados ({announcements.length})</div>
                {announcements.length === 0 ? (
                  <div className="bg-[#0c1424] border border-white/10 rounded-xl p-8 text-center text-slate-500">No hay anuncios enviados aun</div>
                ) : (
                  <div className="space-y-3">
                    {announcements.map(a => {
                      const TYPE_ICON = { info: '💡', success: '✅', warning: '⚠', update: '🚀' }
                      return (
                        <div key={a.id} className={`bg-[#0c1424] border rounded-xl p-4 ${!a.active ? 'opacity-50' : 'border-white/10'}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">{TYPE_ICON[a.type] || '📢'}</span>
                              <div>
                                <div className="font-semibold text-slate-100">{a.title}</div>
                                <div className="text-xs text-slate-500">{a.sentBy} · {ts(a.createdAt?.seconds)}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`badge ${a.active ? 'badge-green' : 'badge-gray'}`}>{a.active ? 'Activo' : 'Inactivo'}</span>
                              <button onClick={() => setEditingAnn({ ...a })}
                                className="text-xs px-2.5 py-1 rounded-lg border border-[#00c4e8]/20 text-[#00c4e8] hover:bg-[#00c4e8]/10 transition-all">
                                ✏️ Editar
                              </button>
                              {a.active && (
                                <button onClick={() => deactivateAnnouncement(a)}
                                  className="text-xs px-2.5 py-1 rounded-lg border border-[#f59e0b]/20 text-[#f59e0b] hover:bg-[#f59e0b]/10 transition-all">
                                  Desactivar
                                </button>
                              )}
                              <button onClick={() => deleteAnnouncement(a)}
                                className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                                🗑 Eliminar
                              </button>
                            </div>
                          </div>
                          <div className="text-sm text-slate-400 mt-2">{a.message}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </>)}
      </div>

      {/* ── Modal mensaje privado ── */}
      {msgModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#0c1424] border border-[#00c4e8]/20 rounded-2xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-100">✉ Mensaje a {msgModal.name}</div>
              <button onClick={() => setMsgModal(null)} className="text-slate-500 hover:text-slate-300">✕</button>
            </div>
            <div className="alert-info text-xs">
              El mensaje llegará al buzón de Sugerencias del negocio como mensaje del equipo VapePOS.
            </div>
            <div>
              <label className="label">Mensaje *</label>
              <textarea className="input resize-none w-full" rows={4}
                placeholder="Escribe tu mensaje al dueño del negocio..."
                value={msgText} onChange={e => setMsgText(e.target.value)} />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setMsgModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={sendingMsg || !msgText.trim()} onClick={sendPrivateMessage}>
                {sendingMsg ? 'Enviando...' : 'Enviar Mensaje'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResponseForm({ sug, onRespond }) {
  const [text, setText]     = useState(sug.response || '')
  const [open, setOpen]     = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSend = async () => {
    if (!text.trim()) return toast.error('Escribe una respuesta')
    setSaving(true)
    await onRespond(sug, text.trim())
    setSaving(false)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      {sug.response && (
        <div className="bg-[#00e5a0]/5 border border-[#00e5a0]/20 rounded-xl p-3">
          <div className="text-xs text-[#00e5a0] font-bold mb-1">Tu respuesta enviada</div>
          <div className="text-sm text-slate-300">{sug.response}</div>
          {sug.rating && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/10">
              <span className="text-xs text-slate-500">Calificacion:</span>
              <div className="flex gap-0.5">
                {[1,2,3,4,5].map(s => (
                  <span key={s} className={`text-sm ${s <= sug.rating ? 'text-[#f59e0b]' : 'text-slate-600'}`}>★</span>
                ))}
              </div>
              {sug.ratingComment && <span className="text-xs text-slate-400 italic">"{sug.ratingComment}"</span>}
            </div>
          )}
        </div>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-[#a78bfa] hover:bg-[#8b5cf6]/20 transition-all">
          {sug.response ? 'Editar respuesta' : 'Responder al usuario'}
        </button>
      ) : (
        <div className="bg-[#101c35] rounded-xl p-4 space-y-3">
          <div className="text-xs font-bold text-slate-400">Tu respuesta</div>
          <textarea className="input resize-none w-full" rows={3}
            placeholder="Escribe tu respuesta al usuario..."
            value={text} onChange={e => setText(e.target.value)} />
          <div className="flex gap-2">
            <button onClick={handleSend} disabled={saving} className="btn-primary text-xs py-1.5 flex-1">
              {saving ? 'Enviando...' : 'Enviar respuesta'}
            </button>
            <button onClick={() => setOpen(false)} className="btn-secondary text-xs py-1.5">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
