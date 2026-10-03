import React, { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import { useAuth } from '../contexts/AuthContext'
import BottleProgress from '../components/ui/BottleProgress'
import Modal from '../components/ui/Modal'
import UpgradeModal from '../components/ui/UpgradeModal'
import ExcelDataActions from '../components/common/ExcelDataActions'
import { fmt, genId } from '../utils/helpers'
import { findExistingByNameOrCode, hasDuplicateName, makeLiquidCode } from '../utils/recordGuards'
import { bizAdd, bizSet, bizUpdate, bizDelete } from '../services/firestoreService'
import { uploadLiquidImage, deleteImage } from '../services/storageService'
import { getBottlePct, getRendimientoReport, detectLoss, getNicotinaLabel, getRefillButtons, getPointsForType, getRefillProjections, fmtProjection, fmtLiquidMoney } from '../services/liquidService'
import { usePlan } from '../hooks/usePlan'
import toast from 'react-hot-toast'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import { offlineCallable } from '../services/offlineSync'

const ALL_TABS = ['Botellas Activas', 'Inventario', 'Historial', 'Rendimiento']

function getRefillTabs(user) {
  if (!user || user.role === 'Administrador') return ALL_TABS
  const tabPerm = user.permissions?.refillsTabs || (user.role === 'Encargado' ? 'active+hist' : 'active')
  if (tabPerm === 'active')       return ['Botellas Activas']
  if (tabPerm === 'active+hist')  return ['Botellas Activas', 'Inventario', 'Historial']
  return ALL_TABS
}

export default function Refills() {
  const { state, dispatch } = useApp()
  const { businessId }      = useAuth()
  const { hasFeature }      = usePlan()
  const { liquids, sales, currentUser } = state
  const isAdmin  = currentUser?.role === 'Administrador'
  const TABS     = getRefillTabs(currentUser)
  const canViewRendimiento = hasFeature('refillRendimiento')
  const activeLiquids = liquids.filter(l => l.active !== false)
  const liquidInventoryValue = activeLiquids.reduce((a, l) => a + ((parseFloat(l.costPerBottle) || 0) * (parseInt(l.closedBottles) || 0)), 0)
  const liquidSaleValue = activeLiquids.reduce((a, l) => a + ((parseFloat(l.pricePerBottle) || 0) * (parseInt(l.closedBottles) || 0)), 0)

  const [tab, setTab]           = useState('Botellas Activas')
  const [modal, setModal]       = useState(null)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [savingLiquid, setSavingLiquid] = useState(false)

  const refillSales = sales.flatMap(s =>
    (s.refills || []).map(r => ({ ...r, date: s.date, time: s.time, user: s.user, saleId: s.id }))
  )
  const bottleSaleLog = sales.flatMap(s =>
    (s.bottleSales || []).map(b => ({ ...b, date: s.date, time: s.time, user: s.user, saleId: s.id }))
  )

  // ── Abrir frasco para recargas ──
  const handleOpenBottle = async (liquid) => {
    if (liquid.closedBottles < 1) { toast.error('No hay botellas cerradas disponibles'); return }
    if (Number(liquid.openBottleCount || (liquid.hasActive ? 1 : 0)) >= 3) { toast.error('El máximo es 3 frascos abiertos del mismo líquido'); return }
    try {
      const result = await offlineCallable('openLiquidBottle', { liquidId: liquid.id }, { liquid: {
        ...liquid, closedBottles: liquid.closedBottles - 1, hasActive: true,
        activeSaldo: Number(liquid.activeSaldo || 0) + Number(liquid.activeCapacity || 0),
        openBottleCount: Number(liquid.openBottleCount || (liquid.hasActive ? 1 : 0)) + 1,
        activeTotalCapacity: Number(liquid.activeTotalCapacity || 0) + Number(liquid.activeCapacity || 0),
      } })
      dispatch({ type: 'UPDATE_LIQUID', payload: { id: liquid.id, ...result.data.liquid } })
      toast.success(`Frasco abierto. Saldo acumulado: ${result.data.liquid.activeSaldo} ml`)
      setModal(null)
    } catch (error) { toast.error(error.message || 'No se pudo abrir el frasco') }
  }

  // ── Ajuste manual de saldo ──
  const handleAdjustSaldo = async (liquidId, newSaldo, reason) => {
    if (!reason?.trim()) { toast.error('Indica el motivo del ajuste'); return }
    try {
      const result = await offlineCallable('adjustLiquidBalance', { liquidId, newBalance: Number(newSaldo), reason }, { liquid: { activeSaldo: Number(newSaldo), hasActive: Number(newSaldo) > 0 } })
      dispatch({ type: 'UPDATE_LIQUID', payload: { id: liquidId, ...result.data.liquid } })
      toast.success('Saldo ajustado y registrado en la bitácora')
      setModal(null)
    } catch (error) { toast.error(error.message || 'No se pudo ajustar el saldo') }
  }

  // ── Venta de frasco completo ──
  const handleSellBottle = async (liquid, qty, payment) => {
    if (liquid.closedBottles < qty) { toast.error('Sin frascos cerrados disponibles'); return }
    const price   = liquid.pricePerBottle || Math.round(liquid.costPerBottle * 1.6)
    const taxRate = state.settings?.taxRate ?? 18
    const rate    = taxRate / 100
    const lineAmount = price * qty
    const taxIncluded = liquid.taxIncluded === true
    const tax     = taxIncluded
      ? Math.round(lineAmount - (lineAmount / (1 + rate)))
      : Math.round(lineAmount * rate)
    const subtotal = taxIncluded ? lineAmount - tax : lineAmount
    const total = taxIncluded ? lineAmount : lineAmount + tax
    const netUnitPrice = taxIncluded && rate > 0 ? price / (1 + rate) : price
    const sale = {
      id:          `s_${state.currentUser?.id || 'user'}_${Date.now()}_${genId('sale')}`,
      ...(state.branchId ? { branchId: state.branchId } : {}),
      date:        new Date().toISOString().split('T')[0],
      time:        new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      user:        state.currentUser?.name || 'Admin',
      userId:      state.currentUser?.id   || 'u1',
      customerId:  null, customerName: null,
      items: [], refills: [],
      bottleSales: [{ liquidId: liquid.id, liquidName: liquid.name, qty, price, cost: liquid.costPerBottle, taxIncluded }],
      subtotal,
      tax,
      total,
      payment:     payment || 'Efectivo',
      profit:      (netUnitPrice - liquid.costPerBottle) * qty,
      notes:       'Frasco completo',
    }
    try {
      await offlineCallable('commitSale', { sale, cashSessionId: state.cashSession?.id || '' })
      dispatch({ type: 'SELL_CLOSED_BOTTLE', payload: { liquidId: liquid.id, qty }, _skipSync: true })
      dispatch({ type: 'ADD_SALE', payload: sale, _skipSync: true })
      toast.success(`🍶 ${qty} frasco(s) de "${liquid.name}" vendido(s) — ${fmt(sale.total)}`)
      setModal(null)
    } catch (error) { toast.error(error.message || 'No se pudo registrar la venta') }
  }

  const handleNewLiquid = async (data) => {
    if (savingLiquid) return
    const name = data.name?.trim()
    if (!name) { toast.error('Nombre requerido'); return }
    if (hasDuplicateName(liquids, name) && data.bottleState !== 'open') {
      toast.error(`Ya existe un líquido llamado "${name}"`)
      return
    }

    const liquidData = {
      ...(state.branchId ? { branchId: state.branchId } : {}),
      ...data,
      name,
      sku:                    data.sku?.trim() || makeLiquidCode(liquids),
      closedBottles:          parseInt(data.closedBottles)   || 0,
      hasActive:              false,
      activeSaldo:            0,
      totalRechargesAllTime:  0,
      totalRevenueAllTime:    0,
      totalPointsConsumedAllTime: 0,
      totalOpenedBottles: 0,
      totalOpenedCapacity: 0,
      openBottleCount: 0,
      activeTotalCapacity: 0,
      activeSessionIds: [],
      halfBottleStock: 0,
      activeCapacity:         Number(data.activeCapacity)  || 100,
      pointsR50:              Number(data.pointsR50)       || 10,
      pointsR100:             Number(data.pointsR100)      || 20,
      pointsR150:             Number(data.pointsR150)      || 30,
      costPerBottle:          Number(data.costPerBottle)   || 0,
      pricePerBottle:         Number(data.pricePerBottle)  || 0,
      taxIncluded:             data.taxIncluded === true,
      sizeML:                 Number(data.sizeML)          || 100,
      active:                 true,
      imageUrl:               data.imageUrl || '',
      color:                  data.color    || '',
    }

    setSavingLiquid(true)
    try {
      if (data.bottleState === 'open') {
        const ml = Number(data.openML)
        const capacity = Number(data.activeCapacity)
        if (!(ml > 0 && capacity > 0 && ml <= capacity)) throw new Error('Los ml disponibles deben ser mayores que cero y no superar la capacidad de la botella.')
        const existing = liquids.find(item => item.name.trim().toLowerCase() === name.toLowerCase())
        if (existing && (String(existing.brand || '').trim().toLowerCase() !== String(data.brand || '').trim().toLowerCase()
          || Number(existing.activeCapacity) !== capacity
          || String(existing.nicotinaFreebase || 'ninguna') !== String(data.nicotinaFreebase || 'ninguna')
          || String(existing.nicotinaSales || 'ninguna') !== String(data.nicotinaSales || 'ninguna'))) throw new Error('El líquido existente tiene otra marca, capacidad o nicotina. Usa un nombre distinto.')
        if (Number(existing?.openBottleCount || (existing?.hasActive ? 1 : 0)) >= 3) throw new Error('El máximo es 3 botellas abiertas del mismo líquido.')
        const id = existing?.id || data.id || genId('l')
        const base = existing || { ...liquidData, id, closedBottles: 0 }
        const updated = { ...base, id, hasActive: true, activeSaldo: Number(base.activeSaldo || 0) + ml,
          openBottleCount: Number(base.openBottleCount || (base.hasActive ? 1 : 0)) + 1,
          activeTotalCapacity: Number(base.activeTotalCapacity || 0) + capacity,
          totalOpenedBottles: Number(base.totalOpenedBottles || 0) + 1,
          totalOpenedCapacity: Number(base.totalOpenedCapacity || 0) + ml }
        await offlineCallable('addOpenLiquidStock', { liquidId: id, liquid: liquidData, ml, capacity })
        dispatch({ type: existing ? 'UPDATE_LIQUID' : 'ADD_LIQUID', payload: updated })
        toast.success(`Botella abierta registrada: ${updated.activeSaldo} ml disponibles`)
        setModal(null)
        return
      }
      if (businessId) {
        const liquidId = data.id || genId('l')
        const saved = await bizSet(businessId, 'liquids', liquidId, liquidData)
        if (saved !== null) {
          dispatch({ type: 'ADD_LIQUID', payload: { ...liquidData, id: liquidId } })
          toast.success(`Liquido "${liquidData.name}" registrado`)
          setModal(null)
          return
        }
        throw new Error('No se pudo guardar el líquido en Firebase')
      }
      dispatch({ type: 'ADD_LIQUID', payload: { ...liquidData, id: genId('l') } })
      toast.success(`Liquido "${liquidData.name}" registrado`)
      setModal(null)
    } catch (error) {
      toast.error(error.message || 'No se pudo guardar el líquido')
    } finally {
      setSavingLiquid(false)
    }
  }

  const handleEditLiquid = async (data) => {
    if (savingLiquid) return
    const name = data.name?.trim()
    if (!name) { toast.error('Nombre requerido'); return }
    if (hasDuplicateName(liquids, name, data.id)) {
      toast.error(`Ya existe un líquido llamado "${name}"`)
      return
    }

    const fields = {
      name,
      sku:              data.sku?.trim() || makeLiquidCode(liquids),
      brand:            data.brand,
      flavor:           data.flavor,
      category:         data.category,
      sizeML:           Number(data.sizeML)          || 100,
      costPerBottle:    Number(data.costPerBottle)   || 0,
      pricePerBottle:   Number(data.pricePerBottle)  || 0,
      refillConsumption: data.refillConsumption,
      consumptionUnit: data.consumptionUnit,
      taxIncluded:       data.taxIncluded === true,
      closedBottles:    parseInt(data.closedBottles)   || 0,
      pointsR50:        Number(data.pointsR50)       || 10,
      pointsR100:       Number(data.pointsR100)      || 20,
      pointsR150:       Number(data.pointsR150)      || 30,
      nicotinaFreebase: data.sinNicotina ? 'ninguna' : (data.nicotinaFreebase || 'ninguna'),
      nicotinaSales:    data.sinNicotina ? 'ninguna' : (data.nicotinaSales    || 'ninguna'),
      imageUrl:         data.imageUrl || '',
      color:            data.color    || '',
    }

    setSavingLiquid(true)
    try {
      if (data.addOpenBottle) {
        const original = liquids.find(item => item.id === data.id)
        if (!original) throw new Error('El líquido ya no existe. Actualiza el inventario.')
        const ml = Number(data.openML)
        const capacity = Number(original.activeCapacity || original.sizeML || 100)
        if (!Number.isFinite(ml) || ml <= 0 || ml > capacity) throw new Error(`Indica los ml restantes del frasco: más de 0 y hasta ${capacity} ml.`)
        const previousBalance = Number(original.activeSaldo || 0)
        const count = previousBalance > 0 ? Number(original.openBottleCount || 1) : 0
        if (count >= 3) throw new Error('El máximo es 3 frascos abiertos del mismo líquido.')
        await offlineCallable('addOpenLiquidStock', { liquidId: original.id, liquid: original, ml, capacity, editFields: fields })
        dispatch({ type: 'EDIT_LIQUID', payload: { ...original, ...fields, hasActive: true,
          activeSaldo: previousBalance + ml, openBottleCount: count + 1,
          activeTotalCapacity: Number(original.activeTotalCapacity || count * capacity) + capacity,
          totalOpenedBottles: Number(original.totalOpenedBottles || 0) + 1,
          totalOpenedCapacity: Number(original.totalOpenedCapacity || previousBalance) + ml } })
        toast.success(`Frasco añadido a "${name}". Saldo acumulado: ${previousBalance + ml} ml`)
        setModal(null)
        return
      }
      if (businessId && data.id) {
        const ok = await bizUpdate(businessId, 'liquids', data.id, fields)
        if (!ok) throw new Error('No se pudieron guardar los cambios del líquido.')
      }
      dispatch({ type: 'EDIT_LIQUID', payload: { id: data.id, ...fields } })
      toast.success(`"${name}" actualizado`)
      setModal(null)
    } catch (error) {
      toast.error(error.message || 'No se pudieron guardar los cambios')
    } finally {
      setSavingLiquid(false)
    }
  }

  const handleDeleteLiquid = async (liquid) => {
    if (!isAdmin) { toast.error('Solo el administrador puede eliminar liquidos'); return }
    dispatch({ type: 'DELETE_LIQUID', payload: liquid.id })
    if (businessId && liquid.id) await bizDelete(businessId, 'liquids', liquid.id)
    if (liquid.imageUrl) await deleteImage(liquid.imageUrl)
    toast.success(`"${liquid.name}" eliminado`)
    setModal(null)
  }

  const handleImportLiquids = async (rows) => {
    let imported = 0
    let skipped = 0
    const working = [...liquids]
    for (const row of rows) {
      if (!row.name?.trim()) { skipped += 1; continue }
      const existing = findExistingByNameOrCode(working, row, 'sku')
      const id = existing?.id || row.id || genId('l')
      const payload = {
        ...existing,
        ...row,
        id,
        name: row.name.trim(),
        sku: row.sku?.trim() || existing?.sku || makeLiquidCode(working),
        active: row.active !== false,
      }
      dispatch({ type: existing ? 'UPDATE_LIQUID' : 'ADD_LIQUID', payload })
      const pos = working.findIndex(l => l.id === id)
      if (pos >= 0) working[pos] = payload
      else working.push(payload)
      if (businessId) {
        const { id: liquidId, ...data } = payload
        await bizSet(businessId, 'liquids', liquidId, data)
      }
      imported += 1
    }
    toast.success(`${imported} líquido(s) importado(s)/actualizado(s)${skipped ? `, ${skipped} omitido(s)` : ''}`)
  }

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Tabs — Rendimiento con candado si es plan básico */}
      <div className="flex gap-1 bg-[#101c35] rounded-xl p-1 w-fit">
        {TABS.map(t => {
          const isRendimiento = t === 'Rendimiento'
          const locked = isRendimiento && !canViewRendimiento
          return (
            <button key={t}
              onClick={() => {
                if (locked) { setShowUpgrade(true); return }
                setTab(t)
              }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 flex items-center gap-1.5 ${
                tab === t && !locked
                  ? 'bg-neon-green text-[#080d18]'
                  : locked
                    ? 'text-slate-600 cursor-pointer hover:bg-[#1a2848]/50'
                    : 'text-slate-400 hover:text-slate-200'
              }`}>
              {t}
              {locked && <span className="text-[#f59e0b] text-xs">🔒</span>}
            </button>
          )
        })}
      </div>

      {/* ── Botellas Activas ── */}
      {tab === 'Botellas Activas' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {liquids.map(liquid => {
            const loss = detectLoss(liquid)
            return (
              <div key={liquid.id} className="card p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#00c4e8]/10 border border-[#00c4e8]/20 flex items-center justify-center text-xl flex-shrink-0">💧</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-200">{liquid.name}</div>
                    <div className="text-xs text-slate-500">{liquid.brand} · {liquid.flavor}</div>
                    {getNicotinaLabel(liquid) !== 'Sin nicotina' && (
                      <div className="text-xs text-[#a78bfa] font-semibold mt-0.5">{getNicotinaLabel(liquid)}</div>
                    )}
                  </div>
                  <span className={`badge ${liquid.hasActive ? 'badge-green' : 'badge-gray'}`}>
                    {liquid.hasActive ? 'Activa' : 'Sin abrir'}
                  </span>
                </div>

                <BottleProgress liquid={liquid} />
                {loss && <div className="alert-warning text-xs">⚠ {loss.message}</div>}

                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#101c35] rounded-lg p-2.5 text-center">
                    <div className="text-xs text-slate-500 mb-0.5">Cerradas</div>
                    <div className="font-display font-bold text-[#00c4e8] text-lg">{liquid.closedBottles}</div>
                  </div>
                  <div className="bg-[#101c35] rounded-lg p-2.5 text-center">
                    <div className="text-xs text-slate-500 mb-0.5">Recargas</div>
                    <div className="font-display font-bold text-[#00e5a0] text-lg">{liquid.totalRechargesAllTime}</div>
                  </div>
                  <div className="bg-[#101c35] rounded-lg p-2.5 text-center">
                    <div className="text-xs text-slate-500 mb-0.5">Ingresos</div>
                    <div className="font-display font-bold text-[#f59e0b] text-sm">{fmt(liquid.totalRevenueAllTime)}</div>
                  </div>
                </div>

                {(() => {
                  const pct     = getBottlePct(liquid)
                  const isLow   = liquid.hasActive && pct <= 10
                  const hasNext = liquid.closedBottles > 0
                  return (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        {liquid.hasActive && (
                          <button onClick={() => setModal({ type: 'adjust', data: liquid })} className="btn-secondary text-xs flex-1">
                            Ajustar Saldo
                          </button>
                        )}
                        <button onClick={() => setModal({ type: 'detail', data: liquid })} className="btn-secondary text-xs">
                          Detalle
                        </button>
                      </div>
                      {hasNext && (isLow || !liquid.hasActive) && (
                        <button onClick={() => setModal({ type: 'openBottle', data: liquid })}
                          className="w-full text-xs py-2.5 rounded-lg font-bold transition-all active:scale-95"
                          style={isLow
                            ? { background: 'rgba(245,158,11,0.18)', border: '2px solid rgba(245,158,11,0.5)', color: '#fbbf24' }
                            : { background: 'rgba(0,229,160,0.12)', border: '2px solid rgba(0,229,160,0.35)', color: '#00e5a0' }
                          }>
                          {isLow ? `⚡ Preparar siguiente frasco — quedan ${pct}%` : '📦 Abrir frasco para recargas'}
                        </button>
                      )}
                      {!hasNext && isLow && (
                        <div className="alert-danger text-xs text-center">⚠ Sin frascos cerrados — agrega inventario pronto</div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Inventario ── */}
      {tab === 'Inventario' && (
        <div>
          <div className="flex justify-between items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-3 flex-wrap">
              <div className="card px-4 py-2.5 flex items-center gap-2">
                <span className="text-[#00e5a0] font-bold font-mono text-lg">{activeLiquids.length}</span>
                <span className="text-xs text-slate-400">líquidos registrados</span>
              </div>
              <div className="card px-4 py-2.5 flex items-center gap-2">
                <span className="text-[#00c4e8] font-bold font-mono text-sm">{fmt(liquidInventoryValue)}</span>
                <span className="text-xs text-slate-400">valor en inventario</span>
              </div>
              <div className="card px-4 py-2.5 flex items-center gap-2">
                <span className="text-[#00e5a0] font-bold font-mono text-sm">{fmt(liquidSaleValue)}</span>
                <span className="text-xs text-slate-400">valor total de venta</span>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <ExcelDataActions entity="liquids" rows={liquids} onImport={handleImportLiquids} />
              <button onClick={() => setModal({ type: 'new' })} className="btn-primary text-xs">+ Nuevo Líquido</button>
            </div>
          </div>
          <div className="table-container overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {['Nombre', 'Marca / Sabor', 'Tamaño', 'Costo', 'Precio', 'Cerradas', 'Activa', 'Consumo por recarga', 'Estado', 'Acciones'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {liquids.map(l => (
                  <tr key={l.id} className="table-row">
                    <td className="table-cell font-semibold text-slate-200">{l.name}</td>
                    <td className="table-cell text-slate-400 text-xs">{l.brand}<br /><span className="text-slate-500">{l.flavor}</span></td>
                    <td className="table-cell font-mono text-xs">{l.sizeML}ml</td>
                    <td className="table-cell font-mono text-[#f59e0b] text-xs">{fmt(l.costPerBottle)}</td>
                    <td className="table-cell font-mono text-[#00e5a0] text-xs">{l.pricePerBottle ? fmt(l.pricePerBottle) : <span className="text-slate-500">—</span>}</td>
                    <td className="table-cell text-center"><span className="badge badge-blue">{l.closedBottles}</span></td>
                    <td className="table-cell">
                      {l.hasActive ? <><span className="badge badge-green">Sí</span><span className="ml-1 text-xs text-slate-500 font-mono">{l.activeSaldo}pts</span></> : <span className="badge badge-gray">No</span>}
                    </td>
                    <td className="table-cell"><span className="badge badge-amber font-mono text-xs">{getRefillButtons(state.settings).map(b => fmtProjection(getPointsForType(l, b.price, state.settings))).join('/')}</span></td>
                    <td className="table-cell"><span className={`badge ${l.active ? 'badge-green' : 'badge-gray'}`}>{l.active ? 'Activo' : 'Inactivo'}</span></td>
                    <td className="table-cell">
                      <div className="flex gap-1">
                        <button onClick={() => setModal({ type: 'editLiquid', data: l })}
                          className="text-xs px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-[#00e5a0] hover:border-[#00e5a0]/30 transition-all">
                          Editar
                        </button>
                        {isAdmin && (
                          <button onClick={() => setModal({ type: 'deleteLiquid', data: l })}
                            className="text-xs px-2 py-1 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                            Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Historial ── */}
      {tab === 'Historial' && (
        <div className="space-y-4">
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Recargas vendidas</div>
            <div className="table-container overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>{['Fecha', 'Hora', 'Líquido', 'Tipo', 'Precio', 'Pts', 'Empleado'].map(h => <th key={h} className="table-header">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {refillSales.length === 0
                    ? <tr><td colSpan={7} className="table-cell text-center text-slate-500 py-8">Sin recargas</td></tr>
                    : refillSales.map((r, i) => (
                      <tr key={i} className="table-row">
                        <td className="table-cell text-slate-400">{r.date}</td>
                        <td className="table-cell text-slate-400">{r.time}</td>
                        <td className="table-cell font-semibold text-slate-200">{r.liquidName}</td>
                        <td className="table-cell"><span className="badge badge-blue">{r.type}</span></td>
                        <td className="table-cell font-mono font-bold text-[#00e5a0]">{fmt(r.price)}</td>
                        <td className="table-cell font-mono text-slate-400">{r.pointsConsumed}</td>
                        <td className="table-cell text-slate-400">{r.user}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          {bottleSaleLog.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Frascos completos vendidos</div>
              <div className="table-container overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>{['Fecha', 'Hora', 'Líquido', 'Cant.', 'Precio Unit.', 'Total', 'Empleado'].map(h => <th key={h} className="table-header">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {bottleSaleLog.map((b, i) => (
                      <tr key={i} className="table-row">
                        <td className="table-cell text-slate-400">{b.date}</td>
                        <td className="table-cell text-slate-400">{b.time}</td>
                        <td className="table-cell font-semibold text-[#a78bfa]">{b.liquidName}</td>
                        <td className="table-cell text-center"><span className="badge badge-purple">{b.qty}</span></td>
                        <td className="table-cell font-mono text-slate-300">{fmt(b.price)}</td>
                        <td className="table-cell font-mono font-bold text-[#00e5a0]">{fmt(b.price * b.qty)}</td>
                        <td className="table-cell text-slate-400">{b.user}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Rendimiento — bloqueado en plan básico ── */}
      {tab === 'Rendimiento' && (
        canViewRendimiento ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {liquids.map(liquid => <LiquidProjectionCard key={liquid.id} liquid={liquid} settings={state.settings} />)}

          </div>
        ) : (
          // Bloqueado — plan básico
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-[#f59e0b]/10 border border-[#f59e0b]/20 flex items-center justify-center">
              <span className="text-3xl">🔒</span>
            </div>
            <div>
              <div className="font-display font-bold text-slate-100 text-lg mb-1">Rendimiento — Plan Pro</div>
              <div className="text-slate-400 text-sm max-w-xs">
                El análisis de rendimiento y ganancias por botella es exclusivo del plan Pro.
                Actualiza para ver cuánto ganas por cada recarga y botella.
              </div>
            </div>
            <button onClick={() => setShowUpgrade(true)} className="btn-primary px-6">
              ⚡ Actualizar a Pro
            </button>
          </div>
        )
      )}

      {/* ── Modals ── */}
      {modal?.type === 'openBottle' && (
        <ConfirmOpenBottleModal liquid={modal.data} onClose={() => setModal(null)} onConfirm={handleOpenBottle} />
      )}
      {modal?.type === 'sellBottle' && (
        <SellBottleModal liquid={modal.data} onClose={() => setModal(null)} onSell={handleSellBottle} settings={state.settings} />
      )}
      {modal?.type === 'new' && (
        <LiquidFormModal onClose={() => setModal(null)} onSave={handleNewLiquid} settings={state.settings} title="💧 Nuevo Líquido" businessId={businessId} saving={savingLiquid} />
      )}
      {modal?.type === 'editLiquid' && (
        <LiquidFormModal liquid={modal.data} onClose={() => setModal(null)} onSave={handleEditLiquid} settings={state.settings} title={`✏️ Editar: ${modal.data.name}`} businessId={businessId} saving={savingLiquid} />
      )}
      {modal?.type === 'deleteLiquid' && (
        <ConfirmDeleteModal
          title="Eliminar Líquido"
          message={`¿Eliminar "${modal.data.name}"? Esta acción no se puede deshacer.`}
          onClose={() => setModal(null)}
          onConfirm={() => handleDeleteLiquid(modal.data)}
        />
      )}
      {modal?.type === 'adjust' && (
        <AdjustSaldoModal liquid={modal.data} onClose={() => setModal(null)} onSave={handleAdjustSaldo} />
      )}
      {modal?.type === 'detail' && (
        <LiquidDetailModal settings={state.settings} liquid={modal.data} refillSales={refillSales} onClose={() => setModal(null)} />
      )}

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function ConfirmOpenBottleModal({ liquid, onClose, onConfirm }) {
  return (
    <Modal title="📦 Confirmar Apertura de Frasco" onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="bg-[#101c35] rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-200 mb-1">{liquid.name}</div>
          <div className="text-xs text-slate-400">{liquid.brand} · {liquid.sizeML}ml</div>
          <div className="text-xs text-[#00c4e8] mt-1">{liquid.closedBottles} frasco(s) cerrado(s) disponible(s)</div>
        </div>
        <div className="alert-info text-xs">
          <span>ℹ</span>
          <div>
            <strong>Abrir frasco</strong> destina esta botella para hacer recargas. No es una venta al cliente.
            Se agregarán <strong>{liquid.activeCapacity} ml</strong> al saldo actual, sin perder lo que queda.
          </div>
        </div>
        {liquid.hasActive && (
          <div className="alert-warning text-xs">
            El saldo del frasco actual se conservará y se sumará al nuevo. Puedes mantener hasta 3 frascos abiertos.
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => onConfirm(liquid)}>✓ Confirmar Apertura</button>
        </div>
      </div>
    </Modal>
  )
}

function SellBottleModal({ liquid, onClose, onSell, settings }) {
  const [qty, setQty]         = useState(1)
  const [payment, setPayment] = useState('Efectivo')
  const price    = liquid.pricePerBottle || Math.round(liquid.costPerBottle * 1.6)
  const taxRate  = settings?.taxRate ?? 18
  const subtotal = price * qty
  const tax      = Math.round(subtotal * taxRate / 100)
  const total    = subtotal + tax
  const profit   = (price - liquid.costPerBottle) * qty
  return (
    <Modal title={`🍶 Vender Frasco — ${liquid.name}`} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="bg-[#101c35] rounded-xl p-4 flex items-center gap-4">
          <div className="text-3xl">🍶</div>
          <div>
            <div className="font-semibold text-slate-200">{liquid.name}</div>
            <div className="text-xs text-slate-400">{liquid.brand} · {liquid.sizeML}ml</div>
            <div className="text-xs text-[#00c4e8] mt-0.5">{liquid.closedBottles} frasco(s) disponible(s)</div>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="label">Cantidad</label>
            <div className="flex items-center gap-2">
              <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-lg bg-[#1a2848] border border-white/10 text-slate-300 text-lg hover:border-[#00e5a0]/30 hover:text-[#00e5a0] transition-all">−</button>
              <span className="text-xl font-bold text-slate-100 w-8 text-center">{qty}</span>
              <button onClick={() => setQty(q => Math.min(liquid.closedBottles, q + 1))} className="w-9 h-9 rounded-lg bg-[#1a2848] border border-white/10 text-slate-300 text-lg hover:border-[#00e5a0]/30 hover:text-[#00e5a0] transition-all">+</button>
            </div>
          </div>
          <div>
            <label className="label">Método de pago</label>
            <select className="select" value={payment} onChange={e => setPayment(e.target.value)}>
              {['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto'].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>
        <div className="bg-[#101c35] rounded-xl p-4 space-y-2 text-sm">
          <div className="flex justify-between text-slate-400"><span>Precio por frasco</span><span className="font-mono">{fmt(price)}</span></div>
          <div className="flex justify-between text-slate-400"><span>Cantidad × {qty}</span><span className="font-mono">{fmt(price * qty)}</span></div>
          {taxRate > 0 && <div className="flex justify-between text-slate-400"><span>ITBIS ({taxRate}%)</span><span className="font-mono">{fmt(tax)}</span></div>}
          <div className="border-t border-white/10 pt-2 flex justify-between font-bold text-slate-100">
            <span>Total</span><span className="font-mono text-[#00e5a0] text-base">{fmt(total)}</span>
          </div>
          <div className="flex justify-between text-xs text-[#a78bfa]">
            <span>Ganancia estimada</span><span className="font-mono">{fmt(profit)}</span>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => onSell(liquid, qty, payment)}>Confirmar Venta</button>
        </div>
      </div>
    </Modal>
  )
}

function LiquidFormModal({ liquid, onClose, onSave, settings, title, businessId, saving = false }) {
  const refillButtons = getRefillButtons(settings)
  const [form, setForm] = useState({
    id:             liquid?.id            || genId('l'),
    name:           liquid?.name          || '',
    brand:          liquid?.brand         || '',
    flavor:         liquid?.flavor        || '',
    category:       liquid?.category      || 'Frutas',
    costPerBottle:  liquid?.costPerBottle || '',
    pricePerBottle: liquid?.pricePerBottle|| '',
    sizeML:         liquid?.sizeML        || '100',
    closedBottles:  liquid?.closedBottles ?? '0',
    bottleState: 'closed',
    addOpenBottle: false,
    openML: '',
    activeCapacity: liquid?.activeCapacity|| settings?.defaultBottleCapacity || '100',
    refillConsumption: Object.fromEntries(refillButtons.map(b => [String(b.price), liquid ? getPointsForType(liquid, b.price, settings) : b.points])),
    consumptionUnit: liquid?.consumptionUnit || 'ml',
    sinNicotina:      !liquid?.nicotinaFreebase || liquid?.nicotinaFreebase === 'ninguna',
    nicotinaFreebase: (liquid?.nicotinaFreebase && liquid?.nicotinaFreebase !== 'ninguna') ? liquid.nicotinaFreebase : '',
    nicotinaSales:    (liquid?.nicotinaSales    && liquid?.nicotinaSales    !== 'ninguna') ? liquid.nicotinaSales    : '',
    sku:      liquid?.sku      || '',
    imageUrl: liquid?.imageUrl || '',
    color:    liquid?.color    || '',
    taxIncluded: liquid?.taxIncluded === true,
  })
  const [uploading, setUploading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const tempId = form.id || `temp_${Date.now()}`
      const url = await uploadLiquidImage(businessId, tempId, file)
      set('imageUrl', url)
      set('color', '')
      toast.success('Imagen subida')
    } catch (err) {
      console.error('Error al subir imagen de liquido:', err)
      toast.error(err?.message || 'Error al subir imagen')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="form-row">
          <div><label className="label">Nombre *</label><input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Mango Ice" /></div>
          <div><label className="label">Marca</label><input className="input" value={form.brand} onChange={e => set('brand', e.target.value)} /></div>
        </div>
        <div><label className="label">Código interno</label><input className="input font-mono" value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="Se genera automático si lo dejas vacío" /></div>
        <div className="form-row">
          <div><label className="label">Sabor</label><input className="input" value={form.flavor} onChange={e => set('flavor', e.target.value)} /></div>
          <div>
            <label className="label">Categoría</label>
            <select className="select" value={form.category} onChange={e => set('category', e.target.value)}>
              {['Frutas', 'Mentolados', 'Tabaco', 'Postres', 'Bebidas', 'Otros'].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div><label className="label">Costo por Botella (RD$)</label><input className="input" type="number" value={form.costPerBottle} onChange={e => set('costPerBottle', e.target.value)} /></div>
          <div><label className="label">Precio Venta Frasco (RD$)</label><input className="input" type="number" value={form.pricePerBottle} onChange={e => set('pricePerBottle', e.target.value)} /></div>
        </div>
        <label className="flex items-start gap-3 bg-[#101c35] border border-white/10 rounded-xl p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.taxIncluded}
            onChange={e => set('taxIncluded', e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded accent-[#00e5a0]"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-300">ITBIS incluido en los precios de venta</span>
            <span className="block text-xs text-slate-500 mt-0.5">Cuando el negocio usa ITBIS, indica que el precio del frasco y las recargas ya contiene el impuesto. Con la opción Sin ITBIS no modifica el precio.</span>
          </span>
        </label>
        <div className="form-row">
          <div><label className="label">Tamano (ml)</label><input className="input" type="number" value={form.sizeML} onChange={e => setForm(f => ({ ...f, sizeML: e.target.value, ...(!liquid ? { activeCapacity: e.target.value } : {}) }))} /></div>
          {(liquid || form.bottleState === 'closed') && <div><label className="label">Botellas cerradas</label><input className="input" type="number" min="0" step="1" value={form.closedBottles} onChange={e => set('closedBottles', e.target.value)} /></div>}
        </div>
        {liquid && <div className="bg-[#101c35] border border-white/10 rounded-xl p-3 space-y-3">
          <label className="flex items-center gap-3 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.addOpenBottle} disabled={saving} onChange={e => set('addOpenBottle', e.target.checked)} className="w-4 h-4 accent-[#00e5a0]" />
            Añadir frasco abierto
          </label>
          {form.addOpenBottle && <div>
            <label className="label">ML restantes del frasco abierto</label>
            <input className="input" type="number" min="0.1" step="0.1" max={liquid.activeCapacity || liquid.sizeML || 100} value={form.openML} disabled={saving} onChange={e => set('openML', e.target.value)} placeholder="Ej.: 35" />
            <p className="text-xs text-slate-400 mt-2">Se suman al saldo de este mismo líquido. No se descuentan botellas cerradas.</p>
            <p className="text-xs text-[#00e5a0] mt-1">Saldo actual: {Number(liquid.activeSaldo || 0)} ml · Saldo después de añadir: {Number(liquid.activeSaldo || 0) + (Number(form.openML) || 0)} ml</p>
          </div>}
        </div>}
        {!liquid && <div className="form-row">
          <div><label className="label">Estado de la botella</label><select className="select" value={form.bottleState} onChange={e => set('bottleState', e.target.value)}><option value="closed">Botella cerrada</option><option value="open">Botella abierta</option></select></div>
          {form.bottleState === 'open' && <div><label className="label">ML disponibles en la botella abierta</label><input className="input" type="number" min="0.1" step="0.1" max={form.activeCapacity} value={form.openML} onChange={e => set('openML', e.target.value)} /><p className="text-xs text-slate-400 mt-2">Si existe el mismo líquido, se sumarán estos ml a su saldo.</p></div>}
        </div>}
        <div className="bg-[#101c35] rounded-xl p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Nicotina</div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="sinNicotina" checked={form.sinNicotina}
              onChange={e => { set('sinNicotina', e.target.checked); if (e.target.checked) { set('nicotinaFreebase', ''); set('nicotinaSales', '') } }}
              className="w-4 h-4 rounded accent-[#00e5a0]" />
            <label htmlFor="sinNicotina" className="text-sm text-slate-300 cursor-pointer">Sin nicotina</label>
          </div>
          {!form.sinNicotina && (
            <div className="form-row">
              <div>
                <label className="label">Freebase (mg)</label>
                <input className="input" type="number" placeholder="Ej: 3, 6, 80, 100..."
                  value={form.nicotinaFreebase} onChange={e => set('nicotinaFreebase', e.target.value)} />
              </div>
              <div>
                <label className="label">Sales (mg)</label>
                <input className="input" type="number" placeholder="Ej: 25, 50, 80..."
                  value={form.nicotinaSales} onChange={e => set('nicotinaSales', e.target.value)} />
              </div>
            </div>
          )}
        </div>
        {!liquid && (
          <div><label className="label">Capacidad de la botella (puntos)</label><input className="input" type="number" min="1" value={form.activeCapacity} onChange={e => set('activeCapacity', e.target.value)} /></div>
        )}
        <div>
          <label className="label">Imagen del liquido</label>
          <div className="flex items-center gap-3">
            {form.imageUrl
              ? <img src={form.imageUrl} alt="liquido" className="w-16 h-16 object-cover rounded-lg border border-white/10" />
              : <div className="w-16 h-16 rounded-lg border border-white/10 flex items-center justify-center text-2xl"
                  style={{ background: form.color || '#101c35' }}>
                  {form.color ? '' : '💧'}
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
        <div className="card p-4 space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Consumo por recarga</div>
          <p className="text-xs text-slate-400">Los precios se definen en Configuración. Ajusta aquí el consumo de este líquido.</p>
          <select className="select" value={form.consumptionUnit} onChange={e => set('consumptionUnit', e.target.value)}>
            <option value="points">Puntos</option><option value="ml">Mililitros (ml)</option>
          </select>
          <p className="text-xs text-slate-400">Frasco: {form.sizeML} ml = {form.activeCapacity} puntos. El consumo en ml se convierte a puntos para descontarlo del saldo.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {refillButtons.map(b => {
              const factor = form.consumptionUnit === 'ml' ? Number(form.sizeML) / Number(form.activeCapacity) : 1
              const points = form.refillConsumption[String(b.price)] ?? b.points
              return <div key={b.price}>
                <label className="label">RD$ {b.price} — {form.consumptionUnit === 'ml' ? 'ml' : 'pts'}</label>
                <input className="input" type="number" min="0.0001" step="any"
                  value={points === '' ? '' : Number((Number(points) * factor).toFixed(10))}
                  onChange={e => setForm(f => ({ ...f, refillConsumption: { ...f.refillConsumption, [String(b.price)]: e.target.value === '' ? '' : Number(e.target.value) / factor } }))} />
              </div>
            })}
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saving} onClick={async () => { if (!form.name) return toast.error('Nombre requerido');
            if (!(Number(form.activeCapacity) > 0) || !(Number(form.sizeML) > 0)) return toast.error('Capacidad y tamaño deben ser mayores que cero');
            if (![form.costPerBottle || 0, form.pricePerBottle || 0].every(v => Number.isFinite(Number(v)) && Number(v) >= 0)) return toast.error('Costo y precio deben ser válidos');
            if (!refillButtons.length || !refillButtons.every(b => Number.isFinite(Number(form.refillConsumption[String(b.price)])) && Number(form.refillConsumption[String(b.price)]) > 0 && Number(form.refillConsumption[String(b.price)]) <= Number(form.activeCapacity))) return toast.error('Cada consumo debe ser mayor que cero y no superar la capacidad');
            await onSave({ ...form, refillConsumption: Object.fromEntries(refillButtons.map(b => [String(b.price), Number(form.refillConsumption[String(b.price)])])) }) }}>
            {saving ? 'Guardando...' : (liquid ? 'Guardar Cambios' : 'Registrar Líquido')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ConfirmDeleteModal({ title, message, onClose, onConfirm }) {
  return (
    <Modal title={title} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div className="alert-danger text-sm">{message}</div>
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-danger" onClick={onConfirm}>Eliminar</button>
        </div>
      </div>
    </Modal>
  )
}

function AdjustSaldoModal({ liquid, onClose, onSave }) {
  const [saldo, setSaldo]   = useState(liquid.activeSaldo)
  const [reason, setReason] = useState('')
  return (
    <Modal title={`Ajustar Saldo — ${liquid.name}`} onClose={onClose} size="sm">
      <div className="space-y-3">
        <BottleProgress liquid={liquid} />
        <div>
          <label className="label">Nuevo saldo (puntos)</label>
          <input className="input" type="number" min={0} max={liquid.activeTotalCapacity || liquid.activeCapacity} value={saldo} onChange={e => setSaldo(e.target.value)} />
          <div className="text-xs text-slate-500 mt-1">Máximo acumulado: {liquid.activeTotalCapacity || liquid.activeCapacity} ml</div>
        </div>
        <div>
          <label className="label">Motivo *</label>
          <input className="input" placeholder="Merma, corrección..." value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        <div className="flex gap-2 justify-end">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={() => { if (!reason) return toast.error('Motivo requerido'); onSave(liquid.id, saldo, reason) }}>Aplicar</button>
        </div>
      </div>
    </Modal>
  )
}

function LiquidDetailModal({ liquid, refillSales = [], settings, onClose }) {
  const r = getRendimientoReport(liquid, refillSales, settings)
  return (
    <Modal title={`💧 ${liquid.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            { l: 'Marca', v: liquid.brand }, { l: 'Sabor', v: liquid.flavor },
            { l: 'Tamano', v: `${liquid.sizeML}ml` }, { l: 'Nicotina', v: getNicotinaLabel(liquid) },
            { l: 'Costo botella', v: fmt(liquid.costPerBottle) },
            { l: 'Precio frasco', v: liquid.pricePerBottle ? fmt(liquid.pricePerBottle) : '—' },
            { l: 'Botellas cerradas', v: liquid.closedBottles },
            { l: 'Consumo por recarga', v: getRefillButtons(settings).map(b => fmtProjection(getPointsForType(liquid, b.price, settings))).join('/') },
          ].map((s, i) => (
            <div key={i} className="bg-[#101c35] rounded-lg p-3">
              <div className="text-xs text-slate-500">{s.l}</div>
              <div className="font-semibold text-slate-200 text-sm mt-0.5">{s.v}</div>
            </div>
          ))}
        </div>
        <BottleProgress liquid={liquid} />
        <div className="grid grid-cols-3 gap-2">
          {[
            { l: 'Total recargas', v: liquid.totalRechargesAllTime || 0, c: 'text-[#00e5a0]' },
            { l: 'Ingresos totales', v: fmt(liquid.totalRevenueAllTime || 0), c: 'text-[#f59e0b]' },
            { l: 'Ganancia real', v: fmtLiquidMoney(r.realNetProfit), c: r.realNetProfit >= 0 ? 'text-[#00e5a0]' : 'text-red-400' },
          ].map((s, i) => (
            <div key={i} className="bg-[#101c35] rounded-lg p-3 text-center">
              <div className="text-xs text-slate-500 mb-0.5">{s.l}</div>
              <div className={`font-display font-bold ${s.c}`}>{s.v}</div>
            </div>
          ))}
        </div>
        <button className="btn-secondary w-full" onClick={onClose}>Cerrar</button>
      </div>
    </Modal>
  )
}

function LiquidProjectionCard({ liquid, settings }) {
  const rows = getRefillProjections(liquid, settings)
  return <div className="card p-4 space-y-3 min-w-0">
    <div className="font-semibold text-slate-200">{liquid.name || 'Frasco'} — Proyecciones por frasco</div>
    <div className="text-xs text-slate-400">{liquid.sizeML} ml · Costo: {fmtLiquidMoney(liquid.costPerBottle)} · Venta: {fmtLiquidMoney(liquid.pricePerBottle)} · Beneficio del frasco: {fmtLiquidMoney(Number(liquid.pricePerBottle || 0) - Number(liquid.costPerBottle || 0))}</div>
    {rows.map(row => <div key={row.price} className="bg-[#101c35] rounded-lg p-3 text-xs space-y-1">
      <div className="font-semibold text-[#00c4e8]">Recarga RD$ {row.price} · Consume {fmtProjection(row.points)} pts ({fmtProjection(row.points * Number(liquid.sizeML || 0) / Number(liquid.activeCapacity || 1))} ml)</div>
      <div className="text-slate-300">Rinde {fmtProjection(row.expected)} recargas · Costo por recarga: {fmtLiquidMoney(row.cost)}</div>
      <div className={row.profit >= 0 ? 'text-[#00e5a0]' : 'text-red-400'}>Beneficio por recarga: {fmtLiquidMoney(row.profit)}</div>
      <div className="text-slate-300">Ingreso proyectado: {fmtLiquidMoney(row.revenue)} · Beneficio proyectado: {fmtLiquidMoney(row.benefit)}</div>
      <div className="text-slate-500">{row.complete} recargas completas · Sobrante: {fmtProjection(row.remaining)} pts</div>
    </div>)}
    <p className="text-xs text-slate-500">Cada opción es un escenario independiente usando todo un frasco; no se suman entre sí. Son estimaciones antes de descuentos, impuestos y otros gastos, no ganancias realizadas. El rendimiento teórico puede incluir una fracción de recarga.</p>
  </div>
}
