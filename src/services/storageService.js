import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import app from '../config/firebase'

const storage = getStorage(app)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const UPLOAD_TIMEOUT_MS = 30000

function cleanSegment(value, fallback = 'item') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80)
}

function getExtension(file) {
  const fromName = file?.name?.split('.').pop()?.toLowerCase()
  if (fromName && fromName !== file.name) return fromName

  const fromType = file?.type?.split('/').pop()?.toLowerCase()
  if (fromType === 'jpeg') return 'jpg'
  if (fromType) return fromType

  return 'jpg'
}

function validateImageFile(file, maxSize = MAX_IMAGE_SIZE) {
  if (!file) throw new Error('No se seleccionó ninguna imagen.')
  if (!file.type?.startsWith('image/')) throw new Error('El archivo seleccionado no es una imagen válida.')
  if (file.size > maxSize) throw new Error('La imagen no puede superar 5MB.')
}

async function withTimeout(promise, message = 'La subida tardó demasiado. Revisa tu conexión e intenta de nuevo.') {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), UPLOAD_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

async function uploadImage({ businessId, folder, itemId, file }) {
  validateImageFile(file)

  if (!businessId) {
    throw new Error('No se encontró el negocio activo. Cierra sesión y vuelve a entrar.')
  }

  const safeFolder = cleanSegment(folder, 'images')
  const safeItemId = cleanSegment(itemId, `temp_${Date.now()}`)
  const ext = getExtension(file)
  const filename = `${Date.now()}_${cleanSegment(file.name || 'image')}.${ext}`
  const path = `businesses/${cleanSegment(businessId)}/${safeFolder}/${safeItemId}/${filename}`
  const storageRef = ref(storage, path)

  const snapshot = await withTimeout(uploadBytes(storageRef, file, {
    contentType: file.type || 'image/jpeg',
    customMetadata: {
      businessId: String(businessId),
      itemId: String(itemId || safeItemId),
      uploadedAt: new Date().toISOString(),
    },
  }))

  return getDownloadURL(snapshot.ref)
}

export async function uploadProductImage(businessId, productId, file) {
  return uploadImage({ businessId, folder: 'products', itemId: productId, file })
}

export async function uploadLiquidImage(businessId, liquidId, file) {
  return uploadImage({ businessId, folder: 'liquids', itemId: liquidId, file })
}

export async function uploadBusinessLogo(businessId, file) {
  validateImageFile(file)

  if (!businessId) {
    throw new Error('No se encontró el negocio activo. Cierra sesión y vuelve a entrar.')
  }

  const ext = getExtension(file)
  const path = `businesses/${cleanSegment(businessId)}/logo/logo_${Date.now()}.${ext}`
  const storageRef = ref(storage, path)
  const snapshot = await withTimeout(uploadBytes(storageRef, file, {
    contentType: file.type || 'image/jpeg',
  }))

  return getDownloadURL(snapshot.ref)
}

export async function deleteImage(path) {
  try {
    const storageRef = ref(storage, path)
    await deleteObject(storageRef)
    return true
  } catch {
    return false
  }
}
