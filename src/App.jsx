import React, { useState, lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NavigationProvider, useNavigation } from './contexts/NavigationContext'
import { AppProvider } from './contexts/AppContext'
import { BranchProvider, useBranches } from './contexts/BranchContext'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import { useApp } from './contexts/AppContext'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const POS = lazy(() => import('./pages/POS'))
const Cart = lazy(() => import('./pages/Cart'))
const Refills = lazy(() => import('./pages/Refills'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Purchases = lazy(() => import('./pages/Purchases'))
const Customers = lazy(() => import('./pages/Customers'))
const Suppliers = lazy(() => import('./pages/Suppliers'))
const Reports = lazy(() => import('./pages/Reports'))
const SalesHistory = lazy(() => import('./pages/SalesHistory'))
const Cash = lazy(() => import('./pages/Cash'))
const Users = lazy(() => import('./pages/Users'))
const Settings = lazy(() => import('./pages/Settings'))
const Fiscal = lazy(() => import('./pages/Fiscal'))
const Suggestions = lazy(() => import('./pages/Suggestions'))
const Insights = lazy(() => import('./pages/Insights'))
const Branches = lazy(() => import('./pages/Branches'))
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import TrialReminder from './components/common/TrialReminder'
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'))
import SyncStatus from './components/common/SyncStatus'
import PurchaseOptions from './components/common/PurchaseOptions'
import useBusinessActivity from './hooks/useBusinessActivity'
import { TRIAL_MESSAGE, trialExpired } from './config/trial'

const MOBILE_NAV_ITEMS = [
  { id: 'dashboard', icon: '◈', label: 'Inicio' },
  { id: 'pos',       icon: '⊞', label: 'Venta' },
  { id: 'cart',      icon: '🛒', label: 'Carrito' },
  { id: 'history',   icon: '🧾', label: 'Recibos' },
  { id: 'reports',   icon: '◫', label: 'Reportes' },
]


const PAGE_COMPONENTS = {
  dashboard:   Dashboard,
  pos:         POS,
  cart:        Cart,
  refills:     Refills,
  inventory:   Inventory,
  purchases:   Purchases,
  customers:   Customers,
  suppliers:   Suppliers,
  reports:     Reports,
  history:     SalesHistory,
  cash:        Cash,
  users:       Users,
  settings:    Settings,
  fiscal:      Fiscal,
  suggestions: Suggestions,
  insights:    Insights,
  branches:    Branches,
}

export function AppShell() {
  const { business, isSupport } = useAuth()
  const { currentPage, navigate } = useNavigation()
  const { state } = useApp()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { branchesEnabled, branches, loadingBranches } = useBranches()
  const PageComponent = PAGE_COMPONENTS[currentPage] || Dashboard
  const handleNavigate = (page) => {
    navigate(page)
    setSidebarOpen(false)
  }

  if (business?.resetInProgress) return <div className="min-h-screen flex items-center justify-center text-slate-300 bg-[#080d18]">El negocio se está restaurando. Espera a que termine.</div>
  if (state.dataError && !state.dataLoaded) return <div className="min-h-screen flex flex-col gap-4 items-center justify-center p-6 text-slate-300 bg-[#080d18]"><p>{state.dataError}</p><SyncStatus /><button className="btn-secondary" onClick={() => window.location.reload()}>Reintentar</button></div>
  if (state.loading || !state.dataLoaded) return <div className="min-h-screen flex items-center justify-center text-slate-300 bg-[#080d18]">Cargando los datos del negocio…</div>

  if (branchesEnabled && !loadingBranches && branches.length === 0) {
    return <div className="min-h-screen bg-[#080d18] flex items-center justify-center p-5"><div className="card p-6 max-w-md text-center"><div className="text-4xl mb-3">📍</div><h2 className="font-display text-xl font-bold text-slate-100">Sin sucursal asignada</h2><p className="text-sm text-slate-400 mt-2">Un Administrador debe asignarte a una sucursal antes de que puedas usar VapePos.</p></div></div>
  }

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-[#080d18]" style={{height: isSupport ? '100%' : '100dvh'}}>

      {/* Overlay oscuro en movil cuando sidebar esta abierto */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — fijo en desktop, drawer en movil */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-30
        transform transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <Sidebar currentPage={currentPage} onNavigate={handleNavigate} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
        <TopBar
          currentPage={currentPage}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />
        {!isSupport && <SyncStatus />}
        <main className={`app-main flex-1 overflow-y-auto overscroll-contain ${currentPage === 'pos' ? 'p-3 md:p-4' : 'p-3 md:p-5'}`}
          style={{paddingBottom: 'max(84px, env(safe-area-inset-bottom))'}}>
          <Suspense fallback={<div className="p-5 text-slate-400">Cargando módulo…</div>}><PageComponent /></Suspense>
        </main>


        <nav className="mobile-bottom-nav md:hidden" aria-label="Navegacion principal">
          {MOBILE_NAV_ITEMS.map(item => {
            const active = currentPage === item.id
            const cartCount = item.id === 'cart' ? (state.cart?.reduce((a, i) => a + (i.qty || 1), 0) || 0) : 0
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={active ? 'mobile-bottom-nav-item active' : 'mobile-bottom-nav-item'}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
                {cartCount > 0 && <span className="mobile-cart-badge">{cartCount}</span>}
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

function AuthGate() {
  useBusinessActivity()
  const { isAuthenticated, loading, userProfile, business, logout, accessNow } = useAuth()
  const [authView, setAuthView] = useState('login')

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080d18] flex items-center justify-center">
        <div className="text-center">
          <div className="font-display text-3xl font-black gradient-neon mb-4">VapePOS</div>
          <div className="text-slate-500 text-sm animate-pulse">Cargando sistema...</div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return authView === 'login'
      ? <Login    onGoRegister={() => setAuthView('register')} />
      : <Register onGoLogin={()    => setAuthView('login')} />
  }

  if (userProfile?.role === 'superadmin') {
    return <Suspense fallback={<div className="p-5 text-slate-400">Cargando administración…</div>}><SuperAdmin /></Suspense>
  }

  if (trialExpired(business, accessNow)) return <div className="min-h-screen bg-[#080d18] flex items-center justify-center p-4"><div className="card p-6 max-w-lg w-full space-y-5"><h1 className="text-xl font-bold text-slate-100">Tu prueba ha concluido</h1><p className="text-slate-300">{TRIAL_MESSAGE}</p><PurchaseOptions /><p className="text-sm text-slate-400">Tus datos se conservan. Soporte habilitará el acceso después de verificar tu compra.</p><button className="btn-secondary w-full" onClick={logout}>Cerrar sesión</button></div></div>

  return (
    <BranchProvider>
      <AppProvider>
        <AppShell />
        <TrialReminder business={business} now={accessNow} />
      </AppProvider>
    </BranchProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
      <ThemeProvider>
      <AuthGate />
      </ThemeProvider>
      </NavigationProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: { background: '#1a2848', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', fontSize: '13px' },
          success: { iconTheme: { primary: '#00e5a0', secondary: '#0a0f1a' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#0a0f1a' } },
        }}
      />
    </AuthProvider>
  )
}
