export * from '@firebase/firestore'
import * as sdk from '@firebase/firestore'
import { assertSupportWritable } from './supportMode'
export const addDoc = (...args) => { assertSupportWritable(); return sdk.addDoc(...args) }
export const setDoc = (...args) => { assertSupportWritable(); return sdk.setDoc(...args) }
export const updateDoc = (...args) => { assertSupportWritable(); return sdk.updateDoc(...args) }
export const deleteDoc = (...args) => { assertSupportWritable(); return sdk.deleteDoc(...args) }
export const writeBatch = (...args) => {
  assertSupportWritable()
  const batch = sdk.writeBatch(...args)
  for (const method of ['set', 'update', 'delete', 'commit']) {
    const original = batch[method].bind(batch)
    batch[method] = (...values) => { assertSupportWritable(); return original(...values) }
  }
  return batch
}
export const runTransaction = (...args) => { assertSupportWritable(); return sdk.runTransaction(...args) }
