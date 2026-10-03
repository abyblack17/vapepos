let active = false
export const isSupportMode = () => active
export function enterSupportMode() { active = true; return () => { active = false } }
export function assertSupportWritable() {
  if (active) {
    const error = new Error('Modo soporte: solo puedes consultar. No se guardan cambios.')
    error.code = 'support/read-only'
    throw error
  }
}
