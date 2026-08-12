import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type { AuthUser } from '@ai-workspace/sdk'

interface AuthState {
  user: AuthUser | null
}

const persisted = localStorage.getItem('auth_user')
let initialUser: AuthUser | null = null
try {
  initialUser = persisted ? (JSON.parse(persisted) as AuthUser) : null
} catch {
  localStorage.removeItem('auth_user')
}

export const authSlice = createSlice({
  name: 'auth',
  initialState: { user: initialUser } as AuthState,
  reducers: {
    setUser: (state, action: PayloadAction<AuthUser>) => {
      state.user = action.payload
      localStorage.setItem('auth_token', action.payload.token)
      localStorage.setItem('auth_user', JSON.stringify(action.payload))
    },
    updateUser: (state, action: PayloadAction<Partial<AuthUser>>) => {
      if (!state.user) return
      state.user = { ...state.user, ...action.payload }
      localStorage.setItem('auth_user', JSON.stringify(state.user))
    },
    logout: (state) => {
      state.user = null
      localStorage.removeItem('auth_token')
      localStorage.removeItem('auth_user')
    },
  },
})

export const { setUser: setAuthUser, logout: logoutUser, updateUser } = authSlice.actions

export default authSlice.reducer
