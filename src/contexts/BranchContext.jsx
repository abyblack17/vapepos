import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../config/firebase'
import { useAuth } from './AuthContext'
import { readLocal, writeLocal } from '../services/offlineStore'

export const BranchContext = createContext(null)
export const MAX_ADDITIONAL_BRANCHES = 5
export const BRANCH_MONTHLY_PRICE = 300

const mainBranch = {
  id: 'main', name: 'Sucursal principal', code: 'PRINCIPAL', isMain: true,
  active: true, monthlyPrice: 0,
}

export function BranchProvider({ children }) {
  const { businessId, currentUser } = useAuth()
  const [storedBranches, setStoredBranches] = useState([])
  const [loadingBranches, setLoadingBranches] = useState(true)
  const storageKey = businessId ? `vapepos_branch_${businessId}` : 'vapepos_branch'
  const [selectedBranchId, setSelectedBranchIdState] = useState('main')

  const canManageBranches = currentUser?.role === 'Administrador' || (currentUser?.role === 'Encargado' && currentUser?.permissions?.branches === true)
  const branchesEnabled = canManageBranches || storedBranches.length > 0
  const allBranches = useMemo(() => {
    const hasMain = storedBranches.some(branch => branch.id === 'main' || branch.isMain)
    return hasMain ? storedBranches : [mainBranch, ...storedBranches]
  }, [storedBranches])
  const branches = useMemo(() => {
    if (canManageBranches) return allBranches
    const assigned = Array.isArray(currentUser?.branchIds) ? currentUser.branchIds : []
    return allBranches.filter(branch => assigned.includes(branch.id))
  }, [allBranches, canManageBranches, currentUser?.branchIds])

  useEffect(() => {
    if (!businessId) return
    setSelectedBranchIdState(localStorage.getItem(storageKey) || 'main')
    async function loadBranches() {
      setLoadingBranches(true)
      const cached = await readLocal(`branches:${businessId}`).catch(() => null)
      if (cached) { setStoredBranches(cached); setLoadingBranches(false) }
      if (!navigator.onLine) { setLoadingBranches(false); return }
      try {
        const snap = await getDocs(query(collection(db, 'businesses', businessId, 'branches'), orderBy('createdAt', 'asc')))
        const rows = snap.docs.map(item => ({ id: item.id, ...item.data() }))
        setStoredBranches(rows)
        await writeLocal(`branches:${businessId}`, rows)
      } catch (error) {
        console.warn('No se pudieron cargar las sucursales:', error.message)
        if (!cached) setStoredBranches([])
      } finally {
        setLoadingBranches(false)
      }
    }
    loadBranches()
  }, [businessId, storageKey])

  useEffect(() => {
    if (!branches.some(branch => branch.id === selectedBranchId && branch.active !== false)) {
      setSelectedBranchIdState('main')
      if (businessId) localStorage.setItem(storageKey, 'main')
    }
  }, [branches, selectedBranchId, businessId, storageKey])

  const selectBranch = (branchId) => {
    const target = branches.find(branch => branch.id === branchId && branch.active !== false)
    if (!target) return false
    setSelectedBranchIdState(branchId)
    localStorage.setItem(storageKey, branchId)
    return true
  }

  const createBranch = async ({ name, address = '', phone = '' }) => {
    if (!businessId || !canManageBranches) throw new Error('No tienes permiso para crear sucursales.')
    const additional = storedBranches.filter(branch => !branch.isMain).length
    if (additional >= MAX_ADDITIONAL_BRANCHES) throw new Error('El negocio ya alcanzó el máximo de 5 sucursales adicionales.')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('Escribe el nombre de la sucursal.')
    const fn = httpsCallable(getFunctions(), 'manageBranch')
    const result = await fn({ action: 'create', name: cleanName, address, phone })
    const created = result.data?.branch
    if (!created?.id) throw new Error('No se pudo crear la sucursal.')
    setStoredBranches(current => [...current, created])
    return created
  }

  const setBranchActive = async (branchId, active) => {
    if (!canManageBranches) throw new Error('No tienes permiso para administrar sucursales.')
    const branch = storedBranches.find(item => item.id === branchId)
    if (!branch || branch.isMain) throw new Error('La sucursal principal no puede suspenderse.')
    const fn = httpsCallable(getFunctions(), 'manageBranch')
    await fn({ action: 'setActive', branchId, active })
    setStoredBranches(current => current.map(item => item.id === branchId ? { ...item, active } : item))
    if (!active && selectedBranchId === branchId) selectBranch('main')
  }

  const assignUser = async (branchId, userId, assigned) => {
    if (!canManageBranches) throw new Error('No tienes permiso para asignar usuarios.')
    const fn = httpsCallable(getFunctions(), 'manageBranch')
    const result = await fn({ action: 'assignUser', branchId, userId, assigned })
    return result.data
  }

  const setUserBranch = async (userId, branchId) => {
    if (currentUser?.role !== 'Administrador') throw new Error('Solo el Administrador principal puede asignar empleados.')
    const fn = httpsCallable(getFunctions(), 'manageBranch')
    const result = await fn({ action: 'setUserBranch', userId, branchId })
    return result.data
  }

  const transferStock = async ({ itemType, itemId, sourceBranchId, targetBranchId, quantity }) => {
    if (!canManageBranches) throw new Error('No tienes permiso para transferir inventario.')
    const fn = httpsCallable(getFunctions(), 'manageBranch')
    const result = await fn({ action: 'transferStock', itemType, itemId, sourceBranchId, targetBranchId, quantity })
    return result.data
  }

  const activeAdditionalBranches = allBranches.filter(branch => !branch.isMain && branch.active !== false)
  const selectedBranch = branches.find(branch => branch.id === selectedBranchId) || mainBranch

  return <BranchContext.Provider value={{
    branchesEnabled, loadingBranches, branches, allBranches, selectedBranch, selectedBranchId, canManageBranches,
    selectBranch, createBranch, setBranchActive, assignUser, setUserBranch, transferStock,
    activeAdditionalCount: activeAdditionalBranches.length,
    monthlyBranchCost: activeAdditionalBranches.length * BRANCH_MONTHLY_PRICE,
  }}>{children}</BranchContext.Provider>
}

export function useBranches() {
  const value = useContext(BranchContext)
  if (!value) throw new Error('useBranches must be used within BranchProvider')
  return value
}
