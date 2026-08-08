import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

/** Operator < Supervisor < Manager < Admin */
const LEVELS = ['OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN']

function normalizeAccessLevel(raw) {
  const value = String(raw || '').toUpperCase().trim()
  if (LEVELS.includes(value)) return value
  if (
    value.includes('ADMIN') ||
    value.includes('MANAGING DIRECTOR') ||
    value === 'MD'
  ) {
    return 'ADMIN'
  }
  if (value.includes('MANAGER')) return 'MANAGER'
  if (value.includes('SUPERVISOR')) return 'SUPERVISOR'
  return 'OPERATOR'
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function restoreSession() {
      const stored = localStorage.getItem('dascnc_user')
      if (!stored) {
        if (mounted) setLoading(false)
        return
      }

      try {
        const parsed = JSON.parse(stored)
        api.defaults.headers.common['Authorization'] = `Bearer ${parsed.token}`
        const { data } = await api.get('/auth/me')

        if (!mounted) return
        const accessLevel = normalizeAccessLevel(
          data.employee.access_level || data.employee.job_description
        )
        setUser({
          ...parsed,
          id: data.employee.id,
          name: data.employee.full_name,
          code: data.employee.employee_code,
          job_description: data.employee.job_description,
          shift: data.employee.shift_name,
          department: data.employee.department,
          accessLevel,
          is_active: data.employee.is_active !== false,
        })
      } catch {
        localStorage.removeItem('dascnc_user')
        delete api.defaults.headers.common['Authorization']
        if (mounted) setUser(null)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    restoreSession()

    return () => {
      mounted = false
    }
  }, [])

  async function login(employeeCode, password) {
    const { data } = await api.post('/auth/login', { employeeCode, password })
    const accessLevel = normalizeAccessLevel(
      data.employee.access_level || data.employee.job_description
    )
    const userData = {
      id: data.employee.id,
      name: data.employee.full_name,
      code: data.employee.employee_code,
      job_description: data.employee.job_description,
      shift: data.employee.shift_name,
      department: data.employee.department,
      token: data.token,
      accessLevel,
      is_active: data.employee.is_active !== false,
    }
    setUser(userData)
    localStorage.setItem('dascnc_user', JSON.stringify(userData))
    api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
    return userData
  }

  function logout() {
    setUser(null)
    localStorage.removeItem('dascnc_user')
    delete api.defaults.headers.common['Authorization']
  }

  function hasAccess(required) {
    if (!user) return false
    return LEVELS.indexOf(user.accessLevel) >= LEVELS.indexOf(required)
  }

  /** MANAGER + OPERATOR: shop-floor shell (My Today only). ADMIN + SUPERVISOR: full app. */
  function isFloorOnly() {
    if (!user) return false
    return user.accessLevel === 'MANAGER' || user.accessLevel === 'OPERATOR'
  }

  function defaultHomePath() {
    return isFloorOnly() ? '/production/today' : '/home'
  }

  const value = useMemo(
    () => ({ user, loading, login, logout, hasAccess, isFloorOnly, defaultHomePath }),
    [user, loading]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export { normalizeAccessLevel }
