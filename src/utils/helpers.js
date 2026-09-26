// ── Currency ──
export function fmt(n) {
  if (n === null || n === undefined) return 'RD$0'
  return 'RD$' + Math.round(n).toLocaleString('es-DO')
}

// ── Date ──
export function today() {
  return localDateKey(new Date())
}

// Clave YYYY-MM-DD usando la zona horaria local. Evita que toISOString()
// mueva operaciones nocturnas al día siguiente por convertirlas a UTC.
export function localDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTime() {
  return new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
}

// ── IDs ──
export function genId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ── Bottle progress color ──
export function bottleColor(pct) {
  if (pct > 50) return 'bottle-fill-green'
  if (pct > 25) return 'bottle-fill-yellow'
  return 'bottle-fill-red'
}

export function bottleTextColor(pct) {
  if (pct > 50) return 'text-neon-green'
  if (pct > 25) return 'text-amber-400'
  return 'text-red-400'
}

// ── Permisos base por rol (plantilla) ──────────────────────
// Estos son los permisos DEFAULT cuando se crea un usuario.
// El admin puede ajustar permisos individuales desde Usuarios.
export const ROLE_PERMISSIONS = {
  Administrador: {
    // Modulos
    dashboard: true, pos: true, refills: true, inventory: true,
    purchases: true, customers: true, suppliers: true, reports: true,
    cash: true, users: true, settings: true, suggestions: true, insights: true,
    // Granulares
    viewProfit: true, deleteInvoice: true, editInvoice: true,
    viewRendimiento: true, deleteProduct: true, manageUsers: true,
    refillsTabs: 'all', // 'all' | 'active' | 'active+hist'
  },
  Encargado: {
    dashboard: true, pos: true, refills: true, inventory: true,
    purchases: true, customers: true, suppliers: false, reports: true,
    cash: true, users: false, settings: false, suggestions: false, insights: true,
    viewProfit: false, deleteInvoice: false, editInvoice: false,
    viewRendimiento: false, deleteProduct: false, manageUsers: false,
    refillsTabs: 'active+hist',
  },
  Cajero: {
    dashboard: true, pos: true, refills: true, inventory: false,
    purchases: false, customers: true, suppliers: false, reports: false,
    cash: true, users: false, settings: false, suggestions: false, insights: false,
    viewProfit: false, deleteInvoice: false, editInvoice: false,
    viewRendimiento: false, deleteProduct: false, manageUsers: false,
    refillsTabs: 'active',
  },
}

// Genera los permisos completos para un usuario nuevo segun su rol
export function defaultPermissions(role) {
  return { ...ROLE_PERMISSIONS[role] } || { ...ROLE_PERMISSIONS.Cajero }
}

// Verifica si el usuario puede hacer algo
// Prioridad: permisos individuales del usuario > permisos del rol
export function canDo(user, permission) {
  if (!user) return false
  // Admin siempre tiene todo
  if (user.role === 'Administrador') return true
  // Si tiene permisos individuales configurados, usarlos
  if (user.permissions && permission in user.permissions) {
    return !!user.permissions[permission]
  }
  // Fallback a permisos del rol
  return ROLE_PERMISSIONS[user.role]?.[permission] ?? false
}

// Compatibilidad con canAccess existente
export function canAccess(role, module) {
  return ROLE_PERMISSIONS[role]?.[module] ?? false
}

// ── Number helpers ──
export function pct(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

export function margin(price, cost) {
  if (!price) return 0
  return Math.round(((price - cost) / price) * 100)
}

// ── Category colors ──
export const CATEGORY_COLORS = {
  Desechables: 'badge-green',
  Dispositivos: 'badge-blue',
  Pods: 'badge-purple',
  Repuestos: 'badge-amber',
  Accesorios: 'badge-gray',
  Atomizadores: 'badge-red',
  Frutas: 'badge-green',
  Mentolados: 'badge-blue',
  Tabaco: 'badge-amber',
  Postres: 'badge-purple',
}

export function categoryBadge(cat) {
  return CATEGORY_COLORS[cat] || 'badge-gray'
}

// ── Payment icon ──
export function paymentIcon(method) {
  const icons = {
    Efectivo: '💵',
    Transferencia: '📲',
    Tarjeta: '💳',
    Mixto: '🔀',
  }
  return icons[method] || '💰'
}

// ── Truncate text ──
export function truncate(str, n = 30) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + '…' : str
}
