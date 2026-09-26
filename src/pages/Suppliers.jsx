import React, { useState, useEffect } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import ExcelDataActions from '../components/common/ExcelDataActions'
import { genId } from '../utils/helpers'
import {
  globalGetAll, globalAdd, globalSet, globalDelete,
  bizSet, bizDelete, orderBy, where,
} from '../services/firestoreService'
import toast from 'react-hot-toast'

const DIRECTORY_COL = 'providers_directory'

export default function Suppliers() {
  const { state, dispatch } = useApp()
  const { businessId, currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'Administrador'

  const [tab, setTab]               = useState('directorio')
  const [directory, setDirectory]   = useState([])
  const [loadingDir, setLoadingDir] = useState(true)
  const [search, setSearch]         = useState('')
  const [modal, setModal]           = useState(null)

  // Mi perfil de proveedor en el directorio (si tengo uno)
  const myProfile = directory.find(p => p.businessId === businessId) || null

  // Cargar directorio global al montar
  useEffect(() => {
    loadDirectory()
  }, [])

  const loadDirectory = async () => {
    setLoadingDir(true)
    const data = await globalGetAll(DIRECTORY_COL, [orderBy('createdAt', 'desc')])
    setDirectory(data)
    setLoadingDir(false)
  }

  // Verificar si un proveedor ya está en mi lista local
  const isInMyList = (providerId) => {
    return state.suppliers.some(s => s.directoryId === providerId)
  }

  // Filtrar directorio por búsqueda
  const filtered = directory.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      p.businessName?.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.location?.toLowerCase().includes(q) ||
      p.tags?.some(t => t.toLowerCase().includes(q))
    )
  })

  // ── Guardar perfil de proveedor en directorio global ────────
  const handleSaveProfile = async (data) => {
    if (!businessId) return
    try {
      if (myProfile) {
        // Actualizar perfil existente
        await globalSet(DIRECTORY_COL, myProfile.id, {
          ...data,
          businessId,
          businessName: data.businessName,
          updatedAt:    new Date(),
        })
        toast.success('Perfil de proveedor actualizado')
      } else {
        // Crear nuevo perfil
        const saved = await globalAdd(DIRECTORY_COL, {
          ...data,
          businessId,
          active: true,
        })
        if (!saved) throw new Error('Error al guardar')
        toast.success('Registrado en el directorio de proveedores')
      }
      await loadDirectory()
      setModal(null)
    } catch (err) {
      toast.error('Error al guardar: ' + err.message)
    }
  }

  // ── Eliminar perfil del directorio ──────────────────────────
  const handleDeleteProfile = async () => {
    if (!myProfile) return
    await globalDelete(DIRECTORY_COL, myProfile.id)
    toast.success('Perfil eliminado del directorio')
    await loadDirectory()
    setModal(null)
  }

  // ── Añadir proveedor del directorio a mi lista local ────────
  const handleAddToMyList = async (provider) => {
    const id = genId('sup')
    const supplierData = {
      id,
      directoryId:  provider.id,
      name:         provider.businessName,
      phone:        provider.whatsapp,
      email:        '',
      address:      provider.location || '',
      products:     provider.tags?.join(', ') || '',
      notes:        provider.description || '',
      fromDirectory: true,
      createdAt:    new Date(),
    }
    dispatch({ type: 'ADD_SUPPLIER', payload: supplierData })
    if (businessId) {
      const { id: sid, ...rest } = supplierData
      await bizSet(businessId, 'suppliers', sid, rest)
    }
    toast.success(`"${provider.businessName}" agregado a tu lista`)
  }

  // ── Quitar proveedor de mi lista local ──────────────────────
  const handleRemoveFromList = async (provider) => {
    const local = state.suppliers.find(s => s.directoryId === provider.id)
    if (!local) return
    dispatch({ type: 'DELETE_SUPPLIER', payload: local.id })
    if (businessId) await bizDelete(businessId, 'suppliers', local.id)
    toast.success(`"${provider.businessName}" quitado de tu lista`)
  }

  // ── Handlers para proveedores locales (sin directorio) ──────
  const handleSaveLocal = async (data, isEdit) => {
    if (isEdit) {
      dispatch({ type: 'UPDATE_SUPPLIER', payload: data })
      if (businessId) {
        const { id, ...rest } = data
        await bizSet(businessId, 'suppliers', id, rest)
      }
      toast.success('Proveedor actualizado')
    } else {
      const id  = genId('sup')
      const payload = { id, ...data, createdAt: new Date() }
      dispatch({ type: 'ADD_SUPPLIER', payload })
      if (businessId) {
        const { id: sid, ...rest } = payload
        await bizSet(businessId, 'suppliers', sid, rest)
      }
      toast.success(`"${data.name}" registrado`)
    }
    setModal(null)
  }

  const handleDeleteLocal = async (supplier) => {
    dispatch({ type: 'DELETE_SUPPLIER', payload: supplier.id })
    if (businessId) await bizDelete(businessId, 'suppliers', supplier.id)
    toast.success(`"${supplier.name}" eliminado`)
    setModal(null)
  }

  const handleImportSuppliers = async (rows) => {
    let imported = 0
    for (const row of rows) {
      const id = row.id || genId('sup')
      const payload = { ...row, id }
      dispatch({ type: state.suppliers.some(s => s.id === id) ? 'UPDATE_SUPPLIER' : 'ADD_SUPPLIER', payload })
      if (businessId) {
        const { id: supplierId, ...data } = payload
        await bizSet(businessId, 'suppliers', supplierId, data)
      }
      imported += 1
    }
    toast.success(`${imported} proveedor(es) importado(s) desde Excel`)
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Tabs */}
      <div className="flex gap-1 bg-[#101c35] rounded-xl p-1 w-fit">
        {[
          { id: 'directorio', label: 'Directorio de Proveedores' },
          { id: 'milista',    label: 'Mi Lista' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id ? 'bg-[#00e5a0] text-[#080d18]' : 'text-slate-400 hover:text-slate-200'
            }`}>
            {t.label}
            {t.id === 'milista' && state.suppliers.length > 0 && (
              <span className="ml-2 bg-[#00e5a0]/20 text-[#00e5a0] text-xs px-1.5 py-0.5 rounded-full">
                {state.suppliers.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          TAB: DIRECTORIO GLOBAL
      ══════════════════════════════════════════════════════ */}
      {tab === 'directorio' && (
        <div className="space-y-4">

          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2.5">
              <span className="text-slate-500">🔍</span>
              <input className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
                placeholder="Buscar por nombre, producto, etiqueta..."
                value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button onClick={() => setSearch('')} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>}
            </div>
            {isAdmin && (
              <button
                onClick={() => setModal({ type: 'profile' })}
                className={myProfile ? 'btn-secondary' : 'btn-primary'}
              >
                {myProfile ? '✎ Editar mi perfil' : '+ Registrarme como proveedor'}
              </button>
            )}
          </div>

          {/* Mi perfil banner */}
          {myProfile && (
            <div className="bg-[#00e5a0]/5 border border-[#00e5a0]/20 rounded-xl p-4 flex items-center gap-4">
              <div className="text-2xl">🏪</div>
              <div className="flex-1">
                <div className="text-sm font-bold text-[#00e5a0]">Tu negocio aparece en el directorio</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {myProfile.tags?.length} etiquetas · WhatsApp: {myProfile.whatsapp}
                </div>
              </div>
              <button onClick={() => setModal({ type: 'deleteProfile' })}
                className="text-xs text-red-400 hover:underline">Eliminar perfil</button>
            </div>
          )}

          {/* Stats */}
          <div className="text-xs text-slate-500">
            {loadingDir ? 'Cargando directorio...' : `${filtered.length} proveedores encontrados`}
            {search && ` para "${search}"`}
          </div>

          {/* Directory grid */}
          {loadingDir ? (
            <div className="text-center py-12 text-slate-500">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-4xl mb-3">🔍</div>
              <div className="text-slate-400">{search ? `Sin resultados para "${search}"` : 'El directorio esta vacio'}</div>
              {isAdmin && !myProfile && (
                <button onClick={() => setModal({ type: 'profile' })} className="btn-primary mt-4 text-sm">
                  Ser el primero en registrarse
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              {filtered.map(provider => {
                const inList   = isInMyList(provider.id)
                const isOwner  = provider.businessId === businessId
                return (
                  <div key={provider.id} className={`card p-5 space-y-3 ${isOwner ? 'border-[#00e5a0]/20' : ''}`}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-[#8b5cf6]/15 border border-[#8b5cf6]/20 flex items-center justify-center font-bold text-[#a78bfa] text-lg flex-shrink-0">
                          {provider.businessName?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="font-bold text-slate-100 text-sm">{provider.businessName}</div>
                          {provider.location && (
                            <div className="text-xs text-slate-500">📍 {provider.location}</div>
                          )}
                        </div>
                      </div>
                      {isOwner && (
                        <span className="badge badge-green text-xs shrink-0">Tu tienda</span>
                      )}
                      {inList && !isOwner && (
                        <span className="badge badge-blue text-xs shrink-0">En tu lista</span>
                      )}
                    </div>

                    {/* Description */}
                    {provider.description && (
                      <p className="text-xs text-slate-400 leading-relaxed">{provider.description}</p>
                    )}

                    {/* Tags */}
                    {provider.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {provider.tags.map((tag, i) => (
                          <button key={i}
                            onClick={() => setSearch(tag)}
                            className="text-xs px-2 py-0.5 rounded-full bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 text-[#a78bfa] hover:bg-[#8b5cf6]/20 transition-all">
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    {!isOwner && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => window.open(`https://wa.me/${provider.whatsapp.replace(/\D/g,'')}?text=${encodeURIComponent(`Hola! Te vi en el directorio de VapePOS. Me gustaria saber mas sobre tus productos.`)}`)}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-600/15 border border-green-500/30 text-green-400 hover:bg-green-600/25 transition-all"
                        >
                          WhatsApp
                        </button>
                        {inList ? (
                          <button
                            onClick={() => handleRemoveFromList(provider)}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all"
                          >
                            Quitar de lista
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAddToMyList(provider)}
                            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-[#00c4e8]/10 border border-[#00c4e8]/20 text-[#00c4e8] hover:bg-[#00c4e8]/20 transition-all"
                          >
                            + Añadir a lista
                          </button>
                        )}
                      </div>
                    )}

                    {isOwner && isAdmin && (
                      <button
                        onClick={() => setModal({ type: 'profile' })}
                        className="w-full py-2 rounded-lg text-xs font-semibold btn-secondary"
                      >
                        Editar mi perfil
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB: MI LISTA LOCAL
      ══════════════════════════════════════════════════════ */}
      {tab === 'milista' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <div className="text-sm text-slate-400">{state.suppliers.length} proveedores en tu lista</div>
            <ExcelDataActions entity="suppliers" rows={state.suppliers} onImport={handleImportSuppliers} />
          </div>
          <div className="flex justify-between items-center">
            <div className="text-sm text-slate-400">{state.suppliers.length} proveedores en tu lista</div>
            <button onClick={() => setModal({ type: 'new' })} className="btn-primary">+ Agregar proveedor</button>
          </div>

          {state.suppliers.length === 0 ? (
            <div className="card p-12 text-center">
              <div className="text-4xl mb-3">📋</div>
              <div className="text-slate-400">Tu lista esta vacia</div>
              <div className="text-xs text-slate-500 mt-1">Agrega proveedores desde el directorio o manualmente</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
              {state.suppliers.map(s => (
                <div key={s.id} className="card p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#8b5cf6]/10 border border-[#8b5cf6]/20 flex items-center justify-center font-bold text-[#a78bfa] text-sm">
                      {(s.name || '?')[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-200">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.phone}</div>
                    </div>
                    {s.fromDirectory && (
                      <span className="ml-auto badge badge-purple text-xs">Directorio</span>
                    )}
                  </div>
                  {s.email && <div className="text-xs text-[#00c4e8]">{s.email}</div>}
                  {s.address && <div className="text-xs text-slate-400">📍 {s.address}</div>}
                  {s.products && (
                    <div className="text-xs text-slate-400">
                      <span className="text-slate-500">Productos: </span>{s.products}
                    </div>
                  )}
                  {s.notes && <div className="bg-[#101c35] rounded-lg p-2.5 text-xs text-slate-400">{s.notes}</div>}

                  <div className="flex gap-2">
                    {s.phone && (
                      <button
                        onClick={() => window.open(`https://wa.me/${s.phone.replace(/\D/g,'')}?text=${encodeURIComponent('Hola! Te contacto desde VapePOS.')}`)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-green-600/15 border border-green-500/30 text-green-400 hover:bg-green-600/25 transition-all"
                      >
                        WhatsApp
                      </button>
                    )}
                    {!s.fromDirectory && (
                      <button onClick={() => setModal({ type: 'edit', data: s })}
                        className="btn-secondary text-xs px-3">Editar</button>
                    )}
                    <button onClick={() => setModal({ type: 'deleteLocal', data: s })}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/15 transition-all">
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════ */}

      {/* Perfil de proveedor en directorio */}
      {modal?.type === 'profile' && (
        <ProviderProfileModal
          data={myProfile}
          onClose={() => setModal(null)}
          onSave={handleSaveProfile}
        />
      )}

      {/* Confirmar eliminar perfil del directorio */}
      {modal?.type === 'deleteProfile' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setModal(null)}>
          <div className="bg-[#0c1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="font-display font-bold text-slate-100 mb-3">Eliminar del directorio</div>
            <div className="bg-red-400/10 border border-red-400/20 text-red-300 text-sm rounded-lg p-3 mb-4">
              Tu tienda dejara de aparecer en el directorio de proveedores. Los usuarios que te tengan en su lista no se veran afectados.
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-danger" onClick={handleDeleteProfile}>Eliminar perfil</button>
            </div>
          </div>
        </div>
      )}

      {/* Agregar/editar proveedor local */}
      {(modal?.type === 'new' || modal?.type === 'edit') && (
        <LocalSupplierModal
          data={modal.type === 'edit' ? modal.data : null}
          onClose={() => setModal(null)}
          onSave={(d) => handleSaveLocal(d, modal.type === 'edit')}
        />
      )}

      {/* Confirmar quitar proveedor local */}
      {modal?.type === 'deleteLocal' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setModal(null)}>
          <div className="bg-[#0c1424] border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="font-display font-bold text-slate-100 mb-3">Quitar proveedor</div>
            <div className="bg-red-400/10 border border-red-400/20 text-red-300 text-sm rounded-lg p-3 mb-4">
              Quitar <strong>{modal.data.name}</strong> de tu lista?
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
              <button className="btn-danger" onClick={() => handleDeleteLocal(modal.data)}>Quitar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Modal: Perfil en el directorio global ─────────────────────
function ProviderProfileModal({ data, onClose, onSave }) {
  const { state } = useApp()
  const [form, setForm] = useState({
    businessName: data?.businessName || state.settings?.businessName || '',
    ownerName:    data?.ownerName    || '',
    whatsapp:     data?.whatsapp     || '',
    description:  data?.description  || '',
    location:     data?.location     || '',
    tags:         data?.tags         || [],
  })
  const [tagInput, setTagInput] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const addTag = () => {
    const tag = tagInput.trim()
    if (!tag) return
    if (form.tags.length >= 10) return toast.error('Maximo 10 etiquetas')
    if (form.tags.includes(tag)) return toast.error('Esa etiqueta ya existe')
    set('tags', [...form.tags, tag])
    setTagInput('')
  }

  const removeTag = (tag) => set('tags', form.tags.filter(t => t !== tag))

  return (
    <Modal title={data ? 'Editar perfil de proveedor' : 'Registrarme como proveedor'} onClose={onClose} size="md">
      <div className="space-y-4">

        <div className="alert-info text-xs">
          Tu perfil sera visible para todos los usuarios de VapePOS. Usa tu numero de WhatsApp para que te contacten.
        </div>

        <div className="form-row">
          <div>
            <label className="label">Nombre de tu tienda *</label>
            <input className="input" value={form.businessName} onChange={e => set('businessName', e.target.value)} />
          </div>
          <div>
            <label className="label">Tu nombre</label>
            <input className="input" placeholder="Nombre del contacto" value={form.ownerName} onChange={e => set('ownerName', e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label className="label">WhatsApp * (con codigo de pais)</label>
            <input className="input font-mono" placeholder="18095550000" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />
            <div className="text-xs text-slate-500 mt-1">Ejemplo: 18095550000 (sin +, espacios ni guiones)</div>
          </div>
          <div>
            <label className="label">Ciudad / Zona</label>
            <input className="input" placeholder="Santiago, RD" value={form.location} onChange={e => set('location', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Descripcion</label>
          <textarea className="input resize-none" rows={2}
            placeholder="Describe brevemente que vendes y como operas..."
            value={form.description} onChange={e => set('description', e.target.value)} />
        </div>

        <div>
          <label className="label">Etiquetas de productos ({form.tags.length}/10)</label>
          <div className="flex gap-2 mb-2">
            <input className="input flex-1 text-sm" placeholder="Ej: Desechables, Liquidos, Carbon..."
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() }}}
            />
            <button onClick={addTag} className="btn-secondary text-xs px-3" disabled={form.tags.length >= 10}>
              + Agregar
            </button>
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.tags.map((tag, i) => (
                <span key={i} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[#8b5cf6]/15 border border-[#8b5cf6]/25 text-[#a78bfa]">
                  {tag}
                  <button onClick={() => removeTag(tag)} className="text-[#a78bfa]/60 hover:text-red-400 ml-0.5">✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="text-xs text-slate-500 mt-1">Presiona Enter o el boton para agregar. Los usuarios buscaran por estas etiquetas.</div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => {
            if (!form.businessName) return toast.error('Nombre de tienda requerido')
            if (!form.whatsapp) return toast.error('WhatsApp requerido')
            if (form.tags.length === 0) return toast.error('Agrega al menos una etiqueta')
            onSave(form)
          }}>
            {data ? 'Guardar cambios' : 'Publicar en directorio'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Modal: Proveedor local (sin directorio) ───────────────────
function LocalSupplierModal({ data, onClose, onSave }) {
  const [form, setForm] = useState({
    id:       data?.id       || '',
    name:     data?.name     || '',
    phone:    data?.phone    || '',
    email:    data?.email    || '',
    address:  data?.address  || '',
    products: data?.products || '',
    notes:    data?.notes    || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal title={data ? `Editar: ${data.name}` : 'Nuevo Proveedor'} onClose={onClose} size="sm">
      <div className="space-y-3">
        <div><label className="label">Nombre *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
        <div className="form-row">
          <div><label className="label">Telefono / WhatsApp</label>
            <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><label className="label">Email</label>
            <input className="input" value={form.email} onChange={e => set('email', e.target.value)} /></div>
        </div>
        <div><label className="label">Direccion</label>
          <input className="input" value={form.address} onChange={e => set('address', e.target.value)} /></div>
        <div><label className="label">Productos que suministra</label>
          <input className="input" value={form.products} onChange={e => set('products', e.target.value)} placeholder="Elf Bar, Vaporesso..." /></div>
        <div><label className="label">Notas</label>
          <textarea className="input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => {
            if (!form.name) return toast.error('Nombre requerido')
            onSave(form)
          }}>
            {data ? 'Guardar' : 'Registrar Proveedor'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
