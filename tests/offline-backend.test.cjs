const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')

function fixture() {
  const documents = new Map([
    ['users/admin', { active: true, role: 'Administrador', businessId: 'biz' }],
    ['users/cashier', { active: true, role: 'Cajero', businessId: 'biz' }],
    ['users/super', { active: true, role: 'superadmin' }],
    ['businesses/biz', { active: true, dataEpoch: 0, name: 'Prueba', plan: 'pro' }],
    ['businesses/biz/settings/config', { businessName: 'Prueba' }],
    ['businesses/biz/ncfSequences/seq', { nextNumber: 100 }],
  ])
  let nextId = 0
  const reference = name => ({
    path: name,
    id: name.split('/').pop(),
    get: async () => snapshot(name),
    update: async value => documents.set(name, { ...documents.get(name), ...value }),
    collection: col => ({ path: `${name}/${col}`, doc: id => reference(`${name}/${col}/${id}`) }),
  })
  const snapshot = name => ({ id: name.split('/').pop(), exists: documents.has(name), data: () => documents.get(name), ref: reference(name) })
  const collection = name => ({
    doc: id => reference(`${name}/${id || 'generated' + (++nextId)}`),
    add: async data => { const ref = reference(`${name}/generated${++nextId}`); documents.set(ref.path, data); return ref },
    get: async () => { const docs = [...documents.keys()].filter(p => p.startsWith(name + '/') && !p.slice(name.length + 1).includes('/')).map(snapshot); return { docs, size: docs.length } },
    where: (field, op, expected) => ({ isQuery: true, get: async () => { const { docs } = await collection(name).get(); const selected = docs.filter(d => d.data()[field] === expected); return { docs: selected, size: selected.length } } }),
  })
  const batch = () => { const writes = []; return { set: (ref, data, options) => writes.push(() => documents.set(ref.path, { ...(options?.merge ? documents.get(ref.path) : {}), ...data })), update: (ref, data) => writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...data })), commit: async () => writes.forEach(w => w()) } }
  const db = {
    doc: reference,
    collection, batch,
    runTransaction: async callback => {
      const writes = []
      const tx = {
        get: async ref => ref.isQuery ? ref.get() : snapshot(ref.path),
        set: (ref, value, options) => writes.push(() => documents.set(ref.path, { ...(options?.merge ? documents.get(ref.path) : {}), ...value })),
        update: (ref, value) => writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...value })),
        delete: ref => writes.push(() => documents.delete(ref.path)),
      }
      const result = await callback(tx)
      writes.forEach(write => write())
      return result
    },
    recursiveDelete: async ref => { for (const name of documents.keys()) if (name.startsWith(`${ref.path}/`)) documents.delete(name) },
  }
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
  const timestamp = ms => ({ toMillis: () => ms, toDate: () => new Date(ms) })
  const firestore = { getFirestore: () => db, Timestamp: { now: () => timestamp(Date.now()), fromMillis: timestamp, fromDate: d => timestamp(d.getTime()) }, FieldValue: { serverTimestamp: () => 'SERVER_TIME', delete: () => undefined } }
  const trial = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/lib/trial.js'), 'utf8'), { exports: trial, require: name => name === 'firebase-functions/v2/scheduler' ? { onSchedule: (options, fn) => fn } : name === 'firebase-admin/firestore' ? firestore : require(name) })
  const exported = {}
  const source = fs.readFileSync(path.join(__dirname, '../functions/lib/offline.js'), 'utf8')
  vm.runInNewContext(source, {
    exports: exported,
    require: name => name === 'firebase-functions/v2/https' ? { onCall: (options, fn) => fn, HttpsError }
      : name === 'firebase-admin/firestore' ? firestore
      : name === './trial' ? trial
      : require(name),
  })
  const core = {}
  const support = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/lib/support.js'), 'utf8'), {
    exports: support,
    require: name => name === 'firebase-functions/v2/https' ? { onCall: (options, fn) => fn, HttpsError }
      : name === 'firebase-admin/firestore' ? firestore
      : name === './trial' ? trial : require(name),
  })
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../functions/lib/index.js'), 'utf8'), {
    exports: core,
    require: name => name === 'firebase-functions/v2/https' ? { onCall: (options, fn) => fn, HttpsError }
      : name === 'firebase-functions/v2/firestore' ? { onDocumentDeleted: (options, fn) => fn }
      : name === 'firebase-admin/app' ? { initializeApp: () => ({}) }
      : name === 'firebase-admin/auth' ? { getAuth: () => ({createUser: async () => ({uid:'new-user'}),getUser:async()=>({customClaims:{}}),setCustomUserClaims:async()=>{},updateUser:async()=>{},deleteUser:async()=>{}}) }
      : name === 'firebase-admin/storage' ? { getStorage: () => ({}) }
      : name === 'firebase-admin/firestore' ? firestore
      : name === './trial' ? trial : name === './offline' ? exported : name === './support' ? support : require(name),
  })
  const request = (data, uid = 'admin') => ({ auth: { uid, token: {email:'test@example.com'} }, data })
  return { documents, db, api: { ...exported, ...core, ...trial }, request }
}

