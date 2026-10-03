let database
export function openOfflineStore() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('vapepos-offline-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('records')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = null; reject(request.error) }
  })
  return database
}
export async function readLocal(key) {
  const db = await openOfflineStore()
  return new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function writeLocal(key, value) {
  const db = await openOfflineStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    if (value === undefined) tx.objectStore('records').delete(key)
    else tx.objectStore('records').put(value, key)
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}
export async function listOperations() {
  const db = await openOfflineStore()
  return new Promise((resolve, reject) => {
    const values = []
    const request = db.transaction('records').objectStore('records').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return resolve(values.sort((a, b) => (a.sequence || a.createdAt) - (b.sequence || b.createdAt)))
      if (String(cursor.key).startsWith('operation:')) values.push(cursor.value)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}
export async function enqueueLocal(operation, projection) {
  const db = await openOfflineStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    const records = tx.objectStore('records')
    const next = records.get('queue-sequence')
    next.onsuccess = () => {
      operation.sequence = Number(next.result || 0) + 1
      records.put(operation.sequence, 'queue-sequence')
      records.put(operation, `operation:${operation.id}`)
      if (projection) records.put(projection.state, projection.key)
    }
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}
export async function preserveForReview(operation) {
  const db = await openOfflineStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite')
    const records = tx.objectStore('records')
    records.put({ ...operation, reviewRequired: true, archivedAt: Date.now() }, `review:${operation.id}`)
    records.delete(`operation:${operation.id}`)
    tx.oncomplete = resolve
    tx.onabort = () => reject(tx.error)
    tx.onerror = () => reject(tx.error)
  })
}
export async function listReviewOperations() {
  const db = await openOfflineStore()
  return new Promise((resolve, reject) => {
    const rows = [], request = db.transaction('records').objectStore('records').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return resolve(rows)
      if (String(cursor.key).startsWith('review:')) rows.push(cursor.value)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}
