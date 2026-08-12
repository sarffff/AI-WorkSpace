import type {
  CompletionRequest,
  CompletionResponse,
  KnowledgeDocument,
  KnowledgeHit,
  KnowledgePage,
  MessageSource,
  Prompt,
  SettingsItem,
  ToolActivityInfo,
  AgentTask,
  ToolApprovalInfo,
  LoginResponse,
  RegisterRequest,
  SupportTicket,
  TicketPriority,
} from '@ai-workspace/types'

export type StreamChunk = {
  content?: string
  sources?: MessageSource[]
  toolCall?: { id: string; name: string; args: Record<string, unknown> }
  toolResult?: { id: string; name: string; status: 'ok' | 'error' | 'denied' }
  approval?: ToolApprovalInfo
  done?: boolean
  error?: string
}

// 401 → 通知全局登出（Redux 侧通过监听该事件清空登录态）
export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized'

function handleUnauthorized() {
  localStorage.removeItem('auth_user')
  localStorage.removeItem('auth_token')
  try {
    window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT))
  } catch {
    // ignore（非浏览器环境）
  }
}

export interface ServerChatSession {
  id: string
  title: string
  pinned: boolean
  date: string
  preview?: string
}

export interface ServerMessage {
  id: string
  chatId: string
  role: string
  content: string
  model?: string
  sources?: MessageSource[] | null
  tools?: ToolActivityInfo[] | null
  createdAt: string
}

export class HttpClient {
  constructor(private baseUrl: string) {}

