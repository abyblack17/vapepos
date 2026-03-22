import React, { useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NavigationProvider, useNavigation } from './contexts/NavigationContext'
import { AppProvider } from './contexts/AppContext'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import Dashboard from './pages/Dashboard'
import POS from './pages/POS'
import Refills from './pages/Refills'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Reports from './pages/Reports'
import SalesHistory from './pages/SalesHistory'
import Cash from './pages/Cash'
import Users from './pages/Users'
import Settings from './pages/Settings'
import Suggestions from './pages/Suggestions'
import Insights from './pages/Insights'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import SuperAdmin from './pages/SuperAdmin'

const PAGE_COMPONENTS = {
  dashboard:   Dashboard,
  pos:         POS,
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
  suggestions: Suggestions,
  insights:    Insights,
}

function AppShell() {
  const { currentPage, navigate } = useNavigation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const PageComponent = PAGE_COMPONENTS[currentPage] || Dashboard
  const handleNavigate = (page) => {
    navigate(page)
    setSidebarOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#080d18]">

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
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar
          currentPage={currentPage}
          onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        />
        <main className={`flex-1 overflow-y-auto ${currentPage === 'pos' ? 'p-3 md:p-4' : 'p-3 md:p-5'}`}>
          <PageComponent />
        </main>
      </div>
    </div>
  )
}

function AuthGate() {
  const { isAuthenticated, loading, userProfile } = useAuth()
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
    return <SuperAdmin />
  }

  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
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
