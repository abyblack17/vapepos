import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import app from '../config/firebase'

const storage = getStorage(app)

export async function uploadProductImage(businessId, productId, file) {
  try {
    const path = `businesses/${businessId}/products/${productId}`
    const storageRef = ref(storage, path)
    await uploadBytes(storageRef, file)
    const url = await getDownloadURL(storageRef)
    return url
  } catch (err) {
    console.warn('uploadProductImage failed:', err.message)
    return null
  }
}

export async function uploadLiquidImage(businessId, liquidId, file) {
  try {
    const path = `businesses/${businessId}/liquids/${liquidId}`
    const storageRef = ref(storage, path)
    await uploadBytes(storageRef, file)
    const url = await getDownloadURL(storageRef)
    return url
  } catch (err) {
    console.warn('uploadLiquidImage failed:', err.message)
    return null
  }
}

export async function uploadBusinessLogo(businessId, file) {
  try {
    const path = `businesses/${businessId}/logo`
    const storageRef = ref(storage, path)
    await uploadBytes(storageRef, file)
    const url = await getDownloadURL(storageRef)
    return url
  } catch (err) {
    console.warn('uploadBusinessLogo failed:', err.message)
    return null
  }
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