test('sale reversal restores sessions, ml, counters, stock, half bottles, customer and original cash atomically once', async () => {
 const {documents,api,request}=fixture()
 documents.set('businesses/biz/products/product',{stock:10})
 documents.set('businesses/biz/liquids/mango',{name:'Mango',activeSaldo:140,activeCapacity:100,hasActive:true,closedBottles:5,halfBottleStock:0,totalRechargesAllTime:0,totalRevenueAllTime:0,totalPointsConsumedAllTime:0,activeSessionIds:['first','second'],openBottleCount:2,activeTotalCapacity:200})
 documents.set('businesses/biz/liquid_sessions/first',{capacity:100,remaining:100,status:'active'})
 documents.set('businesses/biz/liquid_sessions/second',{capacity:100,remaining:40,status:'active'})
 documents.set('businesses/biz/cash_sessions/cash',{open:true,sales:100,salePayments:100})
 documents.set('businesses/biz/customers/customer',{totalSpent:1000,totalTransactions:2,creditBalance:50,rewardPoints:20,refillRewards:4,totalRefills:4})
 const sale={id:'reverse-test',userId:'admin',date:'2026-10-01',total:400,amountReceived:500,change:100,customerId:'customer',creditAdded:10,rewardPointsEarned:8,pointsRedeemed:2,refillRewardsEarned:2,items:[{productId:'product',qty:1},{productId:'product',qty:2}],refills:[{liquidId:'mango',pointsConsumed:50,price:50},{liquidId:'mango',pointsConsumed:60,price:100}],bottleSales:[{liquidId:'mango',qty:1},{liquidId:'mango',qty:1,isHalf:true}]}
 const commit=request({sale,cashSessionId:'cash',operationId:'commit-reverse',dataEpoch:0})
 await api.commitSale(commit)
 assert.equal(documents.get('businesses/biz/liquids/mango').activeSaldo,30)
 assert.equal(documents.get('businesses/biz/liquid_sessions/first').status,'depleted')
 documents.get('businesses/biz/cash_sessions/cash').sales+=60;documents.get('businesses/biz/cash_sessions/cash').salePayments+=60
 documents.get('businesses/biz/customers/customer').totalSpent+=50;documents.get('businesses/biz/customers/customer').rewardPoints+=1
 documents.set('businesses/biz/refill_history/history',{saleId:sale.id})
 documents.set('businesses/biz/fiscalInvoices/invoice',{saleId:sale.id,status:'issued',ncf:'B0100000001'})
 const reverse=request({saleId:sale.id,operationId:'reverse-once',dataEpoch:0})
 await api.reverseSale(reverse)
 const liquid=documents.get('businesses/biz/liquids/mango')
 assert.equal(liquid.activeSaldo,140);assert.equal(liquid.closedBottles,5);assert.equal(liquid.halfBottleStock,0)
 assert.equal(liquid.totalRechargesAllTime,0);assert.equal(liquid.totalRevenueAllTime,0);assert.equal(liquid.totalPointsConsumedAllTime,0)
 assert.equal(liquid.openBottleCount,2);assert.equal(liquid.activeTotalCapacity,200)
 assert.equal(documents.get('businesses/biz/liquid_sessions/first').remaining,100)
 assert.equal(documents.get('businesses/biz/liquid_sessions/second').remaining,40)
 assert.equal(documents.get('businesses/biz/products/product').stock,10)
 assert.equal(documents.get('businesses/biz/cash_sessions/cash').sales,160)
 assert.equal(documents.get('businesses/biz/customers/customer').totalSpent,1050)
 assert.equal(documents.get('businesses/biz/customers/customer').rewardPoints,21)
 assert.equal(documents.has('businesses/biz/refill_history/history'),false)
 assert.equal(documents.get('businesses/biz/fiscalInvoices/invoice').status,'cancelled')
 assert.equal(documents.get('businesses/biz/fiscalInvoices/invoice').ncf,'B0100000001')
 assert.equal(documents.has('businesses/biz/sales/reverse-test'),false)
 const before=JSON.stringify([...documents]);await api.reverseSale(reverse)
 await api.reverseSale(request({...reverse.data,operationId:'different-retry'}));await api.commitSale(commit)
 assert.equal(JSON.stringify([...documents]),before)
})
test('reversal rejects missing inventory, cashier, cross-business and obsolete epoch without partial writes',async()=>{
 const {documents,api,request}=fixture()
 documents.set('businesses/biz/sales/missing',{total:50,items:[],refills:[{liquidId:'gone',pointsConsumed:5,price:50}]})
 const input={saleId:'missing',operationId:'reverse-missing',dataEpoch:0}
 const before=JSON.stringify([...documents])
 await assert.rejects(api.reverseSale(request(input)))
 await assert.rejects(api.reverseSale(request(input,'cashier')))
 await assert.rejects(api.reverseSale(request({...input,businessId:'other'})))
 await assert.rejects(api.reverseSale(request({...input,dataEpoch:1})))
 await assert.rejects(api.applyBusinessMutation(request({collection:'sales',documentId:'missing',action:'delete',operationId:'bad-delete',dataEpoch:0})))
 assert.equal(JSON.stringify([...documents]),before)
})
test('legacy refill reversal returns all consumed ml without single-bottle cap and preserves other cash',async()=>{
 const {documents,api,request}=fixture()
 documents.set('businesses/biz/liquids/legacy',{name:'Legacy',activeSaldo:120,activeCapacity:100,hasActive:true,closedBottles:2,totalRechargesAllTime:1,totalRevenueAllTime:50,totalPointsConsumedAllTime:5})
 documents.set('businesses/biz/cash_sessions/unrelated',{sales:900,open:true})
 documents.set('businesses/biz/sales/old',{total:50,refills:[{liquidId:'legacy',pointsConsumed:5,price:50}]})
 const result=await api.reverseSale(request({saleId:'old',operationId:'reverse-old',dataEpoch:0,cashSessionId:'unrelated'}))
 assert.equal(documents.get('businesses/biz/liquids/legacy').activeSaldo,125)
 assert.equal(documents.get('businesses/biz/liquids/legacy').totalRevenueAllTime,0)
 assert.equal(documents.get('businesses/biz/cash_sessions/unrelated').sales,900)
 assert.equal(result.warnings.length,1)
})

