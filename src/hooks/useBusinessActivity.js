import { useEffect } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '../contexts/AuthContext'

export default function useBusinessActivity() {
  const { currentUser, isAuthenticated } = useAuth()
  useEffect(() => {
    if (!isAuthenticated || !currentUser?.businessId || currentUser.role === 'superadmin') return
    let lastAttempt = 0
    let busy = false
    const record = httpsCallable(getFunctions(), 'recordBusinessActivity')
    const activity = () => {
      if (busy || document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastAttempt < 5 * 60000) return
      busy = true
      lastAttempt = Date.now()
      record({}).catch(error => {
        lastAttempt = Date.now() - 4 * 60000
        console.warn('Actividad pendiente:', error.code)
      }).finally(() => { busy = false })
    }
    activity()
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart']
    events.forEach(event => window.addEventListener(event, activity, { passive: true }))
    window.addEventListener('online', activity)
    document.addEventListener('visibilitychange', activity)
    return () => {
      events.forEach(event => window.removeEventListener(event, activity))
      window.removeEventListener('online', activity)
      document.removeEventListener('visibilitychange', activity)
    }
  }, [isAuthenticated, currentUser?.id, currentUser?.businessId, currentUser?.role])
}
