import type {
  CompletionRequest,
  CompletionResponse,
  KnowledgeDocument,
  KnowledgeGapsResult,
  MessageSource,
  PromptItem,
  TicketItem,
  TicketRef,
  TicketStaff,
  TicketDetail,
  TicketCommentItem,
  TicketStats,
  TicketDraft,
  ToolTraceStep,
  MessageFeedback,
  MessageFeedbackReason,
  AgentRunOverview,
  DeflectionOverview,
  AgentRunItem,
  AgentRunDetail,
  AppSettings,
  AuthResponse,
  AuthUser,
  ChatAttachmentBrief,
} from '@servicedesk/types'

export type StreamChunk = {
  content?: string
  done?: boolean
  error?: string
  /** RAG 引用溯源（先于正文到达） */
  sources?: MessageSource[]
  /** Agent 工具调用轨迹 */
  tool?: ToolTraceStep
  /** Agent 自动创建的工单 */
  ticket?: TicketRef
  /** HITL 建单确认请求（Agent 暂停等待用户决定） */
  confirm?: TicketDraft
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

/**
 * 带 HTTP 状态的上游错误。
 * 状态码是有用的：429（并发超了 / 今天 token 预算用尽）与 409（该会话已有流在跑）
 * 是「拒绝」，换条路重试也没意义；而网络层失败才值得回退到非流式端点。
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 服务端给出的细分原因，如 token_budget */
    readonly reason?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** 把非 2xx 响应翻成 ApiError：优先用服务端写的可读 message */
async function toApiError(res: Response): Promise<ApiError> {
  let detail = ''
  let reason: string | undefined
  try {
    const body = await res.json()
    if (typeof body?.message === 'string') detail = body.message
    if (typeof body?.reason === 'string') reason = body.reason
  } catch {
    // 非 JSON 错误体（网关 HTML 页等）：回落到状态文本
  }
  return new ApiError(detail || `HTTP ${res.status}: ${res.statusText}`, res.status, reason)
}

export interface ServerChatSession {
  id: string
  title: string
  pinned: boolean
  date: string
  preview?: string
  /** 会话累计 LLM token 用量（服务端聚合） */
  tokens?: { promptTokens: number; completionTokens: number }
}

export interface ServerMessage {
  id: string
  chatId: string
  role: string
  content: string
  model?: string
  sources?: MessageSource[] | null
  /** 答案满意度反馈（历史消息重载后据此恢复已评价状态） */
  feedback?: MessageFeedback | null
  feedbackReason?: MessageFeedbackReason | null
  /** 对话附件元数据（仅 user 消息） */
  attachments?: ChatAttachmentBrief[] | null
  createdAt: string
}

// 成员管理视图（仅 admin 接口返回）
export interface ServerUser {
  id: string
  email: string
  name: string | null
  department: string | null
  role: string
  createdAt: string
}

// 站内通知（工单事件 / SLA 预警）
export interface ServerNotification {
  id: string
  userId: string
  type: string
  title: string
  body: string
  payload?: { ticketId?: string } | null
  read: boolean
  createdAt: string
}

// 跨会话长期记忆条目（管理视图）
export interface ServerMemory {
  id: string
  category: string
  content: string
  chatId: string | null
  createdAt: string
  updatedAt: string
}

export class HttpClient {
  // 已登录用户的 JWT（authHeaders 优先读 localStorage，此处仅作显式覆盖入口）
  token: string | null = null

  constructor(private baseUrl: string) {}

  // 运行时切换后端地址（桌面端“服务器地址”配置入口）
  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, '')
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  // 附加 Bearer token 的请求头
  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
    const token = this.token || localStorage.getItem('auth_token')
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
      throw await toApiError(res)
    }
    return res.json()
  }

  // ===== 认证 =====

  // 注册新用户，返回 token + 用户信息
  async register(input: {
    email: string
    password: string
    name?: string
    department?: string
  }): Promise<AuthResponse> {
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
    return this.request<AuthUser>('/auth/me')
  }

  // ===== 成员管理（仅 admin） =====

  // 成员列表 + 部门字典
  async listUsers(): Promise<{ users: ServerUser[]; departments: string[] }> {
    return this.request('/auth/users')
  }

  // 开通账号
  async createUser(input: {
    email: string
    password: string
    name?: string
    department?: string
    role?: string
  }): Promise<ServerUser> {
    return this.request('/auth/users', { method: 'POST', body: JSON.stringify(input) })
  }

  // 修改昵称/部门/角色
  async updateUser(
    id: string,
    input: { name?: string; department?: string; role?: string },
  ): Promise<ServerUser> {
    return this.request(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
  }

  // 重置成员密码
  async resetUserPassword(id: string, password: string): Promise<{ success: boolean }> {
    return this.request(`/auth/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  }

  // ===== 站内通知 =====

  // 最近通知 + 未读数（铃铛轮询）
  async listNotifications(): Promise<{ items: ServerNotification[]; unreadCount: number }> {
    return this.request('/notifications')
  }

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    return this.request(`/notifications/${id}/read`, { method: 'POST' })
  }

  async markAllNotificationsRead(): Promise<{ updated: number }> {
    return this.request('/notifications/read-all', { method: 'POST' })
  }

  // ===== 记忆管理 =====

  // 我的记忆列表
  async listMemories(): Promise<ServerMemory[]> {
    return this.request('/memory')
  }

  async deleteMemory(id: string): Promise<{ success: boolean }> {
    return this.request(`/memory/${id}`, { method: 'DELETE' })
  }

  async clearMemories(): Promise<{ deleted: number }> {
    return this.request('/memory', { method: 'DELETE' })
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

  // 答案满意度反馈：feedback 传 null 撤销评价；reason 仅 down 时有意义
  async setMessageFeedback(
    chatId: string,
    messageId: string,
    feedback: MessageFeedback | null,
    reason?: MessageFeedbackReason | null,
  ): Promise<{ id: string; feedback: MessageFeedback | null }> {
    const res = await this.request<{
      success: boolean
      data: { id: string; feedback: MessageFeedback | null }
    }>(`/chats/${chatId}/messages/${messageId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback, reason: reason ?? null }),
    })
    return res.data
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

  // 知识缺口候选：AI 升级掉、人工解决了的问题 → 待补文档草稿（仅坐席/管理员）
  async getKnowledgeGaps(days = 30, limit = 50): Promise<KnowledgeGapsResult> {
    return this.request<KnowledgeGapsResult>(
      `/knowledge/gap-candidates?days=${days}&limit=${limit}`,
    )
  }

  // 上传文档到知识库（自动切块 + 向量化；department 非空 = 共享至本部门）
  async uploadDocument(
    file: File | Blob,
    filename: string,
    department?: string,
  ): Promise<KnowledgeDocument> {
    const form = new FormData()
    form.append('file', file, filename)
    if (department) form.append('department', department)
    const res = await fetch(`${this.baseUrl}/knowledge/documents`, {
      method: 'POST',
      headers: { Authorization: this.authHeaders()['Authorization'] || '' },
      body: form,
    })
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized()
      throw await toApiError(res)
    }
    return res.json()
  }

  // 文本建文档（与上传同一条索引流水线；缺口候选草稿晋升走这里）
  async createTextDocument(input: {
    name: string
    content: string
    department?: string
  }): Promise<KnowledgeDocument> {
    return this.request<KnowledgeDocument>('/knowledge/documents/text', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  // 删除知识库文档（级联删除向量块）
  async deleteDocument(id: string): Promise<void> {
    await this.request<unknown>(`/knowledge/documents/${id}`, { method: 'DELETE' })
  }

  // 探测后端是否在线
  async ping(): Promise<boolean> {
    try {
      await this.request<unknown>('/chats')
      return true
    } catch (e) {
      // 401 说明后端在线、只是需要登录
      if (e instanceof Error && e.message.includes('HTTP 401')) return true
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

  // ===== 提示词管理 =====

  // 当前用户的提示词列表（首次访问自动初始化预设）
  async listPrompts(): Promise<PromptItem[]> {
    return this.request<PromptItem[]>('/prompts')
  }

  // 新建提示词
  async createPrompt(input: {
    title: string
    content: string
    category?: string
  }): Promise<PromptItem> {
    return this.request<PromptItem>('/prompts', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  // 更新提示词
  async updatePrompt(
    id: string,
    input: { title: string; content: string; category?: string },
  ): Promise<PromptItem> {
    return this.request<PromptItem>(`/prompts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  // 删除提示词
  async deletePrompt(id: string): Promise<void> {
    await this.request<unknown>(`/prompts/${id}`, { method: 'DELETE' })
  }

  // ===== 工单管理 =====

  // 工单列表（员工只看自己的，坐席/管理员看全部）
  async listTickets(): Promise<TicketItem[]> {
    return this.request<TicketItem[]>('/tickets')
  }

  // 可分派坐席列表（转派下拉数据源）
  async listTicketStaff(): Promise<TicketStaff[]> {
    return this.request<TicketStaff[]>('/tickets/staff')
  }

  // 坐席看板统计（偏转率/SLA/响应时长，仅坐席/管理员；days 范围 1-90）
  async getTicketStats(days = 30): Promise<TicketStats> {
    return this.request<TicketStats>(`/tickets/stats?days=${days}`)
  }

  // HITL 建单确认：恢复挂起的 Agent 循环（approved=false 则跳过建单）
  async confirmTicket(chatId: string, requestId: string, approved: boolean): Promise<boolean> {
    const res = await this.request<{ success: boolean }>(`/chats/${chatId}/confirm-ticket`, {
      method: 'POST',
      body: JSON.stringify({ requestId, approved }),
    })
    return res.success
  }

  /**
   * 会话下待确认的建单草稿。SSE 断连/刷新后靠它恢复确认卡 —— 草稿在服务端
   * 持久化为 pending，用户若不重新进入这个会话就永远不知道有个请求等他拍板。
   */
  async listPendingTicketDrafts(chatId: string): Promise<TicketDraft[]> {
    return this.request<TicketDraft[]>(`/chats/${chatId}/ticket-drafts`)
  }

  // 工单详情（含评论 + 系统事件时间线）
  async getTicketDetail(id: string): Promise<TicketDetail> {
    return this.request<TicketDetail>(`/tickets/${id}`)
  }

  // 工单时间线评论（创建者与坐席/管理员可留言）
  async addTicketComment(id: string, content: string): Promise<TicketCommentItem> {
    return this.request<TicketCommentItem>(`/tickets/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
  }

  // 创建工单
  async createTicket(input: {
    title: string
    content: string
    priority?: string
    category?: string
  }): Promise<TicketItem> {
    return this.request<TicketItem>('/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  // 更新工单（状态/优先级/受理人；权限由服务端校验）
  async updateTicket(
    id: string,
    input: {
      status?: string
      priority?: string
      assigneeId?: string | null
      category?: string
    },
  ): Promise<TicketItem> {
    return this.request<TicketItem>(`/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  }

  // 删除工单
  async deleteTicket(id: string): Promise<void> {
    await this.request<unknown>(`/tickets/${id}`, { method: 'DELETE' })
  }

  // ===== Agent 运行运营看板 =====

  // 运行看板概览（KPI/分布/每日趋势，仅坐席/管理员；days 范围 1-90）
  async getAgentRunOverview(days = 30): Promise<AgentRunOverview> {
    return this.request<AgentRunOverview>(`/analytics/overview?days=${days}`)
  }

  // 偏转率：AI 接住的会话里有多少没落成人工工单（含低置信与知识缺口）
  async getDeflection(days = 30): Promise<DeflectionOverview> {
    return this.request<DeflectionOverview>(`/analytics/deflection?days=${days}`)
  }

  // 运行明细列表（最近优先；limit 1-200）
  async listAgentRuns(limit = 50, offset = 0): Promise<AgentRunItem[]> {
    return this.request<AgentRunItem[]>(`/analytics/runs?limit=${limit}&offset=${offset}`)
  }

  // 运行详情（含 steps 轨迹时间线）
  async getAgentRunDetail(id: string): Promise<AgentRunDetail> {
    return this.request<AgentRunDetail>(`/analytics/runs/${id}`)
  }

  // 流式发消息 — 返回 AsyncGenerator，逐 chunk 消费。
  //
  // SSE resume：事件帧带 seq（id 行），网络层断连（非用户取消）时自动以
  // resume+afterSeq 重连回放错过帧 —— 服务端 pump 不因断连而死，
  // 网络抖动/窗口短暂刷新不再丢半截回答。resume 得 404（生成已结束/
  // 服务重启）时静默返回，调用方按常规重载历史消息拿完整答案。
  async *streamMessage(
    chatId: string,
    req: CompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const MAX_RESUME_ATTEMPTS = 3
    let lastSeq = 0
    let mode: 'new' | 'resume' = 'new'

    for (let attempts = 0; ; attempts++) {
      const payload = mode === 'new' ? req : { ...req, resume: true, afterSeq: lastSeq }
      let res: Response
      try {
        res = await fetch(`${this.baseUrl}/chats/${chatId}/completions/stream`, {
          method: 'POST',
          headers: this.authHeaders(),
          body: JSON.stringify(payload),
          signal,
        })
      } catch (err) {
        // 用户取消不是网络故障
        if (signal?.aborted) return
        // 新请求连不上 = 后端不可达，resume 无从谈起：照原语义抛给调用方回退
        if (mode === 'new' || attempts >= MAX_RESUME_ATTEMPTS) throw err
        await new Promise((r) => setTimeout(r, 400 * (attempts + 1)))
        continue
      }

      if (!res.ok) {
        if (res.status === 401) handleUnauthorized()
        // resume 得 404：生成已结束或服务重启，缓冲没了 —— 不抛错，
        // 调用方的历史重载会拿到已落库的完整/半成品回答
        if (mode === 'resume' && res.status === 404) return
        // 服务端在切到 SSE 之前用 JSON 拒绝（并发超了 / 会话忙 / 今天 token 预算用尽）：
        // 只报 statusText 会把「今天用量到顶」这种可读原因丢掉，客户端也无从判断该不该回退
        throw await toApiError(res)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            // seq 记账：断连重连时告诉服务端从哪回放
            if (trimmed.startsWith('id: ')) {
              const seq = parseInt(trimmed.slice(4), 10)
              if (Number.isFinite(seq)) lastSeq = Math.max(lastSeq, seq)
              continue
            }
            if (!trimmed.startsWith('data: ')) continue
            const raw = trimmed.slice(6)
            if (raw === '[DONE]') return
            try {
              yield JSON.parse(raw)
            } catch {
              // skip
            }
          }
        }
        return // 流正常结束
      } catch {
        // 用户主动停止不算断连：退订即可，别去开第二条流
        if (signal?.aborted) return
        // 走到这里就是读流抛错（正常结束已在上面 return）——不需要额外的标志位，
        // 下面的 attempts 判定决定是切 resume 重试还是抛统一错误
      }

      // 网络层断连：切 resume 模式有限重试；超限抛统一错误让调用方走回退
      if (attempts >= MAX_RESUME_ATTEMPTS) {
        throw new ApiError('流连接中断且续订失败，请重试', 0, 'stream_broken')
      }
      mode = 'resume'
      await new Promise((r) => setTimeout(r, 400 * (attempts + 1)))
    }
  }

  // 显式停止生成：流与连接解耦后，abort 只退订，取消泵要走这个端点
  async stopStream(chatId: string): Promise<{ success: boolean }> {
    return this.request(`/chats/${chatId}/stop`, { method: 'POST' })
  }

  // ===== 对话附件 =====

  // 上传对话附件（composer 纸夹）：返回芯片元数据
  async uploadChatAttachment(
    chatId: string,
    file: File | Blob,
    filename: string,
  ): Promise<ChatAttachmentBrief> {
    const form = new FormData()
    form.append('file', file, filename)
    const res = await fetch(`${this.baseUrl}/chats/${chatId}/attachments`, {
      method: 'POST',
      headers: { Authorization: this.authHeaders()['Authorization'] || '' },
      body: form,
    })
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized()
      throw await toApiError(res)
    }
    return res.json()
  }

  async deleteChatAttachment(chatId: string, attachmentId: string): Promise<{ success: boolean }> {
    return this.request(`/chats/${chatId}/attachments/${attachmentId}`, { method: 'DELETE' })
  }

  // 下载附件字节（前端转 object URL 打开）
  async downloadChatAttachment(chatId: string, attachmentId: string): Promise<Blob> {
    const res = await fetch(
      `${this.baseUrl}/chats/${chatId}/attachments/${attachmentId}/download`,
      { headers: this.authHeaders() },
    )
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized()
      throw await toApiError(res)
    }
    return res.blob()
  }
}
