import React, { createContext, useContext, useEffect, useState } from 'react'
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, db } from '../config/firebase'
import { readLocal, writeLocal } from '../services/offlineStore'
import { setSyncContext } from '../services/offlineSync'
import { trialExpired, trialDeadline } from '../config/trial'

export const AuthContext = createContext(null)

async function fetchUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  if (snap.exists()) return { uid, ...snap.data() }
  return null
}

async function fetchBusiness(businessId) {
  const snap = await getDoc(doc(db, 'businesses', businessId))
  if (snap.exists()) return { id: snap.id, ...snap.data() }
  return null
}

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

async function readWithRetry(read, { attempts = 8, delayMs = 2000, retryWhenEmpty = false, label }) {
  let lastError = null
  let lastValue = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      lastValue = await read()
      lastError = null
      if (lastValue || !retryWhenEmpty) return { value: lastValue, error: null }
    } catch (error) {
      lastError = error
      console.error(`${label}: intento ${attempt}/${attempts}`, error)
    }

    if (attempt < attempts) await wait(delayMs)
  }

  return { value: lastValue, error: lastError }
}

function getDataAccessErrorMessage(error) {
  const code = String(error?.code || '').replace(/^firestore\//, '')

  if (code === 'permission-denied' || code === 'unauthenticated') {
    return 'No pudimos validar el acceso de tu cuenta. Revisa tu conexion e intenta nuevamente. Si continua, comunicate con soporte.'
  }

  if (['unavailable', 'deadline-exceeded', 'resource-exhausted', 'cancelled', 'unknown'].includes(code)) {
    return 'No pudimos conectar con el servicio en este momento. Revisa tu internet y vuelve a intentarlo.'
  }

  return 'Ocurrio un problema temporal al cargar tu cuenta. Vuelve a intentarlo; tu cuenta no ha sido eliminada.'
}

export function AuthProvider({ children }) {
  const [authUser,    setAuthUser]    = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [business,    setBusiness]    = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [accessNow, setAccessNow] = useState(Date.now())

  useEffect(() => {
    const check = () => {
      const now = Date.now()
      setAccessNow(now)
      if (trialExpired(business, now)) setSyncContext(null)
    }
    check()
    const timer = setInterval(check, 30000)
    const remaining = trialDeadline(business) - Date.now()
    const expiryTimer = business?.licenseType === 'trial' && remaining > 0
      ? setTimeout(check, Math.min(remaining, 2147483647)) : null
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); clearTimeout(expiryTimer); window.removeEventListener('focus', check) }
  }, [business])

  useEffect(() => {
    let revision = 0
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      const currentRevision = ++revision
      if (!firebaseUser) {
        setSyncContext(null)
        setAuthUser(null)
        setUserProfile(null)
        setBusiness(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setAuthUser(firebaseUser)
      setUserProfile(null)
      setBusiness(null)
      setSyncContext(null)

      const cached = await readLocal(`session:${firebaseUser.uid}`).catch(() => null)
      if (currentRevision !== revision || auth.currentUser?.uid !== firebaseUser.uid) return
      if (cached?.profile?.active && (cached.business?.active !== false || trialExpired(cached.business)) && cached.profile.role !== 'superadmin') {
        setUserProfile(cached.profile)
        setBusiness(cached.business)
        setSyncContext(trialExpired(cached.business) ? null : { businessId: cached.profile.businessId, epoch: cached.business?.dataEpoch || 0 })
        setLoading(false)
        if (!navigator.onLine) return
      }
      // Short retries cover a newly registered profile without delaying returning users.
      const profileResult = await readWithRetry(
        () => fetchUserProfile(firebaseUser.uid),
        { attempts: cached ? 1 : 3, delayMs: 500, retryWhenEmpty: true, label: 'No se pudo leer el perfil del usuario' },
      )
      const profile = profileResult.value
      if (currentRevision !== revision || auth.currentUser?.uid !== firebaseUser.uid) return

      if (!profile) {
        if (profileResult.error && !/permission-denied|unauthenticated/.test(profileResult.error.code || '')) {
          if (cached) return
          setError(getDataAccessErrorMessage(profileResult.error))
          setLoading(false)
          return
        }
        await signOut(auth)
        setError(profileResult.error
          ? getDataAccessErrorMessage(profileResult.error)
          : 'La autenticacion existe, pero el perfil de esta cuenta no fue encontrado. Comunicate con soporte; no te registres nuevamente.')
        setLoading(false)
        return
      }

      if (!profile.active) {
        await writeLocal(`session:${firebaseUser.uid}`, undefined)
        setSyncContext(null)
        await signOut(auth)
        setError(profile.activationPending
          ? 'Tu cuenta está pendiente de activación. Nuestro equipo debe validar el servicio antes de que puedas entrar.'
          : 'Tu cuenta o negocio está suspendido. Comunícate con soporte para recibir asistencia.')
        setLoading(false)
        return
      }

      if (navigator.onLine) try {
        const syncClaims = httpsCallable(getFunctions(), 'syncMyAccessClaims')
        // Storage claims refresh in the background; it must not block opening the POS.
        syncClaims().then(() => firebaseUser.getIdToken(true)).catch(claimError => console.warn('Permisos de Storage pendientes:', claimError))
      } catch (claimError) {
        console.error('No se pudieron actualizar los permisos de Storage:', claimError)
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

      const businessResult = await readWithRetry(
        () => fetchBusiness(profile.businessId),
        { attempts: cached ? 1 : 2, delayMs: 500, retryWhenEmpty: true, label: 'No se pudo leer el negocio' },
      )
      const biz = businessResult.value
      if (currentRevision !== revision || auth.currentUser?.uid !== firebaseUser.uid) return
      if (!biz) {
        if (businessResult.error && cached && !/permission-denied|unauthenticated/.test(businessResult.error.code || '')) return
        await signOut(auth)
        setError(businessResult.error
          ? getDataAccessErrorMessage(businessResult.error)
          : 'Tu usuario existe, pero el negocio asociado no fue encontrado. Comunicate con soporte.')
        setLoading(false)
        return
      }

      if (biz.active === false && !trialExpired(biz)) {
        await writeLocal(`session:${firebaseUser.uid}`, undefined)
        setSyncContext(null)
        await signOut(auth)
        setError('El negocio está suspendido.')
        setLoading(false)
        return
      }
      await writeLocal(`session:${firebaseUser.uid}`, { profile, business: biz })
      setSyncContext(trialExpired(biz) ? null : { businessId: profile.businessId, epoch: biz.dataEpoch || 0 })
      setBusiness(biz)
      setLoading(false)
    })

    return () => { revision += 1; unsub() }
  }, [])

  useEffect(() => {
    if (!authUser || !userProfile?.businessId) return
    return onSnapshot(doc(db, 'businesses', userProfile.businessId), snapshot => {
      if (auth.currentUser?.uid !== authUser.uid) return
      if (snapshot.metadata.fromCache || !snapshot.exists()) return
      const value = { id: snapshot.id, ...snapshot.data() }
      if (value.active === false && !trialExpired(value)) {
        setSyncContext(null)
        writeLocal(`session:${authUser.uid}`, undefined).then(() => signOut(auth))
        setError('El negocio está suspendido.')
        return
      }
      setBusiness(value)
      writeLocal(`session:${authUser.uid}`, { profile: userProfile, business: value }).catch(console.error)
      setSyncContext(value.resetInProgress || trialExpired(value) ? null : { businessId: value.id, epoch: value.dataEpoch || 0 })
    }, error => console.warn('Validación del negocio pendiente:', error.message))
  }, [authUser?.uid, userProfile])

  useEffect(() => {
    if (!authUser) return
    return onSnapshot(doc(db, 'users', authUser.uid), snapshot => {
      if (snapshot.metadata.fromCache || auth.currentUser?.uid !== authUser.uid) return
      const profile = snapshot.data()
      if (!profile || profile.active !== true) {
        setSyncContext(null)
        writeLocal(`session:${authUser.uid}`, undefined).then(() => signOut(auth))
        setError('Tu cuenta ya no tiene acceso. Comunícate con el administrador.')
        return
      }
      setUserProfile({ uid: authUser.uid, ...profile })
    }, error => console.warn('Validación del usuario pendiente:', error.message))
  }, [authUser?.uid])

  // ── Login ────────────────────────────────────────────────
  const login = async (email, password) => {
    setError(null)
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase()
      await signInWithEmailAndPassword(auth, normalizedEmail, password)
      return { success: true }
    } catch (err) {
      const msg = getAuthErrorMessage(err.code)
      setError(msg)
      return { success: false, error: msg }
    }
  }

  // Registro con prueba activa e inicio de sesión automático.
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

      let autoLogin = true
      try {
        await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
      } catch {
        // El negocio ya existe: no volver a registrarlo si falla la conexión al entrar.
        autoLogin = false
      }
      return {
        success: true,
        businessId: result.data.businessId,
        autoLogin,
        activationPending: result.data.activationPending === true,
      }

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
    setSyncContext(null)
    await signOut(auth)
    setUserProfile(null)
    setBusiness(null)
    setError(null)
  }

  // ── Reset password ───────────────────────────────────────
  const resetPassword = async (email) => {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase()
      if (!normalizedEmail) return { success: false, error: 'Ingresa tu correo electronico.' }
      await sendPasswordResetEmail(auth, normalizedEmail)
      return { success: true }
    } catch (err) {
      // No confirmar públicamente si un correo está registrado.
      if (err.code === 'auth/user-not-found') return { success: true }
      return { success: false, error: getAuthErrorMessage(err.code) }
    }
  }

  const changeOwnPassword = async ({ currentPassword, newPassword }) => {
    const user = auth.currentUser
    if (!user?.email) return { success: false, error: 'No encontramos una sesión activa.' }
    if (!currentPassword) return { success: false, error: 'Ingresa tu contraseña actual.' }
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return { success: false, error: 'La contraseña nueva debe tener entre 8 y 128 caracteres.' }
    }
    if (currentPassword === newPassword) {
      return { success: false, error: 'La contraseña nueva debe ser diferente de la actual.' }
    }

    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
      return { success: true }
    } catch (err) {
      if (['auth/invalid-credential', 'auth/wrong-password'].includes(err.code)) {
        return { success: false, error: 'La contraseña actual es incorrecta.' }
      }
      if (err.code === 'auth/too-many-requests') {
        return { success: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.' }
      }
      if (err.code === 'auth/network-request-failed') {
        return { success: false, error: 'No se pudo conectar. Revisa tu internet e inténtalo nuevamente.' }
      }
      return { success: false, error: 'No se pudo cambiar la contraseña. Inténtalo nuevamente.' }
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
    branchIds:   Array.isArray(userProfile.branchIds) ? userProfile.branchIds : [],
    theme:       userProfile.theme || 'dark',
  } : null

  const isAuthenticated = !!authUser && !!userProfile && (!!businessId || userProfile?.role === 'superadmin')

  return (
    <AuthContext.Provider value={{
      authUser, currentUser, userProfile, business,
      businessId, loading, error, isAuthenticated, accessNow,
      login, logout, registerBusiness,
      addEmployee, updateUserRole, updateUserPermissions, deactivateUser, deleteUser,
      resetPassword, changeOwnPassword, setError,
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
