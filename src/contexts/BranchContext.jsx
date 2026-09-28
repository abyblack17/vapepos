import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from '../config/firebase'
import { useAuth } from './AuthContext'

const BranchContext = createContext(null)
const TEST_OWNER_EMAIL = 'test01@gmail.com'
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

  const testOwner = currentUser?.email?.toLowerCase() === TEST_OWNER_EMAIL
  const branchesEnabled = testOwner || storedBranches.length > 0
  const branches = useMemo(() => {
    const hasMain = storedBranches.some(branch => branch.id === 'main' || branch.isMain)
    return hasMain ? storedBranches : [mainBranch, ...storedBranches]
  }, [storedBranches])

  useEffect(() => {
    if (!businessId) return
    setSelectedBranchIdState(localStorage.getItem(storageKey) || 'main')
    async function loadBranches() {
      setLoadingBranches(true)
      try {
        const snap = await getDocs(query(collection(db, 'businesses', businessId, 'branches'), orderBy('createdAt', 'asc')))
        setStoredBranches(snap.docs.map(item => ({ id: item.id, ...item.data() })))
      } catch (error) {
        console.warn('No se pudieron cargar las sucursales:', error.message)
        setStoredBranches([])
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
    if (!businessId || currentUser?.role !== 'Administrador') throw new Error('Solo el administrador puede crear sucursales.')
    const additional = storedBranches.filter(branch => !branch.isMain).length
    if (additional >= MAX_ADDITIONAL_BRANCHES) throw new Error('El negocio ya alcanzó el máximo de 5 sucursales adicionales.')
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('Escribe el nombre de la sucursal.')
    const fn = httpsCallable(getFunctions(), 'manageTestBranch')
    const result = await fn({ action: 'create', name: cleanName, address, phone })
    const created = result.data?.branch
    if (!created?.id) throw new Error('No se pudo crear la sucursal.')
    setStoredBranches(current => [...current, created])
    return created
  }

  const setBranchActive = async (branchId, active) => {
    const branch = storedBranches.find(item => item.id === branchId)
    if (!branch || branch.isMain) throw new Error('La sucursal principal no puede suspenderse.')
    const fn = httpsCallable(getFunctions(), 'manageTestBranch')
    await fn({ action: 'setActive', branchId, active })
    setStoredBranches(current => current.map(item => item.id === branchId ? { ...item, active } : item))
    if (!active && selectedBranchId === branchId) selectBranch('main')
  }

  const activeAdditionalBranches = branches.filter(branch => !branch.isMain && branch.active !== false)
  const selectedBranch = branches.find(branch => branch.id === selectedBranchId) || mainBranch

  return <BranchContext.Provider value={{
    branchesEnabled, loadingBranches, branches, selectedBranch, selectedBranchId,
    selectBranch, createBranch, setBranchActive,
    activeAdditionalCount: activeAdditionalBranches.length,
    monthlyBranchCost: activeAdditionalBranches.length * BRANCH_MONTHLY_PRICE,
  }}>{children}</BranchContext.Provider>
}

export function useBranches() {
  const value = useContext(BranchContext)
  if (!value) throw new Error('useBranches must be used within BranchProvider')
  return value
}
