import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, db } from '../config/firebase'

const AuthContext = createContext(null)

async function fetchUserProfile(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) return { uid, ...snap.data() }
    return null
  } catch {
    return null
  }
}

async function fetchBusiness(businessId) {
  try {
    const snap = await getDoc(doc(db, 'businesses', businessId))
    if (snap.exists()) return { id: snap.id, ...snap.data() }
    return null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [authUser,    setAuthUser]    = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [business,    setBusiness]    = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setAuthUser(null)
        setUserProfile(null)
        setBusiness(null)
        setLoading(false)
        return
      }

      setAuthUser(firebaseUser)

      // Reintenta hasta 8 veces con 2s entre intentos
      // La Cloud Function puede tardar en escribir en Firestore
      let profile = null
      for (let i = 0; i < 8; i++) {
        profile = await fetchUserProfile(firebaseUser.uid)
        if (profile) break
        await new Promise(r => setTimeout(r, 2000))
      }

      if (!profile) {
        await signOut(auth)
        setError('Cuenta no encontrada. Intenta registrarte de nuevo.')
        setLoading(false)
        return
      }

      if (!profile.active) {
        await signOut(auth)
        setError('Tu cuenta ha sido desactivada.')
        setLoading(false)
        return
      }

      try {
        const syncClaims = httpsCallable(getFunctions(), 'syncMyAccessClaims')
        await syncClaims()
        await firebaseUser.getIdToken(true)
      } catch (claimError) {
        console.error('No se pudieron actualizar los permisos de Storage:', claimError)
        await signOut(auth)
        setError('No se pudieron validar los permisos de almacenamiento. Vuelve a iniciar sesión.')
        setLoading(false)
        return
      }

      setUserProfile(profile)

      // Superadmin no tiene negocio asociado
      if (profile.role === 'superadmin') {
        setLoading(false)
        return
      }

      if (!profile.businessId) {
        await signOut(auth)
        setError('No tienes un negocio asociado.')
        setLoading(false)
        return
      }

      const biz = await fetchBusiness(profile.businessId)
      if (!biz) {
        await signOut(auth)
        setError('Negocio no encontrado.')
        setLoading(false)
        return
      }

      setBusiness(biz)
      setLoading(false)
    })

    return unsub
  }, [])

  // ── Login ────────────────────────────────────────────────
  const login = async (email, password) => {
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      return { success: true }
    } catch (err) {
      const msg = getAuthErrorMessage(err.code)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // ── Register — Cloud Function + auto-login ───────────────
  // La Function crea el usuario en Auth y el perfil en Firestore.
  // Luego hace sign in automaticamente — el usuario entra directo.
  const registerBusiness = async ({ email, password, ownerName, businessName, phone, address }) => {
    setError(null)
    try {
      const fns        = getFunctions()
      const registerFn = httpsCallable(fns, 'registerBusiness')

      const result = await registerFn({
        email:        email.trim().toLowerCase(),
        password,
        ownerName:    ownerName.trim(),
        businessName: businessName.trim(),
        phone:        phone?.trim()   || '',
        address:      address?.trim() || '',
      })

      if (!result.data?.success) {
        throw new Error(result.data?.message || 'Error al crear el negocio')
      }

      // Esperar a que Firestore propague los documentos
      await new Promise(r => setTimeout(r, 3000))

      // Auto-login — el usuario entra directo sin tener que loguearse
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)

      return { success: true, businessId: result.data.businessId }

    } catch (err) {
      const msg = err.message || 'Error al crear el negocio.'
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // ── Add employee ─────────────────────────────────────────
  const addEmployee = async ({ email, password, displayName, role }) => {
    try {
      const fns    = getFunctions()
      const fn     = httpsCallable(fns, 'addEmployeeToStore')
      const result = await fn({ email, password, displayName, role })
      return { success: true, ...result.data }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ── Update role ──────────────────────────────────────────
  const updateUserRole = async (targetUid, newRole) => {
    try {
      const fns = getFunctions()
      const fn  = httpsCallable(fns, 'updateUserRole')
      await fn({ targetUid, newRole })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  const updateUserPermissions = async (targetUid, permissions) => {
    try {
      const fns = getFunctions()
      const fn = httpsCallable(fns, 'updateUserPermissions')
      const result = await fn({ targetUid, permissions })
      return { success: true, permissions: result.data?.permissions || permissions }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ── Deactivate user ──────────────────────────────────────
  const deactivateUser = async (targetUid) => {
    try {
      const fns = getFunctions()
      const fn  = httpsCallable(fns, 'deactivateUser')
      await fn({ targetUid })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ── Delete user — nueva funcion ──────────────────────────
  const deleteUser = async (targetUid) => {
    try {
      const fns = getFunctions()
      const fn  = httpsCallable(fns, 'deleteUser')
      await fn({ targetUid })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ── Logout ───────────────────────────────────────────────
  const logout = async () => {
    await signOut(auth)
    setUserProfile(null)
    setBusiness(null)
    setError(null)
  }

  // ── Reset password ───────────────────────────────────────
  const resetPassword = async (email) => {
    try {
      await sendPasswordResetEmail(auth, email)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  const businessId = userProfile?.businessId || null

  const currentUser = userProfile ? {
    id:          authUser?.uid,
    uid:         authUser?.uid,
    name:        userProfile.displayName,
    email:       userProfile.email,
    role:        userProfile.role,
    businessId:  userProfile.businessId,
    active:      userProfile.active,
    permissions: userProfile.permissions || null,
    theme:       userProfile.theme || 'dark',
  } : null

  const isAuthenticated = !!authUser && !!userProfile && (!!businessId || userProfile?.role === 'superadmin')

  return (
    <AuthContext.Provider value={{
      authUser, currentUser, userProfile, business,
      businessId, loading, error, isAuthenticated,
      login, logout, registerBusiness,
      addEmployee, updateUserRole, updateUserPermissions, deactivateUser, deleteUser,
      resetPassword, setError,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

function getAuthErrorMessage(code) {
  const messages = {
    'auth/user-not-found':         'No existe una cuenta con ese correo.',
    'auth/wrong-password':         'Contrasena incorrecta.',
    'auth/invalid-email':          'Correo electronico invalido.',
    'auth/user-disabled':          'Esta cuenta ha sido desactivada.',
    'auth/email-already-in-use':   'Ya existe una cuenta con ese correo.',
    'auth/weak-password':          'La contrasena debe tener al menos 6 caracteres.',
    'auth/too-many-requests':      'Demasiados intentos. Intenta mas tarde.',
    'auth/invalid-credential':     'Credenciales invalidas.',
    'auth/network-request-failed': 'Error de conexion.',
  }
  return messages[code] || 'Error de autenticacion. Intenta de nuevo.'
}