test('reversal refunds only actual redeemed rewards and returns a half even if the other half was subsequently sold',async()=>{
 const {documents,api,request}=fixture()
 documents.set('businesses/biz/liquids/half',{name:'Half',activeSaldo:0,closedBottles:1,halfBottleStock:0})
 documents.set('businesses/biz/customers/customer',{rewardPoints:20,totalSpent:0,totalTransactions:0})
 const sale={id:'half-sale',userId:'admin',total:50,customerId:'customer',pointsRedeemed:50,rewardPointsEarned:8,items:[],refills:[],bottleSales:[{liquidId:'half',qty:1,isHalf:true}]}
 await api.commitSale(request({sale,dataEpoch:0,operationId:'half-commit'}))
 documents.get('businesses/biz/liquids/half').halfBottleStock=0
 await api.reverseSale(request({saleId:'half-sale',dataEpoch:0,operationId:'half-reverse'}))
 assert.equal(documents.get('businesses/biz/liquids/half').closedBottles,0)
 assert.equal(documents.get('businesses/biz/liquids/half').halfBottleStock,1)
 assert.equal(documents.get('businesses/biz/customers/customer').rewardPoints,20)
})

test('open stock adds available ml, preserves closed bottles and records one movement on retry', async () => {
  const { documents, api, request } = fixture()
  const liquid = { name: 'Mango', brand: 'Brand', activeCapacity: 100, activeSaldo: 60, hasActive: true, openBottleCount: 1, closedBottles: 4 }
  documents.set('businesses/biz/liquids/mango', liquid)
  const input = request({ liquidId: 'mango', operationId: 'op1', liquid, ml: 35, capacity: 100, dataEpoch: 0 })
  await api.addOpenLiquidStock(input)
  await api.addOpenLiquidStock(input)
  assert.equal(documents.get('businesses/biz/liquids/mango').activeSaldo, 95)
  assert.equal(documents.get('businesses/biz/liquids/mango').closedBottles, 4)
  assert.equal(documents.get('businesses/biz/liquids/mango').openBottleCount, 2)
  assert.equal([...documents.keys()].filter(name => name.includes('/liquid_events/')).length, 1)
})
test('invalid open quantities and mismatched nicotine never modify stock', async () => {
  const { documents, api, request } = fixture()
  const liquid = { name: 'Mango', brand: 'Brand', activeCapacity: 100, activeSaldo: 50, nicotinaSales: '50' }
  documents.set('businesses/biz/liquids/mango', liquid)
  await assert.rejects(api.addOpenLiquidStock(request({ liquidId: 'mango', operationId: 'op1', liquid, ml: 110, capacity: 100, dataEpoch: 0 })))
  await assert.rejects(api.addOpenLiquidStock(request({ liquidId: 'mango', operationId: 'op2', liquid: { ...liquid, nicotinaSales: '25' }, ml: 20, capacity: 100, dataEpoch: 0 })))
  assert.equal(documents.get('businesses/biz/liquids/mango').activeSaldo, 50)
})
test('cashiers cannot reset businesses or create inventory', async () => {
  const { api, request } = fixture()
  await assert.rejects(api.resetBusinessData(request({ businessId: 'biz', confirmation: 'RESTAURAR NEGOCIO' }, 'cashier')))
  await assert.rejects(api.applyBusinessMutation(request({ collection: 'products', documentId: 'p1', action: 'set', operationId: 'op1', dataEpoch: 0, data: { stock: 10 } }, 'cashier')))
})
test('reset clears operations, preserves access, subscription and NCF sequence, rejects stale queue', async () => {
  const { documents, api, request } = fixture()
  documents.set('businesses/biz/products/p1', { stock: 5 })
  documents.set('businesses/biz/sales/s1', { total: 100 })
  documents.set('businesses/biz/liquid_sessions/l1', { remaining: 30 })
  const result = await api.resetBusinessData(request({ businessId: 'biz', confirmation: 'RESTAURAR NEGOCIO' }))
  assert.equal(result.dataEpoch, 1)
  assert.equal(documents.has('businesses/biz/sales/s1'), false)
  assert.equal(documents.has('businesses/biz/products/p1'), false)
  assert.equal(documents.has('businesses/biz/liquid_sessions/l1'), false)
  assert.equal(documents.get('businesses/biz').plan, 'pro')
  assert.equal(documents.get('businesses/biz/ncfSequences/seq').nextNumber, 100)
  assert.equal(documents.has('users/admin'), true)
  await assert.rejects(api.applyBusinessMutation(request({ collection: 'products', documentId: 'p1', action: 'set', operationId: 'oldop', dataEpoch: 0, data: { stock: 5 } })))
  assert.equal(documents.has('businesses/biz/products/p1'), false)
})
test('durable mutation is idempotent and cannot cross businesses', async () => {
  const { documents, api, request } = fixture()
  const input = request({ collection: 'customers', documentId: 'c1', action: 'set', operationId: 'op1', dataEpoch: 0, data: { name: 'Cliente', businessId: 'other' } }, 'cashier')
  await api.applyBusinessMutation(input)
  assert.equal(documents.get('businesses/biz/customers/c1').businessId, 'biz')
  assert.equal((await api.applyBusinessMutation(input)).duplicate, true)
  assert.equal(documents.has('businesses/other/customers/c1'), false)
})
test('reset requires explicit confirmation and active business operations', async () => {
  const { documents, api, request } = fixture()
  await assert.rejects(api.resetBusinessData(request({ businessId: 'biz', confirmation: 'RESTABLECER' })))
  documents.set('businesses/biz', { active: true, dataEpoch: 0, resetInProgress: true })
  await assert.rejects(api.applyBusinessMutation(request({ collection: 'customers', documentId: 'c1', action: 'set', operationId: 'op1', dataEpoch: 0, data: { name: 'Cliente' } })))
})
test('sale replay never deducts stock twice and stale sales cannot survive reset', async () => {
  const { documents, api, request } = fixture()
  documents.set('businesses/biz/products/p1', { stock: 10 })
  const input = request({ sale: { id: 'sale1', userId: 'cashier', total: 100, items: [{ productId: 'p1', qty: 3 }], refills: [], bottleSales: [] }, dataEpoch: 0 }, 'cashier')
  await api.commitSale(input)
  await api.commitSale(input)
  assert.equal(documents.get('businesses/biz/products/p1').stock, 7)
  await api.resetBusinessData(request({ businessId: 'biz', confirmation: 'RESTAURAR NEGOCIO' }))
  await assert.rejects(api.commitSale(input))
  assert.equal(documents.has('businesses/biz/sales/sale1'), false)
})
test('conflicting sales are rejected without partial writes', async () => {
  const { documents, api, request } = fixture()
  documents.set('businesses/biz/products/p1', { stock: 4 })
  await assert.rejects(api.commitSale(request({ sale: { id: 'sale1', userId: 'cashier', total: 100, items: [{ productId: 'p1', qty: 3 }, { productId: 'p1', qty: 3 }] }, dataEpoch: 0 }, 'cashier')))
  assert.equal(documents.get('businesses/biz/products/p1').stock, 4)
  assert.equal(documents.has('businesses/biz/sales/sale1'), false)
})
test('a failed reset stays locked and can resume without a second epoch change', async () => {
  const { documents, db, api, request } = fixture()
  const remove = db.recursiveDelete
  db.recursiveDelete = async () => { throw new Error('Simulated outage') }
  const input = request({ businessId: 'biz', confirmation: 'RESTAURAR NEGOCIO' })
  await assert.rejects(api.resetBusinessData(input))
  assert.equal(documents.get('businesses/biz').resetInProgress, true)
  assert.equal(documents.get('businesses/biz').dataEpoch, 1)
  db.recursiveDelete = remove
  await api.resetBusinessData(input)
  assert.equal(documents.get('businesses/biz').resetInProgress, false)
  assert.equal(documents.get('businesses/biz').dataEpoch, 1)
})

