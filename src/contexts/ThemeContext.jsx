import React, { createContext, useContext } from 'react'

// Modo claro deshabilitado temporalmente
// ThemeContext se mantiene para no romper imports existentes
const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {}, isLight: false })

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }) {
  // Siempre modo oscuro
  return (
    <ThemeContext.Provider value={{ theme: 'dark', toggleTheme: () => {}, isLight: false }}>
      {children}
    </ThemeContext.Provider>
  )
}
