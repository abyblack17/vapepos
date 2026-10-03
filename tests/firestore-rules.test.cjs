const { test } = require('node:test')
const assert = require('node:assert/strict')
const base = 'http://127.0.0.1:18810/v1/projects/demo-vapepos/databases/(default)/documents/'
const value = item => item instanceof Date ? { timestampValue: item.toISOString() } : typeof item === 'boolean' ? { booleanValue: item } : typeof item === 'number' ? { integerValue: String(item) } : { stringValue: item }
const fields = object => Object.fromEntries(Object.entries(object).map(([key, item]) => [key, value(item)]))
function token(uid) {
  const time = Math.floor(Date.now() / 1000)
  return Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ aud: 'demo-vapepos', iss: 'https://securetoken.google.com/demo-vapepos', sub: uid, user_id: uid, iat: time, exp: time + 3600, auth_time: time, firebase: { sign_in_provider: 'custom' } })).toString('base64url') + '.'
}
const call = (path, method, data, uid = 'owner') => fetch(base + path, { method, headers: { Authorization: `Bearer ${uid === 'owner' ? 'owner' : token(uid)}`, 'Content-Type': 'application/json' }, ...(data ? { body: JSON.stringify({ fields: fields(data) }) } : {}) })
async function seed(path, data) { const result = await call(path, 'PATCH', data); assert.equal(result.status, 200, await result.text()) }

test('expired trial denies operational reads/writes but permits reading license; paid Basic retains access', async () => {
 await seed('users/trial-owner', {active:true,role:'Administrador',businessId:'trial-biz'})
 await seed('businesses/trial-biz', {active:true,licenseType:'trial',trialExpiresAt:new Date(Date.now()-1000)})
 await seed('businesses/trial-biz/products/p',{name:'Kept',businessId:'trial-biz'})
 assert.equal((await call('businesses/trial-biz','GET',null,'trial-owner')).status,200)
 assert.equal((await call('businesses/trial-biz/products/p','GET',null,'trial-owner')).status,403)
 assert.equal((await call('businesses/trial-biz/products/p','PATCH',{name:'Changed',businessId:'trial-biz'},'trial-owner')).status,403)
 await seed('businesses/trial-biz',{active:true,licenseType:'trial',trialExpiresAt:new Date(Date.now()+3600000)})
 assert.equal((await call('businesses/trial-biz/products/p','GET',null,'trial-owner')).status,200)
 await seed('businesses/trial-biz',{active:true,licenseType:'permanent',plan:'pro',planExpiresAt:new Date(0)})
 assert.equal((await call('businesses/trial-biz/products/p','GET',null,'trial-owner')).status,200)
})

test('real Firestore rules block stale/reset writes but allow current authorized writes and NCF progression', async () => {
  await seed('users/admin', { active: true, role: 'Administrador', businessId: 'biz' })
  await seed('users/cashier', { active: true, role: 'Cajero', businessId: 'biz' })
  await seed('businesses/biz', { active: true, dataEpoch: 0 })
  let response = await call('businesses/biz/products/p1', 'PATCH', { name: 'Producto', stock: 5, businessId: 'biz' }, 'admin')
  assert.equal(response.status, 200, await response.text())
  await seed('businesses/biz', { active: true, dataEpoch: 1 })
  response = await call('businesses/biz/products/stale', 'PATCH', { name: 'Producto', stock: 5, businessId: 'biz' }, 'admin')
  assert.equal(response.status, 403, await response.text())
  response = await call('businesses/biz/products/p1', 'DELETE', null, 'admin')
  assert.equal(response.status, 403, await response.text())
  response = await call('businesses/biz/products/current', 'PATCH', { name: 'Producto', stock: 5, businessId: 'biz', dataEpoch: 1 }, 'admin')
  assert.equal(response.status, 200, await response.text())
  response = await call('businesses/biz/products/cashier-product', 'PATCH', { name: 'Producto', stock: 5, businessId: 'biz', dataEpoch: 1 }, 'cashier')
  assert.equal(response.status, 403, await response.text())
  await seed('businesses/biz/ncfSequences/seq', { active: true, nextNumber: 100, endNumber: 150, dataEpoch: 0 })
  response = await call('businesses/biz/ncfSequences/seq', 'PATCH', { active: true, nextNumber: 101, endNumber: 150, dataEpoch: 1 }, 'cashier')
  assert.equal(response.status, 200, await response.text())
  await seed('businesses/biz', { active: true, dataEpoch: 1, resetInProgress: true })
  response = await call('businesses/biz/customers/reset-customer', 'PATCH', { name: 'Cliente', businessId: 'biz', dataEpoch: 1 }, 'cashier')
  assert.equal(response.status, 403, await response.text())
  response = await call('businesses/biz', 'GET', null, 'admin')
  assert.equal(response.status, 200, await response.text())
})
