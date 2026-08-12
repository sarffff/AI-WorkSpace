import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import type {
  Message,
  ChatSession,
  NavTab,
  MessageSource,
  ToolActivityInfo,
} from '@ai-workspace/sdk'

interface ChatState {
  activeTab: NavTab
  selectedModel: string
  models: string[]
  ragEnabled: boolean
  isGenerating: boolean
  serverStatus: 'checking' | 'online' | 'offline'
  currentChatId: string | null
  sessions: ChatSession[]
  pendingSessions: ChatSession[]
  messagesBySession: Record<string, Message[]>
  draftPrompt: string | null
}

const initialState: ChatState = {
  activeTab: 'chat',
  selectedModel: 'glm-4.5-air',
  models: ['glm-4.5-air'],
  ragEnabled: true,
  isGenerating: false,
  serverStatus: 'checking',
  currentChatId: null,
  sessions: [],
  pendingSessions: [],
  messagesBySession: {},
  draftPrompt: null,
}

let _nextId = 1
const genId = () => `chat_${Date.now()}_${_nextId++}`

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<NavTab>) => {
      state.activeTab = action.payload
    },
    setSelectedModel: (state, action: PayloadAction<string>) => {
      state.selectedModel = action.payload
    },
    setModels: (state, action: PayloadAction<string[]>) => {
      if (action.payload.length > 0) state.models = action.payload
    },
    setRagEnabled: (state, action: PayloadAction<boolean>) => {
      state.ragEnabled = action.payload
    },
    setDraftPrompt: (state, action: PayloadAction<string | null>) => {
      state.draftPrompt = action.payload
    },
    setIsGenerating: (state, action: PayloadAction<boolean>) => {
      state.isGenerating = action.payload
    },
    setServerStatus: (state, action: PayloadAction<'checking' | 'online' | 'offline'>) => {
      state.serverStatus = action.payload
    },

    // ===== 会话管理 =====

    createChat: {
      reducer: (state, action: PayloadAction<string | undefined>) => {
        const id = action.payload ?? genId()
        const session: ChatSession = {
          id,
          title: '新对话',
          date: now(),
          pinned: false,
        }
        state.pendingSessions.unshift(session)
        state.currentChatId = id
        state.messagesBySession[id] = []
        state.activeTab = 'chat'
      },
      prepare: (id?: string) => ({ payload: id }),
    },

    promoteChat: (state, action: PayloadAction<string>) => {
      const idx = state.pendingSessions.findIndex((s) => s.id === action.payload)
      if (idx === -1) return
      const [session] = state.pendingSessions.splice(idx, 1)
      session.date = now()
      state.sessions.unshift(session)
    },

    setCurrentChat: (state, action: PayloadAction<string | null>) => {
      state.currentChatId = action.payload
      if (action.payload) state.activeTab = 'chat'
    },

    renameChat: (state, action: PayloadAction<{ id: string; title: string }>) => {
      const s = state.sessions.find((s) => s.id === action.payload.id)
      if (s) s.title = action.payload.title
    },

    deleteChat: (state, action: PayloadAction<string>) => {
      const id = action.payload
      state.sessions = state.sessions.filter((s) => s.id !== id)
      state.pendingSessions = state.pendingSessions.filter((s) => s.id !== id)
      delete state.messagesBySession[id]
      if (state.currentChatId === id) {
        state.currentChatId = state.sessions[0]?.id ?? state.pendingSessions[0]?.id ?? null
      }
    },

    togglePinChat: (state, action: PayloadAction<string>) => {
      const s = state.sessions.find((s) => s.id === action.payload)
      if (s) s.pinned = !s.pinned
    },
    setSessions: (state, action: PayloadAction<ChatSession[]>) => {
      state.sessions = action.payload
    },

    // ===== 消息管理 =====

    addMessage: (state, action: PayloadAction<Message>) => {
      const sid = action.payload.sessionId
      if (!state.messagesBySession[sid]) {
        state.messagesBySession[sid] = []
      }
      state.messagesBySession[sid].push(action.payload)
    },

    appendToMessage: (
      state,
      action: PayloadAction<{ id: string; sessionId: string; content: string }>,
    ) => {
      const msgs = state.messagesBySession[action.payload.sessionId]
      if (!msgs) return
      const msg = msgs.find((m) => m.id === action.payload.id)
      if (msg) msg.content += action.payload.content
    },

    updateMessageContent: (
      state,
      action: PayloadAction<{ id: string; sessionId: string; content: string }>,
    ) => {
      const msgs = state.messagesBySession[action.payload.sessionId]
      if (!msgs) return
      const msg = msgs.find((m) => m.id === action.payload.id)
      if (msg) msg.content = action.payload.content
    },

    updateMessageSources: (
      state,
      action: PayloadAction<{ id: string; sessionId: string; sources: MessageSource[] }>,
    ) => {
      const msgs = state.messagesBySession[action.payload.sessionId]
      if (!msgs) return
      const msg = msgs.find((m) => m.id === action.payload.id)
      if (msg) msg.sources = action.payload.sources
    },

    updateMessageTools: (
      state,
      action: PayloadAction<{ id: string; sessionId: string; tools: ToolActivityInfo[] }>,
    ) => {
      const msgs = state.messagesBySession[action.payload.sessionId]
      if (!msgs) return
      const msg = msgs.find((m) => m.id === action.payload.id)
      if (msg) msg.tools = action.payload.tools
    },

    setMessages: (state, action: PayloadAction<{ sessionId: string; messages: Message[] }>) => {
      state.messagesBySession[action.payload.sessionId] = action.payload.messages
    },
  },
})

export const {
  setActiveTab,
  setSelectedModel,
  setModels,
  setRagEnabled,
  setDraftPrompt,
  setIsGenerating,
  setServerStatus,
  createChat,
  promoteChat,
  setCurrentChat,
  renameChat,
  deleteChat,
  togglePinChat,
  setSessions,
  addMessage,
  appendToMessage,
  updateMessageContent,
  updateMessageSources,
  updateMessageTools,
  setMessages,
} = chatSlice.actions

export default chatSlice.reducer
