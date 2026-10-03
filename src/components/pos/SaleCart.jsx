import React, { useState } from 'react'
import { useApp } from '../../contexts/AppContext'
import { useAuth } from '../../contexts/AuthContext'
import { fmt, genId } from '../../utils/helpers'
import { getCostPerRefill } from '../../services/liquidService'
import { hasDuplicateName, hasDuplicateCode, makeCustomerCode } from '../../utils/recordGuards'
import InvoiceModal from './InvoiceModal'
import Modal from '../ui/Modal'
import toast from 'react-hot-toast'
import { bizAdd } from '../../services/firestoreService'
import { issueNCF } from '../../services/fiscalService'
import { FISCAL_TYPES, FISCAL_TYPE_OPTIONS, fiscalConfigFromSettings, findActiveSequence, sequenceRemaining, validateRncCedula } from '../../utils/fiscalHelpers'
import { ensureRncDatabase, lookupRnc, normalizeRnc } from '../../services/rncLookupService'
import { httpsCallable } from 'firebase/functions'
import { offlineCallable } from '../../services/offlineSync'
import { functions } from '../../config/firebase'

const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Mixto']
const toNum = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0 }
const calcLineProfit = (item, state) => {
  const qty = Math.max(1, toNum(item.qty) || 1)
  const price = toNum(item.price)
  let cost = toNum(item.cost)
  if (item.type === 'refill') {
    const liquid = state.liquids.find(l => l.id === item.liquidId)
    cost = liquid ? getCostPerRefill(liquid, price, state.settings) : cost
  }
  if (item.type === 'discount') return -Math.abs(price) * qty
  const taxRate = toNum(state.settings?.taxRate) / 100
  const netPrice = item.taxIncluded === true && taxRate > 0 ? price / (1 + taxRate) : price
  return (netPrice - cost) * qty
}

const calculateTaxTotals = (cart, taxRate) => {
  const rate = Math.max(0, toNum(taxRate)) / 100
  const saleItems = cart.filter(i => i.type !== 'discount')
  const discountTotal = cart
    .filter(i => i.type === 'discount')
    .reduce((a, i) => a + Math.abs(toNum(i.price)) * Math.max(1, toNum(i.qty) || 1), 0)

  let taxAmount = 0
  let grossBeforeDiscount = 0

  saleItems.forEach(item => {
    const qty = Math.max(1, toNum(item.qty) || 1)
    const line = toNum(item.price) * qty
    if (item.taxIncluded === true && rate > 0) {
      const net = line / (1 + rate)
      taxAmount += line - net
      grossBeforeDiscount += line
    } else {
      const lineTax = line * rate
      taxAmount += lineTax
      grossBeforeDiscount += line + lineTax
    }
  })

  const tax = Math.round(taxAmount)
  const gross = Math.round(grossBeforeDiscount)
  const subtotal = Math.max(0, gross - tax)
  const total = Math.max(0, gross - Math.round(discountTotal))

  return { subtotal, tax, discountTotal: Math.round(discountTotal), total }
}

function TypePill({ type }) {
  if (type === 'refill')   return <span className="text-[8px] font-bold uppercase tracking-wider text-[#00c4e8] bg-[#00c4e8]/10 px-1.5 py-0.5 rounded-full">Recarga</span>
  if (type === 'bottle')   return <span className="text-[8px] font-bold uppercase tracking-wider text-[#a78bfa] bg-[#8b5cf6]/10 px-1.5 py-0.5 rounded-full">Frasco</span>
  if (type === 'service')  return <span className="text-[8px] font-bold uppercase tracking-wider text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded-full">Servicio</span>
  if (type === 'discount') return <span className="text-[8px] font-bold uppercase tracking-wider text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">Descuento</span>
  return null
}

