import { configureStore } from '@reduxjs/toolkit'
import chatReducer from '@/entities/chat/model/chatSlice'

export const store = configureStore({
  reducer: {
    chat: chatReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
