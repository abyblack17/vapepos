export * from '@firebase/functions'
import * as sdk from '@firebase/functions'
import { assertSupportWritable } from './supportMode'
export const httpsCallable = (functions, name, options) => {
  const call = sdk.httpsCallable(functions, name, options)
  return (...args) => { if (name !== 'readBusinessSupport') assertSupportWritable(); return call(...args) }
}
export const httpsCallableFromURL = (...args) => {
  const call = sdk.httpsCallableFromURL(...args)
  return (...values) => { assertSupportWritable(); return call(...values) }
}
