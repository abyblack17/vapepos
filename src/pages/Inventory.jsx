import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import Modal from '../components/ui/Modal'
import ProGate from '../components/ui/ProGate'
import UpgradeModal from '../components/ui/UpgradeModal'
import { fmt, genId, categoryBadge } from '../utils/helpers'
import { bizAdd, bizSet, bizUpdate, bizDelete } from '../services/firestoreService'
import { uploadProductImage } from '../services/storageService'
import { exportInventory } from '../services/exportService'
import { usePlan } from '../hooks/usePlan'
import toast from 'react-hot-toast'

export default function Inventory() {
  const { state, dispatch }   = useApp()
  const { businessId }        = useAuth()
  const { canAdd, hasFeature, usage, upgradeMessage } = usePlan()
  const [search, setSearch]   = useState('')
  const [catFilter, setCatFilter] = useState('Todos')
  const [modal, setModal]     = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  // Separar productos activos de los bloqueados por plan
  const allActive      = state.products.filter(p => p.active)
  const products       = allActive.filter(p => !p.planLocked)
  const lockedProducts = allActive.filter(p => p.planLocked)

  const categories  = ['Todos', ...new Set(products.map(p => p.category))]
  const filtered    = products.filter(p => {
    const ms = p.name.toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase())
    const mc = catFilter === 'Todos' || p.category === catFilter
    return ms && mc
  })

  const lowStockCount = products.filter(p => p.stock <= p.minStock).length
  const productUsage  = usage('products')
  const canAddProduct = canAdd('products')
  const canExport     = hasFeature('exportInventory')

  const handleSave = async (data, isEdit) => {
    if (!isEdit && !canAddProduct) {
      setShowUpgrade(true)
      return
    }
    if (isEdit) {
      const fields = { ...data, price: parseFloat(data.price), cost: parseFloat(data.cost), stock: parseInt(data.stock), minStock: parseInt(data.minStock), active: true }
      dispatch({ type: 'UPDATE_PRODUCT', payload: { id: data.id, ...fields } })
      if (businessId) {
        const ok = await bizUpdate(businessId, 'products', data.id, fields)
        if (!ok) await bizSet(businessId, 'products', data.id, fields)
      }
      toast.success('Producto actualizado')
    } else {
      const productData = { ...data, price: parseFloat(data.price), cost: parseFloat(data.cost), stock: parseInt(data.stock), minStock: parseInt(data.minStock), active: true }
      if (businessId) {
        const saved = await bizAdd(businessId, 'products', productData)
        if (saved?.id) {
          dispatch({ type: 'ADD_PRODUCT', payload: { ...productData, id: saved.id } })
          toast.success(`"${data.name}" agregado al inventario`)
          setModal(null)
          return
        }
      }
      dispatch({ type: 'ADD_PRODUCT', payload: { ...productData, id: genId('p') } })
      toast.success(`"${data.name}" agregado al inventario`)
    }
    setModal(null)
  }

  const handleDelete = async (product) => {
    dispatch({ type: 'DELETE_PRODUCT', payload: product.id })
    if (businessId) await bizDelete(businessId, 'products', product.id)
    toast.success(`"${product.name}" eliminado del inventario`)
    setModal(null)
  }

  const handleNewProduct = () => {
    if (!canAddProduct) { setShowUpgrade(true); return }
    setModal({ type: 'new' })
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Banner límite cercano */}
      {productUsage.nearLimit && !productUsage.atLimit && (
        <div className="alert-warning text-xs">
          ⚠ Tienes {productUsage.current} de {productUsage.limit} productos. Estás cerca del límite del plan Básico.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro</button>
        </div>
      )}

      {/* Banner límite alcanzado */}
      {productUsage.atLimit && (
        <div className="alert-danger text-xs">
          🔒 Has alcanzado el límite de {productUsage.limit} productos del plan Básico.
          <button onClick={() => setShowUpgrade(true)} className="ml-2 underline font-semibold">Actualizar a Pro</button>
        </div>
      )}

      {/* Summary pills */}
      <div className="flex gap-3 flex-wrap">
        <div className="card px-4 py-2.5 flex items-center gap-2">
          <span className="text-[#00e5a0] font-bold font-mono text-lg">{products.length}</span>
          <span className="text-xs text-slate-400">
            productos activos
            {!productUsage.isUnlimited && <span className="ml-1 text-slate-500">/ {productUsage.limit}</span>}
          </span>
        </div>
        {lowStockCount > 0 && (
          <div className="card px-4 py-2.5 flex items-center gap-2 border-amber-400/20">
            <span className="text-amber-400 font-bold font-mono text-lg">{lowStockCount}</span>
            <span className="text-xs text-slate-400">con stock bajo</span>
          </div>
        )}
        <div className="card px-4 py-2.5 flex items-center gap-2">
          <span className="text-[#00c4e8] font-bold font-mono text-sm">{fmt(products.reduce((a, p) => a + p.cost * p.stock, 0))}</span>
          <span className="text-xs text-slate-400">valor en inventario</span>
        </div>
        {lockedProducts.length > 0 && (
          <div className="card px-4 py-2.5 flex items-center gap-2 border-[#f59e0b]/20 cursor-pointer" onClick={() => setShowUpgrade(true)}>
            <span className="text-[#f59e0b] font-bold font-mono">🔒 {lockedProducts.length}</span>
            <span className="text-xs text-slate-400">bloqueados por plan</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 flex items-center gap-2 bg-[#101c35] border border-white/10 rounded-lg px-3 py-2.5 min-w-[200px]">
          <span className="text-slate-500">🔍</span>
          <input className="flex-1 bg-transparent outline-none text-sm text-slate-200 placeholder-slate-500"
            placeholder="Buscar por nombre o SKU..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {categories.map(cat => (
            <button key={cat} onClick={() => setCatFilter(cat)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                catFilter === cat ? 'bg-[#00e5a0]/10 border-[#00e5a0]/30 text-[#00e5a0]' : 'bg-[#101c35] border-white/10 text-slate-400 hover:border-white/25'
              }`}>{cat}</button>
          ))}
        </div>
        <div className="flex gap-2">
          {canExport ? (
            <>
              <button onClick={() => exportInventory(state.products, 'excel', state.settings?.businessName)} className="btn-secondary text-xs">📊 Excel</button>
              <button onClick={() => exportInventory(state.products, 'pdf', state.settings?.businessName)} className="btn-secondary text-xs">📄 PDF</button>
            </>
          ) : (
            <>
              <ProGate feature="exportInventory" mode="button" label="Excel" />
              <ProGate feature="exportInventory" mode="button" label="PDF" />
            </>
          )}
          <button onClick={handleNewProduct} className="btn-primary whitespace-nowrap">+ Nuevo Producto</button>
        </div>
      </div>

      {/* Table */}
      <div className="table-container overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              {['Producto', 'Categoria', 'Costo', 'Precio', 'Margen', 'Stock', 'Min.', 'Estado', 'Acciones'].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const marginPct = p.price ? Math.round(((p.price - p.cost) / p.price) * 100) : 0
              const isLow     = p.stock <= p.minStock
              return (
                <tr key={p.id} className="table-row">
                  <td className="table-cell">
                    <div className="font-semibold text-slate-200">{p.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{p.sku}</div>
                  </td>
                  <td className="table-cell"><span className={`badge ${categoryBadge(p.category)}`}>{p.category}</span></td>
                  <td className="table-cell font-mono text-slate-400">{fmt(p.cost)}</td>
                  <td className="table-cell font-mono font-bold text-[#00e5a0]">{fmt(p.price)}</td>
                  <td className="table-cell">
                    <span className={`font-mono text-sm font-semibold ${marginPct >= 30 ? 'text-[#00e5a0]' : marginPct >= 15 ? 'text-amber-400' : 'text-red-400'}`}>
                      {marginPct}%
                    </span>
                  </td>
                  <td className="table-cell">
                    <span className={`font-mono font-bold ${isLow ? 'text-red-400' : 'text-[#00e5a0]'}`}>
                      {p.stock} {isLow && '⚠'}
                    </span>
                  </td>
                  <td className="table-cell font-mono text-slate-500">{p.minStock}</td>
                  <td className="table-cell"><span className="badge badge-green">Activo</span></td>
                  <td className="table-cell">
                    <div className="flex gap-1">
                      <button onClick={() => setModal({ type: 'edit', data: p })}
                        className="text-xs px-2.5 py-1 rounded-lg border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">
                        Editar
                      </button>
                      <button onClick={() => setModal({ type: 'delete', data: p })}
                        className="text-xs px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="table-cell text-center text-slate-500 py-10">No se encontraron productos</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Productos bloqueados por plan */}
      {lockedProducts.length > 0 && (
        <div className="card p-4 border-[#f59e0b]/20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[#f59e0b]">🔒</span>
              <span className="text-sm font-semibold text-[#f59e0b]">
                {lockedProducts.length} productos bloqueados — Plan Básico
              </span>
            </div>
            <button onClick={() => setShowUpgrade(true)} className="text-xs text-[#00e5a0] hover:underline">
              Actualizar a Pro →
            </button>
          </div>
          <div className="space-y-2">
            {lockedProducts.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#f59e0b]/5 border border-[#f59e0b]/10 opacity-60">
                <span className="text-[#f59e0b] text-sm">🔒</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-400 truncate">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.category} · {fmt(p.price)}</div>
                </div>
                <span className="text-xs text-[#f59e0b] whitespace-nowrap">No disponible</span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Para volver a usar todos tus productos, actualiza al plan Pro.
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {modal?.type === 'delete' && (
        <Modal title="Eliminar Producto" onClose={() => setModal(null)} size="sm">
          <div className="bg-red-400/10 border border-red-400/20 text-red-300 text-sm rounded-lg p-3 mb-4">
            Eliminar <strong>{modal.data.name}</strong>? Esta accion no se puede deshacer.
          </div>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn-danger" onClick={() => handleDelete(modal.data)}>Eliminar</button>
          </div>
        </Modal>
      )}

      {modal && modal.type !== 'delete' && (
        <ProductModal
          data={modal.type === 'edit' ? modal.data : null}
          suppliers={state.suppliers}
          onClose={() => setModal(null)}
          onSave={(d) => handleSave(d, modal.type === 'edit')}
        />
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}

function ProductModal({ data, suppliers, onClose, onSave }) {
  const { businessId } = useAuth()
  const [form, setForm] = useState({
    id:          data?.id          || '',
    name:        data?.name        || '',
    category:    data?.category    || 'Desechables',
    brand:       data?.brand       || '',
    sku:         data?.sku         || '',
    barcode:     data?.barcode     || '',
    cost:        data?.cost        || '',
    price:       data?.price       || '',
    stock:       data?.stock       || '',
    minStock:    data?.minStock    || '5',
    supplier:    data?.supplier    || '',
    description: data?.description || '',
    imageUrl:    data?.imageUrl    || '',
    color:       data?.color       || '',
  })
  const [uploading, setUploading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('La imagen no puede superar 2MB'); return }
    setUploading(true)
    const tempId = form.id || `temp_${Date.now()}`
    const url = await uploadProductImage(businessId, tempId, file)
    if (url) { set('imageUrl', url); toast.success('Imagen subida') }
    else toast.error('Error al subir imagen')
    setUploading(false)
  }

  return (
    <Modal title={data ? `Editar: ${data.name}` : 'Nuevo Producto'} onClose={onClose}>
      <div className="space-y-3">
        <div className="form-row">
          <div><label className="label">Nombre *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
          <div>
            <label className="label">Categoria</label>
            <select className="select" value={form.category} onChange={e => set('category', e.target.value)}>
              {['Desechables','Dispositivos','Repuestos','Accesorios','Pods','Atomizadores','Otros'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div><label className="label">Marca</label><input className="input" value={form.brand} onChange={e => set('brand', e.target.value)} /></div>
          <div><label className="label">SKU</label><input className="input" value={form.sku} onChange={e => set('sku', e.target.value)} /></div>
        </div>
        <div><label className="label">Codigo de barras</label>
          <input className="input font-mono" value={form.barcode} onChange={e => set('barcode', e.target.value)} placeholder="Ej: 7501234567890" />
        </div>
        <div className="form-row">
          <div><label className="label">Costo (RD$) *</label><input className="input" type="number" value={form.cost} onChange={e => set('cost', e.target.value)} /></div>
          <div><label className="label">Precio Venta (RD$) *</label><input className="input" type="number" value={form.price} onChange={e => set('price', e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div><label className="label">Stock Actual</label><input className="input" type="number" value={form.stock} onChange={e => set('stock', e.target.value)} /></div>
          <div><label className="label">Stock Minimo</label><input className="input" type="number" value={form.minStock} onChange={e => set('minStock', e.target.value)} /></div>
        </div>
        <div>
          <label className="label">Proveedor</label>
          <select className="select" value={form.supplier} onChange={e => set('supplier', e.target.value)}>
            <option value="">Sin proveedor</option>
            {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="label">Descripcion</label><textarea className="input resize-none" rows={2} value={form.description} onChange={e => set('description', e.target.value)} /></div>
        <div>
          <label className="label">Imagen del producto</label>
          <div className="flex items-center gap-3">
            {form.imageUrl
              ? <img src={form.imageUrl} alt="producto" className="w-16 h-16 object-cover rounded-lg border border-white/10" />
              : <div className="w-16 h-16 rounded-lg border border-white/10 flex items-center justify-center text-slate-500 text-xs text-center"
                  style={{ background: form.color || '#101c35' }}>
                  {form.color ? '' : 'Sin img'}
                </div>
            }
            <div className="flex-1 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer btn-secondary text-xs py-1.5 justify-center">
                <span>{uploading ? 'Subiendo...' : 'Subir imagen'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400">O elegir color:</label>
                <input type="color" value={form.color || '#1a2848'} onChange={e => { set('color', e.target.value); set('imageUrl', '') }}
                  className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => {
            if (!form.name || !form.cost || !form.price) return toast.error('Nombre, costo y precio son requeridos')
            onSave(form)
          }}>
            {data ? 'Guardar' : 'Crear Producto'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
