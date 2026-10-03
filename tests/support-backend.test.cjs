const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture() {
  const records = new Map([
    ['users/super', { role: 'superadmin', active: true, email: 'support@example.test' }],
    ['users/owner', { role: 'Administrador', active: true, businessId: 'biz' }],
    ['users/disabled', { role: 'superadmin', active: false }],
    ['businesses/biz', { name: 'Prueba', active: true, licenseType: 'permanent' }],
    ['businesses/other', { name: 'Otro', active: true }],
  ])
  let next = 0
  const ref = name => ({ path: name, id: name.split('/').pop(), get: async () => snap(name) })
  const snap = name => ({ ...ref(name), exists: records.has(name), data: () => records.get(name) })
  const collection = name => {
    let cursor = null, count = Infinity
    const q = {
      doc: id => ref(`${name}/${id || 'auto' + ++next}`),
      orderBy: () => q,
      limit: n => { count = n; return q },
      startAfter: id => { cursor = id; return q },
      get: async () => ({ docs: [...records.keys()].filter(key => key.startsWith(name + '/') && !key.slice(name.length + 1).includes('/'))
        .sort().map(snap).filter(d => !cursor || d.id > cursor).slice(0, count) }),
    }
    return q
  }
  const db = {
    doc: ref, collection,
    batch: () => {
      const writes = []
      return { set: (r, value) => writes.push([r.path, value]), commit: async () => writes.forEach(([key, value]) => records.set(key, value)) }
    },
    runTransaction: async fn => fn({ get: r => r.get(), update: (r, value) => records.set(r.path, { ...records.get(r.path), ...value }) }),
  }
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
  const api = {}
  const source = fs.readFileSync(path.resolve(__dirname, '../functions/lib/support.js'), 'utf8')
  vm.runInNewContext(source, {
    exports: api, Date,
    require: name => name === 'firebase-functions/v2/https' ? { HttpsError, onCall: (_, fn) => fn }
      : name === 'firebase-admin/firestore' ? { getFirestore: () => db, FieldPath: { documentId: () => '__id' }, FieldValue: { serverTimestamp: () => ({ toMillis: () => Date.now() }) } }
      : name === './trial' ? { trialExpired: b => b.licenseType === 'trial' && b.trialExpiresAt <= Date.now() } : require(name),
  })
  const request = (data, uid = 'super') => ({ auth: { uid }, data })
  return { api, records, request }
}

test('support refuses anonymous, normal and inactive users', async () => {
  const { api, request } = fixture()
  for (const req of [{ data: { businessId: 'biz' } }, request({ businessId: 'biz' }, 'owner'), request({ businessId: 'biz' }, 'disabled')]) {
    await assert.rejects(api.openBusinessSupport(req), error => ['unauthenticated', 'permission-denied'].includes(error.code))
  }
})

test('opening support audits access without modifying tenant data or identity', async () => {
  const { api, records, request } = fixture()
  const before = JSON.stringify(records.get('businesses/biz'))
  const result = await api.openBusinessSupport(request({ businessId: 'biz' }))
  assert.equal(result.business.id, 'biz')
  assert.equal(JSON.stringify(records.get('businesses/biz')), before)
  assert.equal(records.get(`support_sessions/${result.sessionId}`).mode, 'read-only')
  assert.ok([...records.entries()].some(([key, value]) => key.startsWith('businesses/biz/audit_logs/') && value.action === 'SUPPORT_VIEW'))
})

test('support pages only the session tenant, strips secrets and never writes on reads', async () => {
  const { api, records, request } = fixture()
  for (let i = 0; i < 55; i++) records.set(`businesses/biz/products/p${String(i).padStart(2, '0')}`, { name: 'Producto', password: 'secret', nested: { apiKey: 'secret', price: 20 } })
  records.set('businesses/other/products/foreign', { name: 'No visible' })
  const { sessionId } = await api.openBusinessSupport(request({ businessId: 'biz' }))
  const size = records.size
  const page = await api.readBusinessSupport(request({ sessionId, module: 'products', businessId: 'other' }))
  assert.equal(page.rows.length, 50)
  assert.equal(page.rows[0].password, undefined)
  assert.equal(page.rows[0].nested.apiKey, undefined)
  assert.equal(page.rows[0].nested.price, 20)
  assert.ok(!page.rows.some(row => row.id === 'foreign'))
  const tail = await api.readBusinessSupport(request({ sessionId, module: 'products', cursor: page.nextCursor }))
  assert.equal(tail.rows.length, 5); assert.equal(tail.nextCursor, null)
  assert.equal(records.size, size)
  await assert.rejects(api.readBusinessSupport(request({ sessionId, module: '../../users' })), { code: 'invalid-argument' })
  await assert.rejects(api.readBusinessSupport(request({ sessionId, module: 'products' }, 'owner')), { code: 'permission-denied' })
  records.set('users/anotherSuper', { active: true, role: 'superadmin' })
  await assert.rejects(api.readBusinessSupport(request({ sessionId, module: 'products' }, 'anotherSuper')), { code: 'permission-denied' })
  records.get(`support_sessions/${sessionId}`).expiresAt = 0
  await assert.rejects(api.readBusinessSupport(request({ sessionId, module: 'products' })), { code: 'permission-denied' })
})

test('last activity uses authenticated tenant, is throttled, and ignores support sessions', async () => {
  const { api, records, request } = fixture()
  assert.equal((await api.recordBusinessActivity(request({ businessId: 'other' }, 'owner'))).recorded, true)
  assert.ok(records.get('businesses/biz').lastActivityAt)
  assert.equal(records.get('businesses/other').lastActivityAt, undefined)
  assert.equal((await api.recordBusinessActivity(request({}, 'owner'))).recorded, false)
  assert.equal((await api.recordBusinessActivity(request({}, 'super'))).recorded, false)
})

test('trial filters distinguish licenses and handle timestamps without inventing activity', async () => {
  const { businessLicenseStatus, trialRemainingLabel, lastActivityLabel } = await import('../src/utils/businessSupport.js')
  const now = Date.now()
  const trial = { licenseType: 'trial', trialExpiresAt: { seconds: (now + 72 * 3600000) / 1000 } }
  assert.equal(businessLicenseStatus(trial, now), 'trial')
  assert.equal(trialRemainingLabel(trial, now), '3 días restantes')
  assert.equal(businessLicenseStatus(trial, now + 72 * 3600000), 'expired')
  assert.equal(businessLicenseStatus({ licenseType: 'permanent' }), 'permanent')
  assert.equal(businessLicenseStatus({}), 'legacy')
  assert.equal(lastActivityLabel(null), 'Sin actividad registrada')
})
