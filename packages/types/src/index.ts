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

/** 答案满意度反馈取值（仅 assistant 消息；null 为未评价） */
export type MessageFeedback = 'up' | 'down'

/** 👎 原因标签（可选，用户可跳过） */
export type MessageFeedbackReason = 'wrong' | 'unsolved' | 'bad_citation' | 'irrelevant'

export const FEEDBACK_REASON_OPTIONS: { value: MessageFeedbackReason; label: string }[] = [
  { value: 'wrong', label: '答案错误' },
  { value: 'unsolved', label: '没解决我的问题' },
  { value: 'bad_citation', label: '引用来源不准' },
  { value: 'irrelevant', label: '答非所问' },
]

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
  feedback?: MessageFeedback | null
  feedbackReason?: MessageFeedbackReason | null
  /**
   * SSE 中断后走非流式回退得到的回答：仍做 RAG，但不跑工具循环，
   * 因此不会自动升级工单。展示时需明确标注，避免用户以为拿到了有升级保障的回答。
   * 仅本轮会话内标记（服务端未持久化该状态），重载后引用来源仍在、标注消失。
   */
  degraded?: boolean
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
  category?: TicketCategory
  requestId: string
  title: string
  content: string
  priority: 'low' | 'normal' | 'high' | 'urgent' | string
}

/** 工单详情（含完整时间线） */
export interface TicketDetail extends TicketItem {
  comments: TicketCommentItem[]
}

/** 工单分类（6 类扁平）：分类分布统计与后续自动派单的路由依据 */
export type TicketCategory = 'account' | 'hardware' | 'network' | 'software' | 'process' | 'other'

export const TICKET_CATEGORY_OPTIONS: { value: TicketCategory; label: string }[] = [
  { value: 'account', label: '账号权限' },
  { value: 'hardware', label: '硬件设备' },
  { value: 'network', label: '网络访问' },
  { value: 'software', label: '软件应用' },
  { value: 'process', label: '制度流程' },
  { value: 'other', label: '其他' },
]

export interface TicketItem {
  id: string
  title: string
  content: string
  status: 'open' | 'processing' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  category: TicketCategory
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

/** 坐席看板：按分类的工单分布（仅返回有工单的分类）。
 *  高频且 escalated 占比高的分类 = 知识库覆盖不足，知识沉淀的优先方向 */
export interface TicketCategoryStats {
  category: TicketCategory
  total: number
  escalated: number
  resolved: number
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
  byCategory: TicketCategoryStats[]
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
  /** 非流式回退路径的引用溯源（服务端已落库，回传给前端即时展示） */
  sources?: MessageSource[]
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
  feedback: FeedbackOverview
}

/** 👎 原因分布项（unspecified = 用户点了👎但未选原因） */
export interface FeedbackReasonItem {
  reason: MessageFeedbackReason | 'unspecified' | string
  count: number
}

/** 满意度概览：分母只含已评价消息（未评价占绝大多数，计入会把率稀释成噪声） */
export interface FeedbackOverview {
  up: number
  down: number
  /** 已评价消息数（up + down） */
  rated: number
  /** 满意度率 = up / rated，0-1；无人评价时为 null */
  satisfactionRate: number | null
  reasonDistribution: FeedbackReasonItem[]
}

/** 知识缺口：AI 升级掉的工单按分类排，排第一即「最该补文档」的方向 */
export interface KnowledgeGapItem {
  category: TicketCategory | string
  escalated: number
}

/**
 * 偏转率：期内「AI 接住的会话」里有多少没落成人工工单。
 * 单位是会话（不是消息也不是轮次）；所有 *Rate 为 0-1，无数据时为 null（不是 0）。
 */
export interface DeflectionOverview {
  days: number
  since: string
  /** 分母：有过 AI 回答的会话数 */
  answeredSessions: number
  escalatedSessions: number
  deflectedSessions: number
  /** 偏转率；无接住会话时 null */
  deflectionRate: number | null
  /** 未升级但收到过 👎：AI 自称解决、用户不认 —— 偏转率里的水分 */
  lowConfidenceDeflections: number
  lowConfidenceShare: number | null
  /** 有提问但整期没有一条 AI 回答（断连/失败），不进任何比率 */
  unansweredSessions: number
  /** 追不回会话归属的 AI 工单数（加列前的历史数据），不进分子 */
  unattributedAgentTickets: number
  /** AI 工单里能追回会话归属的比例 —— 偏转率的可信度自证；无 AI 工单时 null */
  attributionCoverage: number | null
  knowledgeGaps: KnowledgeGapItem[]
}

/** 缺口类型：库里根本没有 / 有文档但没答上 / 追不到那次运行的命中数 */
export type KnowledgeGapReason = 'no_hit' | 'hit_but_escalated' | 'unknown_hits'

/** 一条待补文档候选：问题 + 人工处理结论 + 可直接粘贴的 Markdown 草稿 */
export interface KnowledgeGapCandidate {
  ticketId: string
  chatId: string
  category: TicketCategory | string
  reason: KnowledgeGapReason
  question: string
  /** false = 用户原话没留存，question 只是 AI 建单时的转述 */
  questionIsUserWords: boolean
  solution: string
  hasSolution: boolean
  markdown: string
}

export interface KnowledgeGapSummary {
  total: number
  /** 有处理结论、能直接成文的条数 */
  withSolution: number
  byReason: Record<KnowledgeGapReason, number>
  /** 同一句用户原话重复出现：补一篇省多次升级 */
  recurring: { question: string; times: number; ticketIds: string[] }[]
}

export interface KnowledgeGapsResult {
  days: number
  scanned: number
  /** 已解决但追不回会话归属的 AI 工单数 —— 清单可能比这个数不全 */
  unlinkedResolvedTickets: number
  summary: KnowledgeGapSummary
  candidates: KnowledgeGapCandidate[]
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
