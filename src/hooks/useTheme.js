import { useState, useEffect, useCallback } from 'react'

const THEME_KEY = 'theme'

function applyThemeClass(theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    applyThemeClass(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      applyThemeClass(next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
