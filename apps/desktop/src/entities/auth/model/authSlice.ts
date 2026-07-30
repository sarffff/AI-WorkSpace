import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface UserInfo {
  id: string
  email: string
  name: string
  avatar?: string | null
}

interface AuthState {
  user: UserInfo | null
}

const initialState: AuthState = {
  user: loadUser(),
}

function loadUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem('auth_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
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
      localStorage.removeItem('auth_user')
    },
  },
})

export const { setUser, logout } = authSlice.actions
export default authSlice.reducer
