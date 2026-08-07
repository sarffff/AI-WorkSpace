import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface UserInfo {
  id: string
  email: string
  name: string
  avatar?: string | null
}

interface AuthState {
  user: UserInfo | null
  token: string | null
}

const initialState: AuthState = {
  user: loadUser(),
  token: loadToken(),
}

function loadUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem('auth_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function loadToken(): string | null {
  try {
    return localStorage.getItem('auth_token')
  } catch {
    return null
  }
}

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // 登录/注册成功：保存用户信息 + JWT token
    loginSuccess: (state, action: PayloadAction<{ user: UserInfo; token: string }>) => {
      state.user = action.payload.user
      state.token = action.payload.token
      try {
        localStorage.setItem('auth_user', JSON.stringify(action.payload.user))
        localStorage.setItem('auth_token', action.payload.token)
      } catch {
        // ignore
      }
    },
    setUser: (state, action: PayloadAction<UserInfo | null>) => {
      state.user = action.payload
      if (action.payload) {
        localStorage.setItem('auth_user', JSON.stringify(action.payload))
      } else {
        localStorage.removeItem('auth_user')
      }
    },
    logout: (state) => {
      state.user = null
      state.token = null
      localStorage.removeItem('auth_user')
      localStorage.removeItem('auth_token')
    },
  },
})

export const { loginSuccess, setUser, logout } = authSlice.actions
export default authSlice.reducer
