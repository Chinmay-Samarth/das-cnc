import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import api from '../api/client'
import {
  getRoleHomePath,
  isRestrictedRole,
  isRoleAllowedPath,
} from './financeAccess'

const AuthContext = createContext(null)

/** Operator < Supervisor < Manager < Admin (Finance/QC are peer roles, not in this ladder). */
const LEVELS = ['OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN']

function normalizeAccessLevel(raw) {
  const value = String(raw || '').toUpperCase().trim()
  if (value === 'FINANCE' || value.includes('FINANCE')) return 'FINANCE'
  if (value === 'QC' || value.includes('QUALITY')) return 'QC'
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

function buildUserFromEmployee(employee, token) {
  return {
    id: employee.id,
    name: employee.full_name,
    code: employee.employee_code,
    job_description: employee.job_description,
    shift: employee.shift_name,
    department: employee.department,
    token,
    accessLevel: normalizeAccessLevel(employee.access_level || employee.job_description),
    is_active: employee.is_active !== false,
    must_change_password: Boolean(employee.must_change_password),
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const persistUser = useCallback((userData) => {
    setUser(userData)
    localStorage.setItem('dascnc_user', JSON.stringify(userData))
    api.defaults.headers.common['Authorization'] = `Bearer ${userData.token}`
  }, [])

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
        persistUser(buildUserFromEmployee(data.employee, parsed.token))
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
  }, [persistUser])

  async function login(employeeCode, password) {
    const { data } = await api.post('/auth/login', { employeeCode, password })
    const userData = buildUserFromEmployee(data.employee, data.token)
    persistUser(userData)
    return userData
  }

  function logout() {
    setUser(null)
    localStorage.removeItem('dascnc_user')
    delete api.defaults.headers.common['Authorization']
  }

  async function changePassword({ currentPassword, newPassword, confirmPassword }) {
    const { data } = await api.post('/auth/change-password', {
      currentPassword,
      newPassword,
      confirmPassword,
    })
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, must_change_password: false }
      localStorage.setItem('dascnc_user', JSON.stringify(next))
      return next
    })
    return data
  }

  function hasAccess(required) {
    if (!user) return false
    if (isRestrictedRole(user.accessLevel)) return false
    return LEVELS.indexOf(user.accessLevel) >= LEVELS.indexOf(required)
  }

  /** MANAGER + OPERATOR: shop-floor shell. Restricted roles get the full shell with page allowlists. */
  function isFloorOnly() {
    if (!user) return false
    return user.accessLevel === 'MANAGER' || user.accessLevel === 'OPERATOR'
  }

  function isAdmin() {
    return user?.accessLevel === 'ADMIN'
  }

  function isFinance() {
    return user?.accessLevel === 'FINANCE'
  }

  function isQc() {
    return user?.accessLevel === 'QC'
  }

  function canAccessPath(pathname) {
    if (!user) return false
    if (!isRestrictedRole(user.accessLevel)) return true
    return isRoleAllowedPath(user.accessLevel, pathname)
  }

  function defaultHomePath() {
    if (!user) return '/auth/login'
    if (user.accessLevel === 'ADMIN') return '/home'
    const roleHome = getRoleHomePath(user.accessLevel)
    if (roleHome) return roleHome
    return '/production/today'
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      changePassword,
      hasAccess,
      isFloorOnly,
      isAdmin,
      isFinance,
      isQc,
      canAccessPath,
      defaultHomePath,
    }),
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
