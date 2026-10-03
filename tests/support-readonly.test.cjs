const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

test('all Firebase writes and previously created callables are blocked in support; normal mode resumes', async () => {
  const mode = await import('../src/services/supportMode.js')
  let writes = 0
  const sdk = new Proxy({}, { get: (_, name) => (...args) => {
    if (name === 'httpsCallable' || name === 'httpsCallableFromURL') return () => { writes++; return args[1] }
    if (name === 'writeBatch') return { set() { writes++ }, update() { writes++ }, delete() { writes++ }, commit() { writes++ } }
    writes++
  } })
  const modules = {}
  for (const filename of ['supportFirestore', 'supportFunctions', 'supportStorage']) {
    const context = { sdk, assertSupportWritable: mode.assertSupportWritable }
    vm.createContext(context)
    const source = fs.readFileSync(path.join(root, 'src/services', filename + '.js'), 'utf8')
      .replace(/^import .*$/gm, '').replace(/^export \*.*$/gm, '').replace(/export const /g, 'var ')
    vm.runInContext(source, context)
    modules[filename] = context
  }
  const call = modules.supportFunctions.httpsCallable({}, 'deleteBusinessAsSuperAdmin')
  const batch = modules.supportFirestore.writeBatch({})
  const leave = mode.enterSupportMode()
  try {
    for (const method of ['addDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'runTransaction', 'writeBatch']) assert.throws(() => modules.supportFirestore[method]({}), /solo puedes consultar/)
    for (const method of ['uploadBytes', 'uploadBytesResumable', 'uploadString', 'deleteObject', 'updateMetadata']) assert.throws(() => modules.supportStorage[method]({}), /solo puedes consultar/)
    assert.throws(() => call({}), /solo puedes consultar/)
    assert.throws(() => batch.commit(), /solo puedes consultar/)
    assert.equal(writes, 0)
    modules.supportFunctions.httpsCallable({}, 'readBusinessSupport')({})
    assert.equal(writes, 1)
  } finally { leave() }
  modules.supportFirestore.updateDoc({})
  call({})
  assert.equal(writes, 3)
  assert.equal(mode.isSupportMode(), false)
})

test('offline queuing is guarded before any local write, and support activity is human readable', async () => {
  const source = fs.readFileSync(path.join(root, 'src/services/offlineSync.js'), 'utf8')
  assert.match(source, /export async function queueOperation[^\n]*\{\s*assertSupportWritable\(\)/)
  assert.match(source, /export async function flushOperations\(\) \{\s*if \(isSupportMode\(\)\) return/)
  const { lastActivityLabel } = await import('../src/utils/businessSupport.js')
  const now = Date.now()
  assert.match(lastActivityLabel(new Date(now - 2 * 3600000).toISOString(), now), /^Hace 2 horas · /)
  assert.equal(lastActivityLabel(null, now), 'Sin actividad registrada')
})
