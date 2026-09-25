import { FEEDBACK_REASON_LABEL } from '@/modules/tickets/ticket-taxonomy'

// ===== 👎 反馈 → 评测候选用例的映射（纯函数，便于单测） =====
//
// 关键取舍：候选用例的 expect* 字段填「模型**实际**做了什么」，而不是猜测的正确行为。
// 因为负例恰恰意味着实际行为可能是错的 —— 自动写入「期望」等于把错误固化成基线。
// 因此产物是**候选**，note 里标注实际行为与用户不满原因，交由人工复核改成期望值后
// 再并入 eval-agent-dataset.json。

/** AgentRun.steps 中的工具步骤（只取 done 且带 tool 名的） */
interface ToolStep {
  kind?: unknown
  tool?: unknown
  status?: unknown
}

export interface FeedbackRow {
  /** 用户提问（该 assistant 消息的前一条 user 消息） */
  query: string
  feedbackReason: string | null
  /** 关联的 AgentRun（可能为空：AGENT_TRACE=off 或存量数据无 messageId） */
  run: {
    steps: unknown
    sources: number
    ticketId: string | null
  } | null
  /** 该次回答的引用溯源文档名（来自 Message.sources） */
  documentNames: string[]
}

export interface EvalCandidate {
  query: string
  expectSearch: boolean
  expectTicket: boolean
  expectTicketLookup: boolean
  expectedDocs: string[]
  note: string
}

const LOOKUP_TOOLS = new Set(['lookup_my_tickets', 'get_ticket'])

// 从 AgentRun.steps 提取实际调用过的工具名（去重，保持首次出现顺序）
export function extractToolNames(steps: unknown): string[] {
  if (!Array.isArray(steps)) return []
  const seen = new Set<string>()
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    const s = step as ToolStep
    if (s.kind === 'tool' && typeof s.tool === 'string') seen.add(s.tool)
  }
  return [...seen]
}

export function toCandidate(row: FeedbackRow): EvalCandidate {
  const tools = extractToolNames(row.run?.steps)
  const searched = tools.includes('search_knowledge')
  const ticketed = tools.includes('create_ticket') || Boolean(row.run?.ticketId)
  const looked = tools.some((t) => LOOKUP_TOOLS.has(t))

  const reasonLabel = row.feedbackReason
    ? (FEEDBACK_REASON_LABEL[row.feedbackReason] ?? row.feedbackReason)
    : '未选原因'
  const actual = tools.length > 0 ? tools.join(',') : '未调用工具'
  const traceNote = row.run ? '' : '；无轨迹（AGENT_TRACE 关闭或存量数据）'

  return {
    query: row.query,
    // 填实际行为，非期望行为 —— 人工复核时逐条改正
    expectSearch: searched,
    expectTicket: ticketed,
    expectTicketLookup: looked,
    expectedDocs: row.documentNames,
    note: `【待复核】用户不满：${reasonLabel}；实际行为：${actual}${traceNote}`,
  }
}

// 同一问题可能被多个用户反复点👎：按 query 去重（保留信息最全的一条 —— 有原因 > 无原因）
export function dedupeCandidates(candidates: EvalCandidate[]): EvalCandidate[] {
  const byQuery = new Map<string, EvalCandidate>()
  for (const c of candidates) {
    const key = c.query.trim()
    const existing = byQuery.get(key)
    if (!existing) {
      byQuery.set(key, c)
      continue
    }
    // 已有条目没带原因、新条目带了原因 → 替换
    const existingHasReason = !existing.note.includes('未选原因')
    const incomingHasReason = !c.note.includes('未选原因')
    if (!existingHasReason && incomingHasReason) byQuery.set(key, c)
  }
  return [...byQuery.values()]
}
