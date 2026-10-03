import React, { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function Login({ onGoRegister }) {
  const { login, resetPassword, error, setError } = useAuth()
  const [form, setForm]     = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) { toast.error('Completa todos los campos'); return }
    setLoading(true)
    const result = await login(form.email, form.password)
    if (!result.success) { toast.error(result.error) }
    setLoading(false)
  }

  const openReset = () => {
    setResetEmail(form.email.trim())
    setError(null)
    setShowReset(true)
  }

  const handleReset = async (e) => {
    e.preventDefault()
    const email = resetEmail.trim()
    if (!email) {
      toast.error('Ingresa tu correo electronico')
      return
    }

    setResetLoading(true)
    const result = await resetPassword(email)
    setResetLoading(false)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    toast.success('Revisa tu correo para cambiar la contraseña')
    setShowReset(false)
  }

  return (
    <div className="auth-screen bg-[#080d18]">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="font-display text-4xl font-black gradient-neon mb-2">VapePOS</div>
          <div className="text-slate-500 text-sm">Sistema POS para Tiendas de Vape</div>
        </div>

        <div className="bg-[#0c1424] border border-white/10 rounded-2xl p-8">
          <div className="font-display font-bold text-slate-100 text-xl mb-2">
            {showReset ? 'Restablecer contraseña' : 'Iniciar Sesion'}
          </div>

          {showReset && (
            <p className="text-sm text-slate-400 mb-6">
              Ingresa el correo de tu cuenta y recibirás un enlace para crear una contraseña nueva.
            </p>
          )}

          <form onSubmit={showReset ? handleReset : handleSubmit} className="space-y-4">
            <div>
              <label className="label">Correo electronico</label>
              <input
                className="input"
                type="email"
                placeholder="correo@tienda.com"
                value={showReset ? resetEmail : form.email}
                onChange={e => {
                  if (showReset) setResetEmail(e.target.value)
                  else set('email', e.target.value)
                  setError(null)
                }}
                autoComplete="email"
              />
            </div>

            {!showReset && (
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
            )}

            {error && (
              <div className="alert-danger text-xs">{error}</div>
            )}

            <button
              type="submit"
              disabled={showReset ? resetLoading : loading}
              className="btn-primary w-full py-3 text-sm font-bold mt-2"
            >
              {showReset
                ? (resetLoading ? 'Enviando enlace...' : 'Enviar enlace de recuperación')
                : (loading ? 'Iniciando sesion...' : 'Entrar al Sistema')}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setError(null)
              if (showReset) setShowReset(false)
              else openReset()
            }}
            className="w-full mt-4 text-sm text-[#00c4e8] hover:text-[#00e5a0] transition-colors"
          >
            {showReset ? 'Volver a iniciar sesión' : '¿Olvidaste tu contraseña?'}
          </button>

          {!showReset && <div className="mt-5 pt-5 border-t border-white/10 text-center">
            <button
              onClick={onGoRegister}
              className="text-sm text-[#00c4e8] hover:text-[#00e5a0] transition-colors"
            >
              No tienes cuenta? Registra tu tienda
            </button>
          </div>}
        </div>
      </div>
    </div>
  )
}