export default function SaleCart({ onSaleComplete }) {
  const { state, dispatch } = useApp()
  const { businessId } = useAuth()
  const { cart, selectedPayment, customers, settings } = state
  const isAdmin   = state.currentUser?.role === 'Administrador'
  const isManager = ['Administrador','Encargado'].includes(state.currentUser?.role)

  const [customerSearch, setCustomerSearch]   = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [completedSale, setCompletedSale]     = useState(null)
  const [showPanel, setShowPanel]             = useState(null) // 'discount' | 'service'
  const [showCobrar, setShowCobrar]           = useState(false)
  const [amountReceived, setAmountReceived]   = useState('')
  const [creditAmount, setCreditAmount]       = useState('')
  const [fiscalType, setFiscalType]           = useState('none')
  const [fiscalCustomer, setFiscalCustomer]   = useState({ name: '', rnc: '', address: '', phone: '' })
  const [rncLookupStatus, setRncLookupStatus] = useState('idle') // idle | loading | found | not-found | error
  const [rncLookupResult, setRncLookupResult] = useState(null)
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [redeemPointsAmount, setRedeemPointsAmount] = useState('50')

  // Discount/Service management state
  const [newDiscount, setNewDiscount]   = useState({ name: '', type: 'porcentaje', value: '' })
  const [newService, setNewService]     = useState({ name: '', price: '' })
  const [editDiscount, setEditDiscount] = useState(null)
  const [editService, setEditService]   = useState(null)

  const discounts = settings?.discounts || []
  const services  = settings?.services  || []
  const fiscalConfig = { ...fiscalConfigFromSettings(settings), ...(state.fiscalConfig || {}) }
  const fiscalEnabled = !!fiscalConfig.enabled
  const selectedFiscal = FISCAL_TYPES[fiscalType] || FISCAL_TYPES.none
  const selectedSequence = fiscalType !== 'none' ? findActiveSequence(state.ncfSequences, fiscalType) : null



  const handleManualRncLookup = async () => {
    const cleanRnc = normalizeRnc(fiscalCustomer.rnc)
    if (cleanRnc.length < 9) return toast.error('Escribe un RNC o cédula válido')

    setRncLookupResult(null)
    setRncLookupStatus('loading')
    try {
      await ensureRncDatabase()
      const result = await lookupRnc(cleanRnc)
      if (!result) {
        setRncLookupStatus('not-found')
        setRncLookupResult(null)
        toast.error('RNC/Cédula no encontrado en la base local DGII')
        return
      }
      setFiscalCustomer(c => ({ ...c, rnc: cleanRnc, name: result.razonSocial || c.name }))
      setRncLookupResult(result)
      setRncLookupStatus('found')
      toast.success('Datos fiscales encontrados')
    } catch (error) {
      console.error('Error consultando RNC:', error)
      setRncLookupStatus('error')
      setRncLookupResult(null)
      toast.error('No se pudo consultar la base RNC')
    }
  }

  const handleFiscalTypeChange = (value) => {
    setFiscalType(value)
    setRncLookupStatus('idle')
    setRncLookupResult(null)
    if (value === 'none') return
    setFiscalCustomer(c => ({
      name: c.name || selectedCustomer?.name || '',
      rnc: c.rnc || selectedCustomer?.rnc || selectedCustomer?.cedula || '',
      address: c.address || selectedCustomer?.address || '',
      phone: c.phone || selectedCustomer?.phone || '',
    }))
  }

  const taxRate  = settings?.taxRate ?? 0
  const { subtotal, tax, discountTotal, total } = calculateTaxTotals(cart, taxRate)
  const change   = amountReceived ? Math.max(0, parseFloat(amountReceived) - total) : 0

  const filteredCustomers = customerSearch.length > 1
    ? customers.filter(c =>
        c.name?.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.phone?.includes(customerSearch) ||
        c.code?.toLowerCase().includes(customerSearch.toLowerCase())
      )
    : []

  // Customer loyalty / credit indicators
  const customerCredit = selectedCustomer?.creditBalance || 0
  const customerRefills = selectedCustomer?.refillRewards ?? selectedCustomer?.totalRefills ?? 0
  const customerPoints = selectedCustomer?.rewardPoints ?? Math.floor((selectedCustomer?.totalSpent || 0) / 50)
  const hasFreeRefillReward = cart.some(i => i.id === 'disc_free_refill_reward')
  const hasPointsRedemption = cart.some(i => i.id === 'disc_points_redemption')
  const canShowFreeRefillReward = !!selectedCustomer && customerRefills >= 4 && !hasFreeRefillReward
  const canShowPointsRedemption = !!selectedCustomer && customerPoints >= 50 && !hasPointsRedemption
  const shouldShowBenefits = canShowFreeRefillReward || canShowPointsRedemption

  const handleCreateCustomer = async (data) => {
    if (savingCustomer) return
    if (!data.name?.trim()) { toast.error('Nombre requerido'); return }

    const name = data.name.trim()
    const code = data.code?.trim() || makeCustomerCode(customers)
    if (hasDuplicateName(customers, name)) {
      toast.error(`Ya existe un cliente llamado "${name}"`)
      return
    }
    if (hasDuplicateCode(customers, code)) {
      toast.error(`Ya existe un cliente con el código ${code}`)
      return
    }

    const newCustomer = {
      ...data,
      name,
      phone: data.phone?.trim() || '',
      email: data.email?.trim() || '',
      code,
      notes: data.notes?.trim() || '',
      totalSpent: 0,
      totalTransactions: 0,
      creditBalance: 0,
      refillRewards: 0,
      totalRefills: 0,
      rewardPoints: 0,
      lastPurchase: null,
    }

    setSavingCustomer(true)
    try {
      if (businessId) {
        const saved = await bizAdd(businessId, 'customers', newCustomer)
        const customer = { ...newCustomer, id: saved?.id || genId('c'), createdAt: new Date() }
        dispatch({ type: 'ADD_CUSTOMER', payload: customer })
        setSelectedCustomer(customer)
        setCustomerSearch(customer.name)
      } else {
        const customer = { id: genId('c'), ...newCustomer, createdAt: new Date() }
        dispatch({ type: 'ADD_CUSTOMER', payload: customer })
        setSelectedCustomer(customer)
        setCustomerSearch(customer.name)
      }
      setShowNewCustomerModal(false)
      toast.success(`Cliente "${newCustomer.name}" registrado`)
    } catch (err) {
      console.error('create customer failed:', err)
      toast.error('No se pudo registrar el cliente')
    } finally {
      setSavingCustomer(false)
    }
  }

  const applyFreeRefillReward = () => {
    if (!selectedCustomer) return toast.error('Selecciona un cliente')
    if (customerRefills < 4) return toast.error('Este cliente necesita 4 recargas acumuladas')
    if (hasFreeRefillReward) return toast.error('La recarga gratis ya fue aplicada')
    const refillItems = cart.filter(i => i.type === 'refill')
    if (!refillItems.length) return toast.error('Agrega una recarga al carrito primero')
    const freeAmount = Math.min(...refillItems.map(i => Number(i.price) || 0).filter(Boolean))
    if (!freeAmount) return toast.error('No se pudo calcular la recarga gratis')
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: 'disc_free_refill_reward', type: 'discount', name: '5ta recarga gratis', price: -freeAmount, cost: 0, qty: 1, loyaltyType: 'free_refill' }
    })
    toast.success('5ta recarga gratis aplicada')
  }

  const applyPointsRedemption = () => {
    if (!selectedCustomer) return toast.error('Selecciona un cliente')
    if (customerPoints < 50) return toast.error('El cliente necesita mínimo 50 puntos')
    if (hasPointsRedemption) return toast.error('Los puntos ya fueron redimidos en esta venta')
    const amount = parseInt(redeemPointsAmount) || 0
    if (amount < 50) return toast.error('Mínimo 50 puntos para redimir')
    if (amount > customerPoints) return toast.error(`El cliente solo tiene ${customerPoints} puntos`)
    const maxDiscount = Math.max(0, subtotal - discountTotal)
    if (maxDiscount <= 0) return toast.error('No hay monto disponible para descontar')
    const discount = Math.min(amount, maxDiscount)
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: 'disc_points_redemption', type: 'discount', name: `Redención de ${discount} puntos`, price: -discount, cost: 0, qty: 1, loyaltyType: 'points', pointsRedeemed: discount }
    })
    toast.success(`${discount} puntos redimidos`)
  }

  // ── Apply discount ──────────────────────────────────────
  const applyDiscount = (disc) => {
    const amount = disc.type === 'porcentaje'
      ? Math.round(subtotal * disc.value / 100)
      : disc.value
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: `disc_${disc.id}`, type: 'discount', name: `Descuento: ${disc.name}`, price: -Math.abs(amount), cost: 0, qty: 1 }
    })
    setShowPanel(null)
    toast.success(`Descuento "${disc.name}" aplicado`)
  }

  // ── Add service ─────────────────────────────────────────
  const addService = (svc) => {
    dispatch({
      type: 'ADD_TO_CART',
      payload: { id: `svc_${svc.id}_${Date.now()}`, type: 'service', name: svc.name, price: svc.price, cost: 0, qty: 1 }
    })
    setShowPanel(null)
    toast.success(`"${svc.name}" agregado`)
  }

  // ── Save discounts to settings ───────────────────────────
  const saveDiscounts = (newList) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { discounts: newList } })
  }
  const saveServices = (newList) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { services: newList } })
  }

  // ── Complete sale ────────────────────────────────────────
  const handleCobrar = async () => {
    if (cart.length === 0) { toast.error('El carrito esta vacio'); return }
    if (fiscalType !== 'none') {
      if (!navigator.onLine) { toast.error('Los comprobantes fiscales requieren conexión. Puedes realizar una venta sin NCF.'); return }
      if (!fiscalEnabled) { toast.error('El módulo fiscal no está activo'); return }
      if (!selectedSequence) { toast.error(`No hay secuencia NCF disponible para ${fiscalType}`); return }
      if (selectedFiscal.requiresCustomer && (!fiscalCustomer.name || !validateRncCedula(fiscalCustomer.rnc))) {
        toast.error('Completa nombre y RNC/Cédula válido del cliente fiscal'); return
      }
    }
    const paid = amountReceived ? parseFloat(amountReceived) : total
    const credit = parseFloat(creditAmount) || 0
    const totalCredit = customerCredit + credit
    if (paid + totalCredit < total) {
      toast.error('El monto recibido mas el credito no cubre el total'); return
    }
    const now = new Date()
    const productItems  = cart.filter(i => i.type === 'product')
    const refillItems   = cart.filter(i => i.type === 'refill')
    const bottleItems   = cart.filter(i => i.type === 'bottle')
    const serviceItems  = cart.filter(i => i.type === 'service')
    const discountItems = cart.filter(i => i.type === 'discount')
    const freeRefillRedeemed = discountItems.some(i => i.loyaltyType === 'free_refill')
    const pointsRedeemed = discountItems.reduce((a, i) => a + (i.pointsRedeemed || 0), 0)
    const profit = cart.reduce((a, i) => a + calcLineProfit(i, state), 0)

    let fiscalData = null
    if (fiscalType !== 'none') {
      try {
        const issued = await issueNCF(state.businessId, state.ncfSequences, fiscalType)
        dispatch({ type: 'CONSUME_NCF_SEQUENCE', payload: issued })
        fiscalData = {
          enabled: true,
          typeCode: fiscalType,
          typeLabel: selectedFiscal.label,
          ncf: issued.ncf,
          sequenceId: issued.sequenceId,
          expiresAt: issued.expiresAt,
          business: fiscalConfig,
          customer: {
            name: fiscalCustomer.name || selectedCustomer?.name || 'Consumidor Final',
            rnc: fiscalCustomer.rnc || '',
            address: fiscalCustomer.address || '',
            phone: fiscalCustomer.phone || '',
          },
        }
        if (issued.remaining <= issued.alertThreshold) {
          toast(`Quedan ${issued.remaining} NCF disponibles para ${fiscalType}`, { icon: '⚠️' })
        }
      } catch (err) {
        toast.error(err.message || 'No se pudo generar el NCF')
        return
      }
    }

    const nextCounter = state.saleCounter + 1
    const saleId = `s_${state.currentUser?.id || 'user'}_${Date.now()}_${genId('sale')}`
    const saleNumber = `${settings?.invoicePrefix || 'VPS'}-${String(nextCounter).padStart(3, '0')}`

    const sale = {
      id:           saleId,
      ...(state.branchId ? { branchId: state.branchId } : {}),
      saleNumber,
      date:         now.toISOString().split('T')[0],
      time:         now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      user:         state.currentUser?.name || 'Admin',
      userId:       state.currentUser?.id   || 'u1',
      customerId:   selectedCustomer?.id    || null,
      customerName: fiscalData?.customer?.name || selectedCustomer?.name  || null,
      customerRnc:  fiscalData?.customer?.rnc || selectedCustomer?.rnc || null,
      items: productItems.map(i => ({ productId: i.id, name: i.name, qty: i.qty, price: i.price, cost: i.cost, taxIncluded: i.taxIncluded === true })),
      refills: refillItems.flatMap(i =>
        Array.from({ length: i.qty }, () => ({
          liquidId: i.liquidId, liquidName: i.liquidName,
          type: `RD$${i.price}`, price: toNum(i.price), pointsConsumed: toNum(i.points), cost: toNum(i.cost), taxIncluded: i.taxIncluded === true,
        }))
      ),
      bottleSales: bottleItems.map(i => ({ liquidId: i.liquidId, liquidName: i.liquidName, qty: i.qty, price: i.price, cost: i.cost, isHalf: i.isHalf === true, taxIncluded: i.taxIncluded === true })),
      services: serviceItems.map(i => ({ name: i.name, price: i.price, qty: i.qty })),
      discounts: discountItems.map(i => ({ name: i.name, amount: Math.abs(i.price) })),
      subtotal, tax, discountTotal, total,
      fiscal: fiscalData,
      payment:               selectedPayment,
      amountReceived:        amountReceived ? parseFloat(amountReceived) : (total - (parseFloat(creditAmount) || 0)),
      change:                Math.max(0, (amountReceived ? parseFloat(amountReceived) : total) - total),
      creditAdded:           parseFloat(creditAmount) || 0,
      creditPreviousBalance: customerCredit,
      refillRewardsEarned: freeRefillRedeemed ? 0 : refillItems.reduce((a, i) => a + (i.qty || 1), 0),
      freeRefillRedeemed,
      pointsRedeemed,
      rewardPointsEarned: Math.max(0, Math.floor(((selectedCustomer?.totalSpent || 0) + total) / 50) - Math.floor((selectedCustomer?.totalSpent || 0) / 50)),
      profit,
      notes: '',
    }

    const fiscalInvoice = fiscalData ? {
      id: sale.id, saleId: sale.id, saleNumber: sale.saleNumber, date: sale.date, time: sale.time,
      ...(state.branchId ? { branchId: state.branchId } : {}),
      ncf: fiscalData.ncf, typeCode: fiscalData.typeCode, typeLabel: fiscalData.typeLabel,
      customerName: fiscalData.customer.name, customerRnc: fiscalData.customer.rnc,
      subtotal, tax, discountTotal, total, payment: selectedPayment, user: sale.user, userId: sale.userId,
      expiresAt: fiscalData.expiresAt, sequenceId: fiscalData.sequenceId,
    } : null
    try {
      await offlineCallable('commitSale', { sale, cashSessionId: state.cashSession?.id || '', fiscalInvoice })
    } catch (error) {
      toast.error(error.message || 'No se pudo completar la venta')
      return
    }

    productItems.forEach(item => dispatch({ type: 'DEDUCT_STOCK', payload: { productId: item.id, qty: item.qty }, _skipSync: true }))
    refillItems.forEach(item => dispatch({ type: 'CONSUME_REFILL', payload: { liquidId: item.liquidId, points: item.points * item.qty, price: item.price * item.qty, qty: item.qty }, _skipSync: true }))
    bottleItems.forEach(item => dispatch({ type: 'SELL_CLOSED_BOTTLE', payload: { liquidId: item.liquidId, qty: item.qty, isHalf: item.isHalf === true }, _skipSync: true }))

    dispatch({ type: 'ADD_SALE', payload: sale, _skipSync: true })
    if (fiscalData) {
      dispatch({ type: 'ADD_FISCAL_INVOICE', payload: fiscalInvoice, _skipSync: true })
    }
    // Update customer stats and credit balance
    if (selectedCustomer) {
      const newCredit = customerCredit + (parseFloat(creditAmount) || 0)
      const previousSpent = selectedCustomer.totalSpent || 0
      const newTotalSpent = previousSpent + total
      const refillRewardsEarned = freeRefillRedeemed ? 0 : refillItems.reduce((a, i) => a + (i.qty || 1), 0)
      const refillRewardBalance = Math.max(0, (selectedCustomer.refillRewards ?? selectedCustomer.totalRefills ?? 0) - (freeRefillRedeemed ? 4 : 0))
      const rewardPointBalance = Math.max(0, (selectedCustomer.rewardPoints ?? Math.floor(previousSpent / 50)) - pointsRedeemed)
      const rewardPointsEarned = Math.max(0, Math.floor(newTotalSpent / 50) - Math.floor(previousSpent / 50))
      dispatch({ type: 'UPDATE_CUSTOMER', payload: {
        ...selectedCustomer,
        creditBalance:     newCredit,
        totalSpent:        newTotalSpent,
        totalTransactions: (selectedCustomer.totalTransactions || 0) + 1,
        lastPurchase:      sale.date,
        refillRewards:     refillRewardBalance + refillRewardsEarned,
        totalRefills:      Math.max(0, (selectedCustomer.totalRefills || 0) - (freeRefillRedeemed ? 4 : 0)) + refillRewardsEarned,
        rewardPoints:      rewardPointBalance + rewardPointsEarned,
      }, _skipSync: true })
    }
    dispatch({ type: 'CLEAR_CART' })
    setSelectedCustomer(null)
    setCustomerSearch('')
    setAmountReceived('')
    setCreditAmount('')
    setShowCobrar(false)
    setFiscalType('none')
    setFiscalCustomer({ name: '', rnc: '', address: '', phone: '' })
    toast.success(`Venta completada — ${fmt(total)}`)
    setCompletedSale(sale)
    onSaleComplete?.(sale)
  }


  const updateCartQty = (index, delta) => {
    const item = cart[index]
    if (item?.type === 'refill' && delta > 0) {
      const liquid = state.liquids.find(l => l.id === item.liquidId)
      const otherPoints = cart
        .filter((c, i) => i !== index && c.type === 'refill' && c.liquidId === item.liquidId)
        .reduce((a, c) => a + toNum(c.points) * Math.max(1, toNum(c.qty) || 1), 0)
      const nextQty = Math.max(1, toNum(item.qty) + delta)
      const needed = otherPoints + toNum(item.points) * nextQty
      if (liquid && needed > toNum(liquid.activeSaldo)) {
        toast.error(`Saldo insuficiente. Disponible: ${liquid.activeSaldo} pts, necesitas ${needed} pts`)
        return
      }
    }
    dispatch({ type: 'UPDATE_CART_QTY', payload: { index, delta } })
  }

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-7rem)] md:h-full max-h-[calc(100vh-7rem)] md:max-h-none bg-[#111e38] border border-white/5 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="text-sm font-display font-bold text-slate-200 mb-2">Carrito</div>
          <div className="relative">
            <div className="flex gap-2">
              <input className="input text-xs py-2 flex-1" placeholder="Buscar cliente (opcional)..."
                value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setSelectedCustomer(null) }} />
              <button
                type="button"
                onClick={() => setShowNewCustomerModal(true)}
                className="px-3 py-2 rounded-lg bg-neon-green text-[#080d18] text-xs font-bold hover:bg-emerald-400 active:scale-95 transition-all whitespace-nowrap"
                title="Nuevo cliente"
              >
                + Cliente
              </button>
            </div>
            {selectedCustomer && (
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2 px-2 py-1 bg-[#00e5a0]/10 border border-[#00e5a0]/20 rounded-lg">
                  <span className="text-xs text-[#00e5a0] font-semibold">{selectedCustomer.name}</span>
                  {selectedCustomer.code && <span className="text-xs font-mono text-slate-400">{selectedCustomer.code}</span>}
                  <button onClick={() => { setSelectedCustomer(null); setCustomerSearch('') }} className="text-slate-400 hover:text-red-400 ml-auto text-xs">x</button>
                </div>
                <div className={`px-2 py-1 rounded-lg border text-xs ${customerCredit > 0 ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-[#0c1424] border-white/10 text-slate-400'}`}>
                  Deuda: <span className="font-mono font-bold">{fmt(customerCredit)}</span>
                </div>
              </div>
            )}
            {filteredCustomers.length > 0 && !selectedCustomer && (
              <div className="absolute top-full left-0 right-0 z-10 bg-[#1a2848] border border-white/10 rounded-lg mt-1 shadow-xl overflow-hidden">
                {filteredCustomers.slice(0, 4).map(c => (
                  <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(c.name) }}
                    className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 border-b border-white/5 last:border-0">
                    {c.name} <span className="text-slate-500">— {c.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto cart-scroll">
        {/* Cart items */}
        <div className="px-4 py-3 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-32 md:h-full text-slate-500 text-sm gap-2">
              <span className="text-3xl">🛒</span><span>Carrito vacio</span>
            </div>
          ) : cart.map((item, i) => (
            <div key={i} className={`flex items-center gap-2 border rounded-lg p-2.5 ${item.type === 'discount' ? 'bg-red-500/5 border-red-500/20' : 'bg-[#1a2848] border-white/5'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <TypePill type={item.type} />
                  <div className="text-xs font-semibold text-slate-200 truncate">{item.name}</div>
                </div>
                <div className={`text-xs font-mono font-bold ${item.type === 'discount' ? 'text-red-400' : 'text-[#00e5a0]'}`}>
                  {item.type === 'discount' ? `-${fmt(Math.abs(item.price))}` : fmt(item.price)}
                </div>
              </div>
              {item.type !== 'discount' && (
                <div className="flex items-center gap-1">
                  <button onClick={() => updateCartQty(i, -1)}
                    className="w-6 h-6 rounded flex items-center justify-center border border-white/10 text-slate-400 hover:text-[#00e5a0] text-sm transition-all">-</button>
                  <span className="text-xs font-bold text-slate-200 min-w-[16px] text-center">{item.qty}</span>
                  <button onClick={() => updateCartQty(i, 1)}
                    className="w-6 h-6 rounded flex items-center justify-center border border-white/10 text-slate-400 hover:text-[#00e5a0] text-sm transition-all">+</button>
                </div>
              )}
              <div className={`text-xs font-bold font-mono min-w-[60px] text-right ${item.type === 'discount' ? 'text-red-400' : 'text-slate-300'}`}>
                {item.type === 'discount' ? `-${fmt(Math.abs(item.price))}` : fmt(item.price * item.qty)}
              </div>
              <button onClick={() => dispatch({ type: 'REMOVE_FROM_CART', payload: i })}
                className="text-slate-500 hover:text-red-400 text-xs transition-colors">x</button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5 space-y-2">
          {/* Totals */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-400"><span>Subtotal</span><span className="font-mono">{fmt(subtotal)}</span></div>
            {discountTotal > 0 && <div className="flex justify-between text-xs text-red-400"><span>Descuento</span><span className="font-mono">-{fmt(discountTotal)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between text-xs text-slate-400"><span>ITBIS ({taxRate}%)</span><span className="font-mono">{fmt(tax)}</span></div>}
            <div className="flex justify-between text-sm font-bold text-slate-100 pt-1 border-t border-white/10">
              <span>Total</span>
              <span className="font-mono text-[#00e5a0] text-lg">{fmt(total)}</span>
            </div>
          </div>

          {/* Discount + Service buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => setShowPanel(showPanel === 'discount' ? null : 'discount')}
              className={`py-2 rounded-lg text-xs font-semibold border transition-all ${showPanel === 'discount' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-[#1a2848] border-white/10 text-slate-400 hover:border-white/25'}`}>
              % Descuento
            </button>
            <button onClick={() => setShowPanel(showPanel === 'service' ? null : 'service')}
              className={`py-2 rounded-lg text-xs font-semibold border transition-all ${showPanel === 'service' ? 'bg-[#f59e0b]/10 border-[#f59e0b]/30 text-[#f59e0b]' : 'bg-[#1a2848] border-white/10 text-slate-400 hover:border-white/25'}`}>
              + Servicios
            </button>
          </div>

          {shouldShowBenefits && (
            <div className="bg-[#0c1424] border border-[#00e5a0]/20 rounded-xl p-3 space-y-2">
              <div className="text-xs font-bold text-[#00e5a0] uppercase tracking-wider">Beneficios disponibles</div>
              <div className="grid grid-cols-1 gap-2">
                {canShowFreeRefillReward && (
                  <button
                    type="button"
                    onClick={applyFreeRefillReward}
                    className="py-2 rounded-lg text-xs font-semibold border bg-[#00e5a0]/10 border-[#00e5a0]/30 text-[#00e5a0] hover:bg-[#00e5a0]/15 transition-all"
                  >
                    🎁 Aplicar 5ta recarga gratis
                  </button>
                )}
                {canShowPointsRedemption && (
                  <div className="flex gap-2">
                    <input
                      className="input text-xs py-2 font-mono w-20"
                      type="number"
                      min="50"
                      max={customerPoints}
                      value={redeemPointsAmount}
                      onChange={e => setRedeemPointsAmount(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={applyPointsRedemption}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold border bg-[#00c4e8]/10 border-[#00c4e8]/30 text-[#00c4e8] hover:bg-[#00c4e8]/15 transition-all"
                    >
                      💎 Redimir puntos
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Discount panel */}
          {showPanel === 'discount' && (
            <DiscountPanel
              discounts={discounts} isAdmin={isAdmin}
              onApply={applyDiscount}
              onSave={saveDiscounts}
              newDiscount={newDiscount} setNewDiscount={setNewDiscount}
              editDiscount={editDiscount} setEditDiscount={setEditDiscount}
            />
          )}

          {/* Service panel */}
          {showPanel === 'service' && (
            <ServicePanel
              services={services} isAdmin={isAdmin}
              onAdd={addService}
              onSave={saveServices}
              newService={newService} setNewService={setNewService}
              editService={editService} setEditService={setEditService}
            />
          )}

          {/* Fiscal invoice selector */}
          {cart.length > 0 && fiscalEnabled && (
            <div className="bg-[#0c1424] border border-[#00c4e8]/20 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-[#00c4e8] uppercase tracking-wider">Comprobante fiscal</div>
                  <div className="text-[10px] text-slate-500">Para clientes que pidan factura con RNC / NCF</div>
                </div>
                {fiscalType !== 'none' && selectedSequence && (
                  <div className="text-[10px] text-slate-500 whitespace-nowrap">Restan {sequenceRemaining(selectedSequence)} NCF</div>
                )}
              </div>

              {!fiscalEnabled && (
                <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                  El módulo fiscal está desactivado. Un administrador debe activarlo en <b>Fiscal / NCF</b> para emitir comprobantes.
                </div>
              )}

              <select
                className="select w-full text-xs py-2"
                value={fiscalType}
                onChange={e => handleFiscalTypeChange(e.target.value)}
                disabled={!fiscalEnabled}
              >
                <option value="none">Venta normal / Sin NCF</option>
                {FISCAL_TYPE_OPTIONS.map(t => <option key={t.code} value={t.code}>{t.code} — {t.shortLabel}</option>)}
              </select>

              {fiscalEnabled && fiscalType !== 'none' && !selectedSequence && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                  No hay secuencia activa, vigente y disponible para {fiscalType}. El administrador debe crearla en Fiscal / NCF.
                </div>
              )}

              {fiscalEnabled && fiscalType !== 'none' && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-xs py-2 col-span-2" placeholder="Nombre / razón social cliente" value={fiscalCustomer.name} onChange={e => setFiscalCustomer(c => ({ ...c, name: e.target.value }))} />
                  <div className="col-span-2 grid grid-cols-[1fr_auto] gap-2">
                    <input className="input text-xs py-2" placeholder="RNC o cédula" value={fiscalCustomer.rnc} onChange={e => { setRncLookupStatus('idle'); setRncLookupResult(null); setFiscalCustomer(c => ({ ...c, rnc: e.target.value })) }} />
                    <button type="button" className="btn-secondary text-xs px-3" onClick={handleManualRncLookup} disabled={rncLookupStatus === 'loading'}>
                      {rncLookupStatus === 'loading' ? 'Buscando...' : 'Buscar'}
                    </button>
                  </div>
                  {rncLookupStatus === 'found' && (
                    <div className="col-span-2 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                      Datos encontrados en DGII: <b>{rncLookupResult?.razonSocial || fiscalCustomer.name}</b>{rncLookupResult?.estado ? ` · Estado: ${rncLookupResult.estado}` : ''}. Puedes editar manualmente si hace falta.
                    </div>
                  )}
                  {rncLookupStatus === 'not-found' && <div className="col-span-2 text-[10px] text-amber-300">No encontrado en la base local. Puedes escribir los datos manualmente.</div>}
                  {rncLookupStatus === 'error' && <div className="col-span-2 text-[10px] text-red-400">No se pudo consultar la base RNC. Verifica internet o intenta de nuevo.</div>}
                  <input className="input text-xs py-2" placeholder="Teléfono opcional" value={fiscalCustomer.phone} onChange={e => setFiscalCustomer(c => ({ ...c, phone: e.target.value }))} />
                  <input className="input text-xs py-2 col-span-2" placeholder="Dirección opcional" value={fiscalCustomer.address} onChange={e => setFiscalCustomer(c => ({ ...c, address: e.target.value }))} />
                  {selectedFiscal.requiresCustomer && (
                    <div className="col-span-2 text-[10px] text-slate-500">Este comprobante requiere nombre y RNC/Cédula válido.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Payment methods */}
          <div className="grid grid-cols-2 gap-1.5">
            {PAYMENT_METHODS.map(m => (
              <button key={m} onClick={() => dispatch({ type: 'SET_PAYMENT', payload: m })}
                className={`py-2 rounded-lg text-xs font-semibold border transition-all ${
                  selectedPayment === m ? 'bg-[#00e5a0]/10 border-[#00e5a0]/30 text-[#00e5a0]' : 'bg-[#1a2848] border-white/10 text-slate-400 hover:border-white/25'
                }`}>{m}</button>
            ))}
          </div>

          {/* Amount received (efectivo) */}
          {selectedPayment === 'Efectivo' && cart.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <input
                  className="input flex-1 text-sm py-2 font-mono"
                  type="number" placeholder="Monto recibido..."
                  value={amountReceived} onChange={e => setAmountReceived(e.target.value)}
                />
              </div>
              {amountReceived && parseFloat(amountReceived) >= total && (
                <div className="flex justify-between text-sm font-bold px-1">
                  <span className="text-slate-400">Cambio:</span>
                  <span className="text-[#00e5a0] font-mono text-base">{fmt(change)}</span>
                </div>
              )}
              {amountReceived && parseFloat(amountReceived) < total && (
                <div className="text-xs text-red-400 text-center">Monto insuficiente — faltan {fmt(total - parseFloat(amountReceived))}</div>
              )}
            </div>
          )}

          {/* Credit field - shown when customer is selected */}
          {selectedCustomer && (
            <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 space-y-2">
              <div className="text-xs font-bold text-red-400 uppercase tracking-wider">Credito / Deuda</div>
              {customerCredit > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Deuda actual:</span>
                  <span className="text-red-400 font-mono font-bold">{fmt(customerCredit)}</span>
                </div>
              )}
              <input
                className="input w-full text-sm py-2 font-mono"
                type="number"
                placeholder="Monto a dejar a credito (RD$)..."
                value={creditAmount}
                onChange={e => setCreditAmount(e.target.value)}
              />
              {creditAmount && parseFloat(creditAmount) > 0 && (
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-400">Nueva deuda total:</span>
                  <span className="text-red-400 font-mono">{fmt(customerCredit + parseFloat(creditAmount))}</span>
                </div>
              )}
              {/* Pay existing debt */}
              {customerCredit > 0 && cart.length === 0 && (
                <div className="pt-1 border-t border-white/10">
                  <div className="text-xs text-slate-400 mb-1">Abonar a deuda existente:</div>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 text-sm py-1.5 font-mono"
                      type="number"
                      placeholder={`Max: ${customerCredit}`}
                      id="debt-payment"
                    />
                    <button
                      onClick={() => {
                        const payment = parseFloat(document.getElementById('debt-payment').value)
                        if (isNaN(payment) || payment <= 0) return toast.error('Monto invalido')
                        if (payment > customerCredit) return toast.error(`Maximo: ${fmt(customerCredit)}`)
                        const newBalance = customerCredit - payment
                        // Update customer credit balance
                        dispatch({ type: 'UPDATE_CUSTOMER', payload: { ...selectedCustomer, creditBalance: newBalance } })
                        // Register payment in cash session
                        dispatch({ type: 'UPDATE_CASH_SALES', payload: {
                          id:         genId('cp'),
                          amount:     payment,
                          customerId: selectedCustomer.id,
                          customerName: selectedCustomer.name,
                          concept:    `Abono credito — ${selectedCustomer.name}`,
                          date:       new Date().toISOString().split('T')[0],
                          time:       new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
                        }})
                        toast.success(`Abono de ${fmt(payment)} registrado en caja. Deuda restante: ${fmt(newBalance)}`)
                        document.getElementById('debt-payment').value = ''
                      }}
                      className="btn-primary text-xs px-3 whitespace-nowrap"
                    >
                      Abonar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cobrar button */}
          <button onClick={handleCobrar} disabled={cart.length === 0}
            className={`w-full py-3 rounded-xl font-display font-bold text-sm transition-all duration-150 ${
              cart.length > 0 ? 'bg-neon-green text-[#080d18] hover:bg-emerald-400 active:scale-95' : 'bg-[#1a2848] text-slate-500 cursor-not-allowed'
            }`}>
            Cobrar {cart.length > 0 ? `— ${fmt(total)}` : ''}
          </button>
        </div>
        </div>
      </div>

      {showNewCustomerModal && (
        <QuickCustomerModal
          onClose={() => setShowNewCustomerModal(false)}
          onSave={handleCreateCustomer}
          saving={savingCustomer}
          customers={customers}
        />
      )}

      {completedSale && (
        <InvoiceModal sale={completedSale} onClose={() => setCompletedSale(null)} onNewSale={() => setCompletedSale(null)} />
      )}
    </>
  )
}

function QuickCustomerModal({ onClose, onSave, saving = false, customers = [] }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', code: makeCustomerCode(customers), notes: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="Nuevo Cliente" onClose={onClose} size="sm">
      <div className="space-y-3">
        <div>
          <label className="label">Nombre completo *</label>
          <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Juan Pérez" autoFocus />
        </div>
        <div className="form-row">
          <div>
            <label className="label">Teléfono</label>
            <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="809-555-0000" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.email} onChange={e => set('email', e.target.value)} placeholder="opcional" />
          </div>
        </div>
        <div>
          <label className="label">Código de cliente</label>
          <input className="input font-mono" value={form.code} onChange={e => set('code', e.target.value)} placeholder="Se genera automático" />
        </div>
        <div>
          <label className="label">Notas</label>
          <textarea className="input resize-none" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Preferencias, observaciones..." />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saving} onClick={async () => onSave(form)}>{saving ? 'Guardando...' : 'Registrar Cliente'}</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Discount Panel ────────────────────────────────────────────
function DiscountPanel({ discounts, isAdmin, onApply, onSave, newDiscount, setNewDiscount, editDiscount, setEditDiscount }) {
  const genId = () => `d_${Date.now()}`

  const handleAdd = () => {
    if (!newDiscount.name || !newDiscount.value) return toast.error('Completa nombre y valor')
    const list = [...discounts, { id: genId(), ...newDiscount, value: parseFloat(newDiscount.value) }]
    onSave(list)
    setNewDiscount({ name: '', type: 'porcentaje', value: '' })
    toast.success('Descuento creado')
  }

  const handleEdit = () => {
    const list = discounts.map(d => d.id === editDiscount.id ? { ...editDiscount, value: parseFloat(editDiscount.value) } : d)
    onSave(list)
    setEditDiscount(null)
    toast.success('Descuento actualizado')
  }

  const handleDelete = (id) => {
    onSave(discounts.filter(d => d.id !== id))
    toast.success('Descuento eliminado')
  }

  return (
    <div className="bg-[#0c1424] border border-red-500/20 rounded-xl p-3 space-y-2">
      <div className="text-xs font-bold text-red-400 uppercase tracking-wider">Descuentos disponibles</div>

      {discounts.length === 0 && <div className="text-xs text-slate-500 text-center py-2">Sin descuentos creados</div>}

      {discounts.map(d => (
        <div key={d.id} className="flex items-center gap-2">
          {editDiscount?.id === d.id ? (
            <>
              <input className="input flex-1 text-xs py-1" value={editDiscount.name} onChange={e => setEditDiscount(ed => ({ ...ed, name: e.target.value }))} />
              <input className="input w-16 text-xs py-1 font-mono" type="number" value={editDiscount.value} onChange={e => setEditDiscount(ed => ({ ...ed, value: e.target.value }))} />
              <select className="select text-xs py-1" value={editDiscount.type} onChange={e => setEditDiscount(ed => ({ ...ed, type: e.target.value }))}>
                <option value="porcentaje">%</option>
                <option value="fijo">RD$</option>
              </select>
              <button onClick={handleEdit} className="text-xs text-[#00e5a0] hover:underline">OK</button>
              <button onClick={() => setEditDiscount(null)} className="text-xs text-slate-500">x</button>
            </>
          ) : (
            <>
              <button onClick={() => onApply(d)} className="flex-1 text-left text-xs py-1.5 px-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-all">
                {d.name} — {d.type === 'porcentaje' ? `${d.value}%` : fmt(d.value)}
              </button>
              {isAdmin && (
                <>
                  <button onClick={() => setEditDiscount(d)} className="text-xs text-slate-400 hover:text-[#00e5a0]">✎</button>
                  <button onClick={() => handleDelete(d.id)} className="text-xs text-slate-400 hover:text-red-400">✕</button>
                </>
              )}
            </>
          )}
        </div>
      ))}

      {isAdmin && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-xs text-slate-500 font-semibold">Crear descuento</div>
          <input className="input w-full text-xs py-1.5" placeholder="Nombre del descuento" value={newDiscount.name} onChange={e => setNewDiscount(d => ({ ...d, name: e.target.value }))} />
          <div className="flex gap-1">
            <input className="input flex-1 text-xs py-1 font-mono" type="number" placeholder="Valor" value={newDiscount.value} onChange={e => setNewDiscount(d => ({ ...d, value: e.target.value }))} />
            <select className="select text-xs py-1 w-16" value={newDiscount.type} onChange={e => setNewDiscount(d => ({ ...d, type: e.target.value }))}>
              <option value="porcentaje">%</option>
              <option value="fijo">RD$</option>
            </select>
          </div>
          <button onClick={handleAdd} className="btn-primary w-full text-xs py-1.5">+ Crear Descuento</button>
        </div>
      )}
    </div>
  )
}

// ── Service Panel ─────────────────────────────────────────────
function ServicePanel({ services, isAdmin, onAdd, onSave, newService, setNewService, editService, setEditService }) {
  const genId = () => `s_${Date.now()}`

  const handleAdd = () => {
    if (!newService.name || !newService.price) return toast.error('Completa nombre y precio')
    const list = [...services, { id: genId(), name: newService.name, price: parseFloat(newService.price) }]
    onSave(list)
    setNewService({ name: '', price: '' })
    toast.success('Servicio creado')
  }

  const handleEdit = () => {
    const list = services.map(s => s.id === editService.id ? { ...editService, price: parseFloat(editService.price) } : s)
    onSave(list)
    setEditService(null)
    toast.success('Servicio actualizado')
  }

  const handleDelete = (id) => {
    onSave(services.filter(s => s.id !== id))
    toast.success('Servicio eliminado')
  }

  return (
    <div className="bg-[#0c1424] border border-[#f59e0b]/20 rounded-xl p-3 space-y-2">
      <div className="text-xs font-bold text-[#f59e0b] uppercase tracking-wider">Servicios disponibles</div>

      {services.length === 0 && <div className="text-xs text-slate-500 text-center py-2">Sin servicios creados</div>}

      {services.map(s => (
        <div key={s.id} className="flex items-center gap-2">
          {editService?.id === s.id ? (
            <>
              <input className="input flex-1 text-xs py-1" value={editService.name} onChange={e => setEditService(es => ({ ...es, name: e.target.value }))} />
              <input className="input w-20 text-xs py-1 font-mono" type="number" value={editService.price} onChange={e => setEditService(es => ({ ...es, price: e.target.value }))} />
              <button onClick={handleEdit} className="text-xs text-[#00e5a0] hover:underline">OK</button>
              <button onClick={() => setEditService(null)} className="text-xs text-slate-500">x</button>
            </>
          ) : (
            <>
              <button onClick={() => onAdd(s)} className="flex-1 text-left text-xs py-1.5 px-2 rounded-lg bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#fbbf24] hover:bg-[#f59e0b]/20 transition-all">
                {s.name} — {fmt(s.price)}
              </button>
              {isAdmin && (
                <>
                  <button onClick={() => setEditService(s)} className="text-xs text-slate-400 hover:text-[#00e5a0]">✎</button>
                  <button onClick={() => handleDelete(s.id)} className="text-xs text-slate-400 hover:text-red-400">✕</button>
                </>
              )}
            </>
          )}
        </div>
      ))}

      {isAdmin && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-xs text-slate-500 font-semibold">Crear servicio</div>
          <div className="flex gap-1">
            <input className="input flex-1 text-xs py-1" placeholder="Nombre del servicio" value={newService.name} onChange={e => setNewService(s => ({ ...s, name: e.target.value }))} />
            <input className="input w-24 text-xs py-1 font-mono" type="number" placeholder="Precio" value={newService.price} onChange={e => setNewService(s => ({ ...s, price: e.target.value }))} />
          </div>
          <button onClick={handleAdd} className="btn-primary w-full text-xs py-1.5">+ Crear Servicio</button>
        </div>
      )}
    </div>
  )
}
