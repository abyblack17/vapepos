export * from '@firebase/storage'
import * as sdk from '@firebase/storage'
import { assertSupportWritable } from './supportMode'
export const uploadBytes = (...args) => { assertSupportWritable(); return sdk.uploadBytes(...args) }
export const uploadBytesResumable = (...args) => { assertSupportWritable(); return sdk.uploadBytesResumable(...args) }
export const uploadString = (...args) => { assertSupportWritable(); return sdk.uploadString(...args) }
export const deleteObject = (...args) => { assertSupportWritable(); return sdk.deleteObject(...args) }
export const updateMetadata = (...args) => { assertSupportWritable(); return sdk.updateMetadata(...args) }
