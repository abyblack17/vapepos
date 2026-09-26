import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function Register({ onGoLogin }) {
  const { registerBusiness, error, setError } = useAuth()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    businessName: '',
    ownerName:    '',
    email:        '',
    password:     '',
    confirmPwd:   '',
    phone:        '',
    address:      '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.businessName || !form.ownerName || !form.email || !form.password) {
      toast.error('Completa los campos obligatorios')
      return
    }
    if (form.password !== form.confirmPwd) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    if (form.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }

    setLoading(true)
    const result = await registerBusiness(form)
    if (result.success) {
      toast.success(`¡Bienvenido! Tu tienda "${form.businessName}" fue creada.`)
    } else {
      toast.error(result.error)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#080d18] flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="font-display text-4xl font-black gradient-neon mb-2">⚡ VapePOS</div>
          <div className="text-slate-500 text-sm">Registra tu tienda y empieza en minutos</div>
        </div>

        <div className="bg-[#0c1424] border border-white/10 rounded-2xl p-8">
          <div className="font-display font-bold text-slate-100 text-xl mb-6">Crear Nueva Tienda</div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Business info */}
            <div className="bg-[#101c35] rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Datos del Negocio</div>
              <div>
                <label className="label">Nombre de la tienda *</label>
                <input className="input" placeholder="Vape Store RD" value={form.businessName} onChange={e => set('businessName', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" placeholder="809-555-0000" value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div>
                  <label className="label">Dirección</label>
                  <input className="input" placeholder="Ciudad, País" value={form.address} onChange={e => set('address', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Owner account */}
            <div className="bg-[#101c35] rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Cuenta de Administrador</div>
              <div>
                <label className="label">Tu nombre *</label>
                <input className="input" placeholder="Juan Pérez" value={form.ownerName} onChange={e => set('ownerName', e.target.value)} />
              </div>
              <div>
                <label className="label">Correo electrónico *</label>
                <input className="input" type="email" placeholder="admin@tutienda.com" value={form.email} onChange={e => { set('email', e.target.value); setError?.(null) }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Contraseña *</label>
                  <input className="input" type="password" minLength={8} maxLength={128} placeholder="Min. 8 caracteres" value={form.password} onChange={e => set('password', e.target.value)} />
                </div>
                <div>
                  <label className="label">Confirmar contraseña *</label>
                  <input className="input" type="password" placeholder="Repetir contraseña" value={form.confirmPwd} onChange={e => set('confirmPwd', e.target.value)} />
                </div>
              </div>
            </div>

            {error && <div className="alert-danger text-xs">{error}</div>}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-sm font-bold"
            >
              {loading ? 'Creando tu tienda...' : '🚀 Crear Mi Tienda'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-white/8 text-center">
            <button onClick={onGoLogin} className="text-sm text-[#00c4e8] hover:text-[#00e5a0] transition-colors">
              ← Ya tengo una cuenta
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
