import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { AuthUser } from '@ai-workspace/sdk'

const TOKEN_KEY = 'auth_token'
const USER_KEY = 'auth_user'

interface AuthState {
  user: AuthUser | null
  token: string | null
}

// 从 localStorage 恢复会话
const initialState: AuthState = (() => {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    const raw = localStorage.getItem(USER_KEY)
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
    // 登录/注册成功：保存用户信息 + JWT token
    loginSuccess: (state, action: PayloadAction<{ token: string; user: AuthUser }>) => {
      state.token = action.payload.token
      state.user = action.payload.user
      try {
        localStorage.setItem(TOKEN_KEY, action.payload.token)
        localStorage.setItem(USER_KEY, JSON.stringify(action.payload.user))
      } catch {
        // ignore
      }
    },
    logout: (state) => {
      state.token = null
      state.user = null
      try {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
      } catch {
        // ignore
      }
    },
  },
})

export const { loginSuccess, logout } = authSlice.actions
export default authSlice.reducer
