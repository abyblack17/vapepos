import pako from 'pako'
import { getBytes, ref } from 'firebase/storage'
import { storage } from '../config/firebase'

// Servicio de consulta local de RNC/Cédula DGII para VapePOS
// Descarga la base comprimida desde Firebase Storage
// y luego todas las búsquedas se hacen localmente sin gastar lecturas de Firestore.

const RNC_VERSION_PATH = 'rnc/rnc_version.json'
const RNC_DATABASE_PATH = 'rnc/rnc_database.json.gz'

const DB_NAME = 'vapepos_rnc_db'
const DB_VERSION = 1
const STORE_NAME = 'rnc_store'
const META_KEY = 'meta'
const DATA_KEY = 'data'

let memoryCache = null
let syncPromise = null

export function normalizeRnc(value = '') {
  return String(value).replace(/\D/g, '').trim()
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbGet(key) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

async function idbSet(key, value) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.put(value, key)
    tx.oncomplete = () => { db.close(); resolve(true) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function fetchJson(path) {
  const bytes = await getBytes(ref(storage, path), 1024 * 1024)
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function fetchGzipJson(path) {
  try {
    const buffer = await getBytes(ref(storage, path), 100 * 1024 * 1024)

    const decompressedText = pako.ungzip(
      new Uint8Array(buffer),
      { to: 'string' }
    )

    return JSON.parse(decompressedText)
  } catch (error) {
    console.error('Error descomprimiendo base RNC:', error)
    throw new Error('No se pudo descomprimir la base RNC.')
  }
}

async function getRemoteVersion() {
  const version = await fetchJson(RNC_VERSION_PATH)
  return version || {}
}

function sameVersion(localMeta, remoteMeta) {
  if (!localMeta || !remoteMeta) return false
  return String(localMeta.version || '') === String(remoteMeta.version || '') &&
         Number(localMeta.count || 0) === Number(remoteMeta.count || 0)
}

export async function ensureRncDatabase({ force = false } = {}) {
  if (syncPromise) return syncPromise

  syncPromise = (async () => {
    const localMeta = await idbGet(META_KEY)
    const localData = memoryCache || await idbGet(DATA_KEY)

    let remoteMeta = null
    try {
      remoteMeta = await getRemoteVersion()
    } catch (error) {
      // Si no hay internet pero existe base local, seguimos trabajando offline.
      if (localData) {
        memoryCache = localData
        return { status: 'offline-local', meta: localMeta, count: Object.keys(localData || {}).length }
      }
      throw error
    }

    if (!force && localData && sameVersion(localMeta, remoteMeta)) {
      memoryCache = localData
      return { status: 'ready', meta: localMeta, count: Object.keys(localData || {}).length }
    }

    const payload = await fetchGzipJson(RNC_DATABASE_PATH)
    const data = payload?.data || payload || {}
    const meta = {
      ...(payload?.meta || {}),
      ...remoteMeta,
      downloadedAt: new Date().toISOString(),
    }

    await idbSet(DATA_KEY, data)
    await idbSet(META_KEY, meta)
    memoryCache = data

    return { status: 'updated', meta, count: Object.keys(data || {}).length }
  })()

  try {
    return await syncPromise
  } finally {
    syncPromise = null
  }
}

export async function lookupRnc(value) {
  const rnc = normalizeRnc(value)
  if (rnc.length < 9) return null

  if (!memoryCache) {
    const localData = await idbGet(DATA_KEY)
    if (localData) memoryCache = localData
  }

  if (!memoryCache) await ensureRncDatabase()

  const row = memoryCache?.[rnc]
  if (!row) return null

  // Formato optimizado actual: [razonSocial, nombreComercial, actividadEconomica, fechaConstitucion, estado, regimen]
  if (Array.isArray(row)) {
    return {
      rnc,
      razonSocial: row[0] || '',
      nombreComercial: row[1] || '',
      actividadEconomica: row[2] || '',
      fechaConstitucion: row[3] || '',
      estado: row[4] || '',
      regimen: row[5] || '',
    }
  }

  return {
    rnc,
    razonSocial: row.razonSocial || row.nombre || row.name || '',
    nombreComercial: row.nombreComercial || row.comercial || '',
    actividadEconomica: row.actividadEconomica || row.actividad || '',
    fechaConstitucion: row.fechaConstitucion || '',
    estado: row.estado || '',
    regimen: row.regimen || '',
  }
}