test('registration automatically activates owner and business with exactly 72 hours of Pro', async () => {
  const { api, documents } = fixture()
  await api.registerBusiness({ data: {email:'new@example.com',password:'password123',ownerName:'Owner',businessName:'New Shop'} })
  const owner = documents.get('users/new-user')
  const business = documents.get('businesses/' + owner.businessId)
  assert.equal(owner.active, true); assert.equal(owner.activationPending, false)
  assert.equal(business.plan, 'pro'); assert.equal(business.licenseType, 'trial'); assert.equal(business.active, true)
  assert.ok(Math.abs(business.trialExpiresAt.toMillis() - business.trialStartedAt.toMillis() - 72*3600000) < 100)
  assert.equal(business.planExpiresAt.toMillis(), business.trialExpiresAt.toMillis())
})

test('expired trial blocks callable writes, preserves data, and scheduler never suspends a purchased account', async () => {
  const { api, documents, request } = fixture()
  const biz = documents.get('businesses/biz')
  documents.set('businesses/biz', {...biz,licenseType:'trial',trialExpiresAt:new Date(Date.now()-1000)})
  await assert.rejects(api.applyBusinessMutation(request({collection:'customers',documentId:'c',operationId:'op',action:'set',dataEpoch:0,data:{name:'Customer'}})))
  await assert.rejects(api.addEmployeeToStore(request({})))
  await api.expireBusinessTrials()
  assert.equal(documents.get('businesses/biz').active,false)
  assert.ok(documents.has('businesses/biz/settings/config'))
  documents.set('businesses/biz',{...biz,licenseType:'permanent',trialExpiresAt:new Date(0)})
  await api.expireBusinessTrials()
  assert.equal(documents.get('businesses/biz').active,true)
})

