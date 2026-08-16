// ===== 应用配置 =====
export interface AppSettings {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
}

// ===== 认证 =====
export interface AuthUser {
  id: string
  email: string
  name: string | null
  avatar: string | null
}

export interface AuthResponse {
  token: string
  user: AuthUser
}

export interface ChatSession {
  id: string
  title: string
  date: string
  pinned: boolean
}

// ===== 消息管理 =====
export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  model?: string
}

// ===== 知识库管理 =====
export interface KnowledgeDocument {
  id: string
  name: string
  size: number
  chunks: number
  status: string
}

// ===== 完成请求管理 =====
export interface CompletionRequest {
  prompt: string
  model?: string
}

// ===== 完成响应管理 =====
export interface CompletionResponse {
  success: boolean
  data: string
}

// ===== WebSocket 消息管理 =====
export interface WsPromptMessage {
  event: 'ai:prompt'
  data: {
    prompt: string
    model: string
  }
}

// ===== WebSocket 响应消息管理 =====
export interface WsResponseMessage {
  event: 'ai:response'
  data: {
    content: string
    done: boolean
  }
}

// ===== 导航标签管理 =====
export type NavTab = 'chat' | 'knowledge' | 'prompts' | 'settings'
