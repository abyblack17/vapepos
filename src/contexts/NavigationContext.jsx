import React, { createContext, useContext, useState } from 'react'

const NavigationContext = createContext({ navigate: () => {} })

export function useNavigation() {
  return useContext(NavigationContext)
}

export function NavigationProvider({ children }) {
  const [currentPage, setCurrentPage] = useState('dashboard')

  const navigate = (page) => setCurrentPage(page)

  return (
    <NavigationContext.Provider value={{ currentPage, navigate }}>
      {children}
    </NavigationContext.Provider>
  )
}