test('only superadmin purchases a lifetime account with 2, 3 or 5 months and cannot replay the bonus', async () => {
  for(const [purchasePackage,months,price] of [['autonomo',2,5000],['remoto',3,8000],['presencial',5,14000]]) {
    const { api, documents, request } = fixture()
    await assert.rejects(api.setBusinessAccessAsSuperAdmin(request({businessId:'biz',status:'active',purchasePackage})))
    await api.setBusinessAccessAsSuperAdmin(request({businessId:'biz',status:'active',purchasePackage},'super'))
    const biz=documents.get('businesses/biz')
    assert.equal(biz.licenseType,'permanent'); assert.equal(biz.active,true); assert.equal(biz.purchasePrice,price)
    assert.equal(biz.includedProMonths,months); assert.ok(biz.planExpiresAt.toMillis()>Date.now())
    await assert.rejects(api.setBusinessAccessAsSuperAdmin(request({businessId:'biz',status:'active',purchasePackage},'super')))
    await api.setBusinessAccessAsSuperAdmin(request({businessId:'biz',status:'suspended'},'super'))
    await api.setBusinessAccessAsSuperAdmin(request({businessId:'biz',status:'active'},'super'))
    assert.equal(documents.get('businesses/biz').planExpiresAt.toMillis(),biz.planExpiresAt.toMillis())
  }
})

