// ===== 会话管理 =====
export interface ChatSession {
  id: string
  title: string
  date: string
  pinned: boolean
}

// ===== 认证管理 =====
export interface AuthUser {
  id: string
  email: string
  name?: string | null
  avatar?: string | null
  token: string
}

export type LoginResponse = AuthUser

export interface RegisterRequest {
  email: string
  password: string
  name?: string
}

// ===== 消息管理 =====
export interface MessageSource {
  documentId: string
  documentName: string
}

export interface ToolActivityInfo {
  id: string
  name: string
  args: Record<string, unknown>
  output: string
  status: 'ok' | 'error' | 'denied'
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  model?: string
  sources?: MessageSource[]
  tools?: ToolActivityInfo[]
}

// ===== 知识库管理 =====
export interface KnowledgeDocument {
  id: string
  name: string
  size: number
  chunks: number
  status: string
}

export interface KnowledgePage {
  items: KnowledgeDocument[]
  total: number
  page: number
  pageSize: number
}

export interface KnowledgeHit {
  content: string
  score: number
  documentId: string
  documentName: string
  index: number
}

export interface KnowledgeChunk {
  id: string
  index: number
  content: string
}

// ===== 提示词管理 =====
export interface Prompt {
  id: string
  name: string
  category: string
  description?: string | null
  content: string
  preset: boolean
  createdBy?: string | null
}

// ===== 设置管理 =====
export interface SettingsItem {
  key: string
  group: 'llm' | 'embedding' | 'rag'
  value: string
  sensitive: boolean
}

// ===== 完成请求管理 =====
export interface CompletionRequest {
  prompt: string
  model?: string
  useRag?: boolean
}

// ===== 完成响应管理 =====
export interface CompletionResponse {
  success: boolean
  data: string
  sources?: MessageSource[]
  tools?: ToolActivityInfo[]
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
export type NavTab = 'chat' | 'tickets' | 'knowledge' | 'prompts' | 'tasks' | 'settings'

// ===== Agent 任务管理 =====
export interface AgentTaskStep {
  id: string
  order: number
  title: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  output?: string
  error?: string | null
}

export interface AgentTask {
  id: string
  title: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  error?: string | null
  prompt: string
  result?: string | null
  steps: AgentTaskStep[]
  createdAt: string
  updatedAt: string
}

// 工具调用确认请求
export interface ToolApprovalInfo {
  toolCallId: string
  name: string
  args: Record<string, unknown>
}

// ===== 企业工单助手 =====
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TicketStatus = 'open' | 'analyzing' | 'pending_approval' | 'resolved' | 'closed'

export interface TicketSource {
  documentId: string
  documentName: string
  chunkIndex: number
  score: number
}

export interface TicketSuggestion {
  id: string
  ticketId: string
  version: number
  status: 'pending' | 'approved' | 'rejected'
  summary: string
  reply: string
  sources?: TicketSource[] | null
  model?: string | null
  decisionNote?: string | null
  decidedAt?: string | null
  createdAt: string
}

export interface TicketAuditEvent {
  id: string
  action: string
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export interface SupportTicket {
  id: string
  externalRef?: string | null
  title: string
  description: string
  customerName: string
  customerEmail?: string | null
  priority: TicketPriority
  status: TicketStatus
  finalReply?: string | null
  repliedAt?: string | null
  suggestions: TicketSuggestion[]
  auditEvents?: TicketAuditEvent[]
  createdAt: string
  updatedAt: string
}
