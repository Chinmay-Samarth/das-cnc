import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // On mount, restore session from localStorage
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
        setUser({
          ...parsed,
          id: data.employee.id,
          name: data.employee.full_name,
          code: data.employee.employee_code,
          job_description: data.employee.job_description,
          shift: data.employee.shift_name,
          department: data.employee.department,
          accessLevel: data.employee.access_level,
        })
        console.log(data.employee)
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
    const userData = {
      id:           data.employee.id,
      name:         data.employee.full_name,
      code:         data.employee.employee_code,
      job_description:         data.employee.job_description,
      shift:        data.employee.shift_name,
      department:   data.employee.department,
      token:        data.token,
      // Roles: 'ADMIN' | 'MANAGER' | 'SUPERVISOR' | 'OPERATOR'
      accessLevel:  data.employee.access_level,
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

  // Helper: check if user has at least this access level
  // OPERATOR < SUPERVISOR < MANAGER < ADMIN
  const levels = ['OPERATOR', 'SUPERVISOR', 'MANAGER', 'ADMIN']
  function hasAccess(required) {
    if (!user) return false
    return levels.indexOf(user.accessLevel) >= levels.indexOf(required)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasAccess }}>
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