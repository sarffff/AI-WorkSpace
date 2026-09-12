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
  department?: string | null
  role?: string // employee | agent | admin
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
  /** 会话累计 LLM token 用量（服务端聚合，仅新会话接口返回） */
  tokens?: { promptTokens: number; completionTokens: number }
}

// ===== 消息管理 =====
export interface MessageSource {
  documentId: string
  documentName: string
  /** 结构切块记录的章节路径（如 "VPN 排查 > 连接失败"） */
  sectionPath?: string | null
  content: string
  score: number
}

/** Agent 工具调用轨迹（检索/建单过程可视化） */
export interface ToolTraceStep {
  tool: 'search_knowledge' | 'create_ticket' | string
  status: 'start' | 'done'
  summary?: string
}

/** Agent 自动创建的工单引用 */
export interface TicketRef {
  id: string
  title: string
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  model?: string
  sources?: MessageSource[]
  toolTrace?: ToolTraceStep[]
  ticketRef?: TicketRef | null
}

// ===== 知识库管理 =====

/** 异步索引进度（上传后后台流水线状态，前端轮询） */
export interface IndexProgress {
  stage: 'queued' | 'extracting' | 'chunking' | 'embedding' | 'storing' | 'done' | 'failed'
  percent: number
  chunks?: number
  error?: string
}

export interface KnowledgeDocument {
  id: string
  name: string
  size: number
  chunks: number
  status: string
  /** 非空 = 已共享至该部门 */
  department?: string | null
  ownerId?: string
  /** 处理中的文档附带的流水线进度 */
  progress?: IndexProgress
}

// ===== 工单管理 =====
export interface TicketUserBrief {
  id: string
  name: string | null
  email: string
  /** 坐席/管理员评论展示身份徽标用 */
  role?: string
}

/** 可分派的坐席/管理员（转派下拉数据源） */
export interface TicketStaff {
  id: string
  name: string | null
  email: string
  role: 'agent' | 'admin'
}

/** 工单时间线条目：用户评论 + 系统事件（状态流转/受理/转派自动记录） */
export interface TicketCommentItem {
  id: string
  kind: 'comment' | 'system'
  content: string
  author: TicketUserBrief
  createdAt: string
}

/** HITL 建单确认草稿（Agent 决定建单后推给用户确认） */
export interface TicketDraft {
  requestId: string
  title: string
  content: string
  priority: 'low' | 'normal' | 'high' | 'urgent' | string
}

/** 工单详情（含完整时间线） */
export interface TicketDetail extends TicketItem {
  comments: TicketCommentItem[]
}

export interface TicketItem {
  id: string
  title: string
  content: string
  status: 'open' | 'processing' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  creator: TicketUserBrief
  assignee: TicketUserBrief | null
  /** manual 手动创建 | agent AI 对话升级 */
  source?: 'manual' | 'agent'
  createdAt: string
  updatedAt: string
  /** 列表接口附带：最新一条时间线预览（comment/system） */
  comments?: { kind: 'comment' | 'system'; content: string; createdAt: string }[]
}

/** 坐席看板：按优先级的工单分布与 SLA 达标 */
export interface TicketPriorityStats {
  priority: 'low' | 'normal' | 'high' | 'urgent'
  total: number
  escalated: number
  resolved: number
  slaMet: number
}

/** 坐席看板统计（仅坐席/管理员） */
export interface TicketStats {
  periodDays: number
  /** 期间内活跃会话数（偏转率分母） */
  sessions: number
  tickets: {
    total: number
    /** AI 对话升级创建 */
    escalated: number
    manual: number
    open: number
    processing: number
    resolved: number
    closed: number
  }
  /** 当前未完结存量（待处理+处理中） */
  backlog: number
  /** 偏转率 0-1（AI 未升级占比，无会话时为 null） */
  deflectRate: number | null
  sla: {
    met: number
    total: number
    /** 0-1，无已解决工单时为 null */
    rate: number | null
    avgResolutionHours: number | null
    avgFirstResponseHours: number | null
    thresholdHours: Record<string, number>
  }
  byPriority: TicketPriorityStats[]
}

// ===== 提示词管理 =====
export interface PromptItem {
  id: string
  title: string
  content: string
  category: string
  createdAt: string
  updatedAt: string
}

// ===== 完成请求管理 =====
export interface CompletionRequest {
  prompt: string
  model?: string
  useRag?: boolean
  /** 注入的 system 角色提示词（来自提示词广场「一键注入」） */
  systemPrompt?: string
}

// ===== 完成响应管理 =====
export interface CompletionResponse {
  success: boolean
  data: string
}

// ===== Agent 运行运营看板 =====

/** AgentRun.steps 轨迹明细步骤（decision/tool/generate，含分轮 token 记账） */
export type AgentRunStep =
  | {
      kind: 'decision'
      round: number
      model: string
      promptTokens: number
      completionTokens: number
      ms: number
    }
  | {
      kind: 'tool'
      tool: string
      status: 'start' | 'done'
      summary?: string
      ms?: number
      round: number
    }
  | {
      kind: 'generate'
      model: string
      promptTokens: number
      completionTokens: number
      ms: number
      stream: true
    }

/** 工具调用分布条目 */
export interface ToolDistributionItem {
  tool: string
  count: number
}

/** 模型使用分布条目 */
export interface ModelDistributionItem {
  model: string
  runs: number
}

/** 每日运行/token 统计 */
export interface DailyTokenStat {
  date: string // YYYY-MM-DD
  runs: number
  promptTokens: number
  completionTokens: number
}

/** 运营看板概览（仅坐席/管理员） */
export interface AgentRunOverview {
  periodDays: number
  totalRuns: number
  totalToolCalls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  /** 保留 1 位小数；无运行时为 null */
  avgRounds: number | null
  avgTotalMs: number | null
  /** RAG 命中（sources>0）占比 0-1；无运行时为 null */
  searchHitRate: number | null
  /** 建单（ticketId 非空）占比 0-1 */
  ticketConversionRate: number | null
  toolDistribution: ToolDistributionItem[]
  modelDistribution: ModelDistributionItem[]
  daily: DailyTokenStat[]
}

/** 运行明细列表项（轻量，不含 steps） */
export interface AgentRunItem {
  id: string
  chatId: string
  userId: string
  model: string | null
  status: 'completed' | 'partial'
  rounds: number
  toolCalls: number
  sources: number
  ticketId: string | null
  ticketTitle: string | null
  promptTokens: number
  completionTokens: number
  totalMs: number
  createdAt: string
}

/** 运行详情（含完整步骤时间线） */
export interface AgentRunDetail extends AgentRunItem {
  replyChars: number
  steps: AgentRunStep[]
}

// ===== 导航标签管理 =====
export type NavTab = 'chat' | 'knowledge' | 'prompts' | 'tickets' | 'analytics' | 'settings'
