import type {
  CompletionRequest,
  CompletionResponse,
  KnowledgeDocument,
  AppSettings,
  AuthResponse,
  AuthUser,
} from '@ai-workspace/types'

export type StreamChunk = { content?: string; done?: boolean; error?: string }

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
  createdAt: string
}

export class HttpClient {
  // 已登录用户的 JWT，登录成功后设置，随后可附到请求头
  token: string | null = null

  constructor(private baseUrl: string) {}

  // 通用 JSON 请求
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!res.ok) {
      // 尝试解析 NestJS 异常体中的 message 字段
      let detail = ''
      try {
        const body = await res.json()
        if (typeof body?.message === 'string') detail = body.message
      } catch {
        // ignore
      }
      throw new Error(detail || `HTTP ${res.status}: ${res.statusText}`)
    }
    return res.json()
  }

  // ===== 认证 =====

  // 注册新用户，返回 token + 用户信息
  async register(input: { email: string; password: string; name?: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  // 登录，返回 token + 用户信息
  async login(input: { email: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  // 校验 token，返回当前用户信息
  async me(): Promise<AuthUser> {
    return this.request<AuthUser>('/auth/me', {
      headers: { Authorization: `Bearer ${this.token}` },
    })
  }

  // ===== 会话管理 =====

  // 获取最近对话列表
  async getChats(): Promise<ServerChatSession[]> {
    return this.request<ServerChatSession[]>('/chats')
  }

  // 创建新会话
  async createChat(title?: string): Promise<ServerChatSession> {
    return this.request<ServerChatSession>('/chats', {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
  }

  // 重命名会话
  async renameChat(id: string, title: string): Promise<ServerChatSession> {
    return this.request<ServerChatSession>(`/chats/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  }

  // 切换固定状态
  async togglePinChat(id: string): Promise<ServerChatSession> {
    return this.request<ServerChatSession>(`/chats/${id}/pin`, {
      method: 'PATCH',
    })
  }

  // 删除会话
  async deleteChat(id: string): Promise<void> {
    await this.request<unknown>(`/chats/${id}`, { method: 'DELETE' })
  }

  // 获取会话消息
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

  // 获取知识库文档列表
  async getDocuments(): Promise<KnowledgeDocument[]> {
    return this.request<KnowledgeDocument[]>('/knowledge/documents')
  }

  // 探测后端是否在线
  async ping(): Promise<boolean> {
    try {
      await this.request<unknown>('/chats')
      return true
    } catch {
      return false
    }
  }

  // ===== 配置管理 =====

  // 获取全部配置
  async getSettings(): Promise<AppSettings> {
    return this.request<AppSettings>('/settings')
  }

  // 更新配置（部分更新）
  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return this.request<AppSettings>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
  }

  // 流式发消息 — 返回 AsyncGenerator，逐 chunk 消费
  async *streamMessage(
    chatId: string,
    req: CompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${this.baseUrl}/chats/${chatId}/completions/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    })

    if (!res.ok) {
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
