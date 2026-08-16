import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { AuthUser } from '@ai-workspace/sdk'

const TOKEN_KEY = 'aiws-token'

interface AuthState {
  user: AuthUser | null
  token: string | null
}

// 从 localStorage 恢复会话
const initialState: AuthState = (() => {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const raw = localStorage.getItem('aiws-user')
    const user: AuthUser | null = raw ? JSON.parse(raw) : null
    return token && user ? { token, user } : { token: null, user: null }
  } catch {
    return { token: null, user: null }
  }
})()

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess: (state, action: PayloadAction<{ token: string; user: AuthUser }>) => {
      state.token = action.payload.token
      state.user = action.payload.user
      try {
        localStorage.setItem(TOKEN_KEY, action.payload.token)
        localStorage.setItem('aiws-user', JSON.stringify(action.payload.user))
      } catch {
        // ignore
      }
    },
    setUser: (state, action: PayloadAction<AuthUser | null>) => {
      state.user = action.payload
      if (!action.payload) return
      try {
        localStorage.setItem('aiws-user', JSON.stringify(action.payload))
      } catch {
        // ignore
      }
    },
    logout: (state) => {
      state.token = null
      state.user = null
      try {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem('aiws-user')
      } catch {
        // ignore
      }
    },
  },
})

export const { loginSuccess, setUser, logout } = authSlice.actions
export default authSlice.reducer
