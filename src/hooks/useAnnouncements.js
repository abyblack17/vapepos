import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from '../contexts/AuthContext'

const announcementTime = announcement => {
  const value = announcement?.createdAt
  if (value?.toMillis) return value.toMillis()
  if (value?.seconds) return value.seconds * 1000
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function useAnnouncements() {
  const { businessId, currentUser } = useAuth()
  const [announcements, setAnnouncements] = useState([])
  const [seenIds, setSeenIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!businessId) {
      setAnnouncements([])
      setSeenIds(new Set())
      setLoading(false)
      return undefined
    }

    setLoading(true)
    setError(null)
    let announcementsReady = false
    let readsReady = false
    const finishLoading = () => {
      if (announcementsReady && readsReady) setLoading(false)
    }

    const unsubscribeAnnouncements = onSnapshot(
      query(collection(db, 'system_announcements'), where('active', '==', true)),
      snapshot => {
        setAnnouncements(snapshot.docs
          .map(item => ({ id: item.id, ...item.data() }))
          .sort((a, b) => announcementTime(b) - announcementTime(a)))
        announcementsReady = true
        finishLoading()
      },
      snapshotError => {
        console.error('No se pudieron cargar los anuncios:', snapshotError)
        setError('No se pudieron cargar los anuncios. La aplicación volverá a intentarlo automáticamente.')
        announcementsReady = true
        finishLoading()
      },
    )

    const unsubscribeReads = onSnapshot(
      collection(db, 'businesses', businessId, 'announcement_reads'),
      snapshot => {
        setSeenIds(new Set(snapshot.docs.map(item => item.id)))
        readsReady = true
        finishLoading()
      },
      snapshotError => {
        console.error('No se pudieron cargar los anuncios vistos:', snapshotError)
        setError('No se pudo comprobar cuáles anuncios fueron vistos.')
        readsReady = true
        finishLoading()
      },
    )

    return () => {
      unsubscribeAnnouncements()
      unsubscribeReads()
    }
  }, [businessId])

  const unreadAnnouncements = useMemo(
    () => announcements.filter(announcement => !seenIds.has(announcement.id)),
    [announcements, seenIds],
  )

  const markAsSeen = async announcementId => {
    if (!businessId || !currentUser?.id || !announcementId) throw new Error('No se pudo identificar el negocio o el usuario.')
    await setDoc(doc(db, 'businesses', businessId, 'announcement_reads', announcementId), {
      businessId,
      announcementId,
      readAt: serverTimestamp(),
      readBy: currentUser.id,
      readByName: currentUser.name || currentUser.email || 'Usuario',
    })
  }

  return { announcements: unreadAnnouncements, loading, error, markAsSeen }
}