test('calendar month bonuses clamp month end and legacy trial endpoint cannot restart the trial', async () => {
  const {api,request}=fixture()
  assert.equal(api.includedProExpiry(new Date('2026-12-31T12:00:00Z'),2).toISOString(),'2027-02-28T12:00:00.000Z')
  await assert.rejects(api.activateTrial(request({})))
})

test('editing and adding an open bottle is atomic, preserves the same ID/closed stock and retries only once',async()=>{
 const {api,documents,request}=fixture()
 const liquid={name:'Mango',brand:'Brand',activeCapacity:100,activeSaldo:60,closedBottles:2,openBottleCount:1}
 documents.set('businesses/biz/liquids/mango',liquid)
 const editFields={name:'Mango Ice',brand:'Brand',closedBottles:2,pricePerBottle:850}
 const input=request({liquidId:'mango',operationId:'edit-open',liquid,ml:35,capacity:100,dataEpoch:0,editFields})
 await api.addOpenLiquidStock(input);await api.addOpenLiquidStock(input)
 const updated=documents.get('businesses/biz/liquids/mango')
 assert.equal(updated.name,'Mango Ice');assert.equal(updated.pricePerBottle,850)
 assert.equal(updated.activeSaldo,95);assert.equal(updated.closedBottles,2);assert.equal(updated.openBottleCount,2)
 assert.equal([...documents.keys()].filter(k=>k.startsWith('businesses/biz/liquids/')).length,1)
 assert.equal(documents.get('businesses/biz/liquid_events/edit-open').ml,35)
})

test('invalid edited open bottle never partly saves metadata or stock',async()=>{
 const {api,documents,request}=fixture()
 const liquid={name:'Mango',activeCapacity:100,activeSaldo:60,closedBottles:2,openBottleCount:3}
 documents.set('businesses/biz/liquids/mango',liquid)
 const input={liquidId:'mango',operationId:'edit-open',liquid,ml:35,capacity:100,dataEpoch:0,editFields:{name:'Changed',closedBottles:2}}
 await assert.rejects(api.addOpenLiquidStock(request(input)))
 assert.equal(documents.get('businesses/biz/liquids/mango').name,'Mango')
 await assert.rejects(api.addOpenLiquidStock(request({...input,ml:101})))
 await assert.rejects(api.addOpenLiquidStock(request({...input,editFields:{...input.editFields,activeSaldo:500}})))
 assert.equal(documents.get('businesses/biz/liquids/mango').activeSaldo,60)
 assert.equal(documents.has('businesses/biz/liquid_events/edit-open'),false)
})