  // 附加 Bearer token 的请求头
  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
    const token = localStorage.getItem('auth_token')
    if (token) headers['Authorization'] = `Bearer ${token}`
    return headers
  }

  // 通用 JSON 请求
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.authHeaders(),
      ...options,
    })
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized()
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    return res.json()
  }

  // ===== 认证 =====

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async register(data: RegisterRequest): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // ===== 会话管理 =====

  async getChats(): Promise<ServerChatSession[]> {
    return this.request<ServerChatSession[]>('/chats')
  }

  async createChat(title?: string): Promise<ServerChatSession> {
    return this.request<ServerChatSession>('/chats', {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
  }

  async renameChat(id: string, title: string): Promise<ServerChatSession> {
    return this.request<ServerChatSession>(`/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  }

  async togglePinChat(id: string): Promise<ServerChatSession> {
    return this.request<ServerChatSession>(`/chats/${id}/pin`, {
      method: 'PATCH',
    })
  }

  async deleteChat(id: string): Promise<void> {
    await this.request<unknown>(`/chats/${id}`, { method: 'DELETE' })
  }

  async getMessages(chatId: string): Promise<ServerMessage[]> {
    return this.request<ServerMessage[]>(`/chats/${chatId}/messages`)
  }

  // ===== AI 对话 =====

  // 非流式发消息（一次返回完整回复）
  async sendMessage(chatId: string, req: CompletionRequest): Promise<CompletionResponse> {
    return this.request<CompletionResponse>(`/chats/${chatId}/completions`, {
      method: 'POST',
      body: JSON.stringify(req),
    })
  }

  // ===== 知识库 =====

  // 获取知识库文档列表（分页）
  async getDocuments(page = 1, pageSize = 20): Promise<KnowledgePage> {
    return this.request<KnowledgePage>(`/knowledge/documents?page=${page}&pageSize=${pageSize}`)
  }

  // 上传文档到知识库（自动切块 + 向量化）
  async uploadDocument(file: File | Blob, filename: string): Promise<KnowledgeDocument> {
    const form = new FormData()
    form.append('file', file, filename)
    const res = await fetch(`${this.baseUrl}/knowledge/documents`, {
      method: 'POST',
      headers: { Authorization: this.authHeaders()['Authorization'] || '' },
      body: form,
    })
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized()
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    return res.json()
  }

  // 删除知识库文档（级联删除向量块）
  async deleteDocument(id: string): Promise<void> {
    await this.request<unknown>(`/knowledge/documents/${id}`, { method: 'DELETE' })
  }

  // 重新索引文档（用存储的原始文件重新切块/向量化）
  async reindexDocument(id: string): Promise<KnowledgeDocument> {
    return this.request<KnowledgeDocument>(`/knowledge/documents/${id}/reindex`, {
      method: 'POST',
    })
  }

  // 查看文档切块预览
  async getDocumentChunks(
    id: string,
  ): Promise<{ documentId: string; chunks: { id: string; index: number; content: string }[] }> {
    return this.request(`/knowledge/documents/${id}/chunks`)
  }

  // 语义检索预览（返回命中的片段与分数）
  async searchKnowledge(q: string, topK = 4): Promise<{ success: boolean; data: KnowledgeHit[] }> {
    return this.request(`/knowledge/search?q=${encodeURIComponent(q)}&topK=${topK}`)
  }

  // ===== 提示词 =====

  async getPrompts(): Promise<Prompt[]> {
    return this.request<Prompt[]>('/prompts')
  }

  async createPrompt(data: {
    name: string
    category: string
    description?: string
    content: string
  }): Promise<Prompt> {
    return this.request<Prompt>('/prompts', { method: 'POST', body: JSON.stringify(data) })
  }

  async updatePrompt(
    id: string,
    data: { name?: string; category?: string; description?: string; content?: string },
  ): Promise<Prompt> {
    return this.request<Prompt>(`/prompts/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  }

  async deletePrompt(id: string): Promise<void> {
    await this.request<unknown>(`/prompts/${id}`, { method: 'DELETE' })
  }

  // ===== 设置 =====

  async getSettings(): Promise<{ success: boolean; data: SettingsItem[] }> {
    return this.request('/settings')
  }

  async updateSettings(
    patch: Record<string, string | number | null>,
  ): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  }

  // ===== Agent 任务 =====

  async getTasks(): Promise<AgentTask[]> {
    return this.request<AgentTask[]>('/tasks')
  }

  async createTask(prompt: string): Promise<AgentTask> {
    return this.request<AgentTask>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
  }

  async runTask(id: string): Promise<AgentTask> {
    return this.request<AgentTask>(`/tasks/${id}/run`, { method: 'POST' })
  }

  async deleteTask(id: string): Promise<void> {
    await this.request<unknown>(`/tasks/${id}`, { method: 'DELETE' })
  }

  // ===== 企业工单助手 =====

  async getTickets(status?: string): Promise<SupportTicket[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    return this.request<SupportTicket[]>(`/tickets${query}`)
  }

  async getTicket(id: string): Promise<SupportTicket> {
    return this.request<SupportTicket>(`/tickets/${id}`)
  }

  async createTicket(data: {
    externalRef?: string
    title: string
    description: string
    customerName: string
    customerEmail?: string
    priority?: TicketPriority
  }): Promise<SupportTicket> {
    return this.request<SupportTicket>('/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async generateTicketSuggestion(id: string) {
    return this.request(`/tickets/${id}/generate-suggestion`, { method: 'POST' })
  }

  async decideTicketSuggestion(
    ticketId: string,
    suggestionId: string,
    data: { approved: boolean; content?: string; note?: string },
  ): Promise<SupportTicket> {
    return this.request<SupportTicket>(
      `/tickets/${ticketId}/suggestions/${suggestionId}/decision`,
      { method: 'POST', body: JSON.stringify(data) },
    )
  }

  // ===== HITL 工具审批 =====

  async approveToolCall(chatId: string, toolCallId: string, approved: boolean): Promise<void> {
    await this.request<unknown>(`/chats/${chatId}/tools/approval`, {
      method: 'POST',
      body: JSON.stringify({ toolCallId, approved }),
    })
  }

  // 探测后端是否在线：任何 HTTP 响应（含 401）都说明服务在线，只有网络错误才视为离线
  async ping(): Promise<boolean> {
    try {
      await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return true
    } catch {
      return false
    }
  }

  // 流式发消息 — 返回 AsyncGenerator，逐 chunk 消费
  async *streamMessage(
    chatId: string,
    req: CompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${this.baseUrl}/chats/${chatId}/completions/stream`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(req),
      signal,
    })

    if (!res.ok) {
      if (res.status === 401) handleUnauthorized()
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const raw = trimmed.slice(6)
        if (raw === '[DONE]') return
        try {
          const parsed = JSON.parse(raw)
          yield parsed
        } catch {
          // skip
        }
      }
    }
  }
}
