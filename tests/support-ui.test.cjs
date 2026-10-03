const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const React = require('react')
const root = path.resolve(__dirname, '..')

test('support uses the real customer shell, passive providers and read-only dispatch', async () => {
  const policy = await import('../src/utils/businessSupport.js')
  const source = fs.readFileSync(path.join(root, 'src/components/common/BusinessSupportView.jsx'), 'utf8')
  assert.doesNotMatch(source, /updateDoc|addDoc|deleteDoc|setDoc|queueOperation|offlineCallable|writeLocal/)
  assert.match(source, /<AppShell \/>/)
  assert.doesNotMatch(source, /<AppProvider|<AuthProvider|<BranchProvider|<table|JSON.stringify/)
  const data = Object.fromEntries(['products', 'liquids', 'customers', 'suppliers', 'sales', 'users', 'purchases', 'cash_sessions', 'settings', 'branch_settings', 'branches', 'fiscalConfig', 'ncfSequences', 'fiscalInvoices'].map(key => [key, []]))
  data.products = [{ id: 'main-p', name: 'Main', active: true, stock: 1, minStock: 2 }, { id: 'other-p', name: 'Other', active: true, branchId: 'other' }]
  data.settings = [{ id: 'config', businessName: 'Tienda' }]
  data.users = [{ id: 'owner', role: 'Administrador', name: 'Dueño' }]
  const states = [data, '', 0, 'main', true]
  let index = 0, exited = false
  const shell = () => null
  const provider = { Provider: () => null }
  const messages = []
  const context = { React, ...policy, useState: () => [states[index++], () => {}], useEffect: () => {}, useMemo: fn => fn(),
    AppShell: shell, AuthContext: provider, AppContext: provider, BranchContext: provider, NavigationProvider: () => null,
    getInitialState: () => ({ settings: { lowBottleAlert: 10 }, cashSession: { open: false } }), recalculateCustomerLoyalty: c => c,
    toast: { error: message => messages.push(message) }, Timestamp: {}, enterSupportMode: () => () => {} }
  vm.createContext(context)
  const code = require('esbuild').transformSync(source.replace(/^import .*$/gm, '').replace('export default function', 'function'), { loader: 'jsx' }).code
  vm.runInContext(code, context)
  const view = context.BusinessSupportView({ session: { sessionId: 'session', business: { id: 'biz', name: 'Tienda' } }, onExit: () => { exited = true } })
  const nodes = []
  function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node?.props) return; nodes.push(node); walk(node.props.children) }
  walk(view)
  assert.equal(nodes.filter(node => node.type === shell).length, 1)
  const app = nodes.find(node => node.props.value?.state)?.props.value
  assert.equal(app.state.products.length, 1)
  assert.equal(app.state.currentUser.role, 'Administrador')
  assert.equal(app.state.settings.businessName, 'Tienda')
  app.dispatch({ type: 'DELETE_PRODUCT', payload: 'main-p' })
  assert.equal(app.state.products.length, 1)
  assert.equal(messages.length, 1)
  nodes.find(node => node.props.children === 'Salir de soporte').props.onClick()
  assert.equal(exited, true)
})

test('activity excludes support, records only visible online use, and throttles requests', async () => {
  const source = fs.readFileSync(path.join(root, 'src/hooks/useBusinessActivity.js'), 'utf8').replace(/^import .*$/gm, '').replace('export default function', 'function')
  for (const role of ['superadmin', 'Cajero']) {
    const listeners = new Map(), docListeners = new Map(), calls = []
    let cleanup, now = 1000000000
    const document = { visibilityState: 'visible', addEventListener: (key, fn) => docListeners.set(key, fn), removeEventListener: key => docListeners.delete(key) }
    const navigator = { onLine: true }
    const context = {
      useAuth: () => ({ isAuthenticated: true, currentUser: { id: 'user', businessId: 'biz', role } }),
      useEffect: fn => { cleanup = fn() }, getFunctions: () => ({}),
      httpsCallable: () => data => { calls.push(data); return Promise.resolve({}) },
      window: { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) },
      document, navigator, Date: { now: () => now }, console,
    }
    vm.createContext(context); vm.runInContext(source, context); context.useBusinessActivity()
    await new Promise(resolve => setImmediate(resolve))
    if (role === 'superadmin') { assert.equal(calls.length, 0); assert.equal(listeners.size, 0); continue }
    assert.equal(calls.length, 1)
    listeners.get('pointerdown')(); assert.equal(calls.length, 1)
    now += 300001; document.visibilityState = 'hidden'; listeners.get('pointerdown')(); assert.equal(calls.length, 1)
    document.visibilityState = 'visible'; navigator.onLine = false; listeners.get('pointerdown')(); assert.equal(calls.length, 1)
    navigator.onLine = true; listeners.get('online')(); assert.equal(calls.length, 2)
    assert.deepEqual(Object.keys(calls[1]), [])
    cleanup(); assert.equal(listeners.size, 0); assert.equal(docListeners.size, 0)
  }
})
