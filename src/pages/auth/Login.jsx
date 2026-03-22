import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function Login({ onGoRegister }) {
  const { login, error, setError } = useAuth()
  const [form, setForm]     = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) { toast.error('Completa todos los campos'); return }
    setLoading(true)
    const result = await login(form.email, form.password)
    if (!result.success) { toast.error(result.error) }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#080d18] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="font-display text-4xl font-black gradient-neon mb-2">VapePOS</div>
          <div className="text-slate-500 text-sm">Sistema POS para Tiendas de Vape</div>
        </div>

        <div className="bg-[#0c1424] border border-white/10 rounded-2xl p-8">
          <div className="font-display font-bold text-slate-100 text-xl mb-6">Iniciar Sesion</div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Correo electronico</label>
              <input
                className="input"
                type="email"
                placeholder="correo@tienda.com"
                value={form.email}
                onChange={e => { set('email', e.target.value); setError(null) }}
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Contrasena</label>
              <input
                className="input"
                type="password"
                placeholder="********"
                value={form.password}
                onChange={e => { set('password', e.target.value); setError(null) }}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="alert-danger text-xs">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-sm font-bold mt-2"
            >
              {loading ? 'Iniciando sesion...' : 'Entrar al Sistema'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-white/10 text-center">
            <button
              onClick={onGoRegister}
              className="text-sm text-[#00c4e8] hover:text-[#00e5a0] transition-colors"
            >
              No tienes cuenta? Registra tu tienda
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
