// ===== 偏转率：AI 接住多少一线 =====
//
// 看板此前只有 escalated（AI 建了多少单）——那是分子的一半，没有分母，
// 「偏转率」其实算不出来。而这个产品要证明的恰恰是这一件事：AI 答完之后
// 用户不需要再找人。
//
// 口径里几个刻意选择，都有对应测试：
// - 分母只数「期内有过 AI 回答的会话」。只提问没回答的（断连、生成失败、停机）
//   单列成 unansweredSessions 上报，绝不混进分母 —— 把故障算成"没接住"或算成
//   "接住了"都是骗自己
// - 单位是**会话**不是消息也不是轮次：一个会话反复建单只算一次升级，
//   否则多轮长会话会主导指标
// - 分母为 0 时 rate 返回 null 而不是 0。0% 会被读成"一个都没挡住"，
//   而事实是"没有可算的数据"（与 overview 的无数据口径一致）
// - AI 工单里没回填上会话归属的（老数据）不进分子，但要报数并给出 coverage：
//   偏转率的水分管不住，至少要说出来

export interface SessionFact {
  chatId: string
  /** 期内该会话的 AI 回答条数；>0 才算「AI 接过这个会话」 */
  answers: number
  /** 该会话产生的 AI 工单条数（Ticket.source='agent' 且 chatId 命中） */
  agentTickets: number
  /** 期内该会话收到的 👎 数 */
  downs: number
  /** 期内该会话的用户提问条数（有提问无回答 → 未接住，单列） */
  questions: number
}

export interface DeflectionInput {
  sessions: SessionFact[]
  /** 期内 source='agent' 但无会话归属的工单数（回填前的历史数据） */
  unattributedAgentTickets: number
}

export interface DeflectionSummary {
  /** 分母：有过 AI 回答的会话数 */
  answeredSessions: number
  /** 其中产生了 AI 工单的会话数 */
  escalatedSessions: number
  deflectedSessions: number
  /** 0~1；分母为 0 时 null（无数据，不是 0%） */
  deflectionRate: number | null
  /** 未升级但收到过 👎：AI 自称解决、用户不认，偏转率里的水分 */
  lowConfidenceDeflections: number
  /** 低置信占"偏转成功"的比例；无偏转会话时 null */
  lowConfidenceShare: number | null
  /** 有提问但整期没有一条 AI 回答的会话（故障/断连），不进任何比率 */
  unansweredSessions: number
  unattributedAgentTickets: number
  /** AI 工单里能追回会话归属的比例；无 AI 工单时 null */
  attributionCoverage: number | null
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4
const ratio = (n: number, d: number) => (d === 0 ? null : round4(n / d))

export function computeDeflection(input: DeflectionInput): DeflectionSummary {
  const sessions = input.sessions
  // 会话按 chatId 去重：聚合行可能因 role/时间分桶出现同一会话多条
  const byChat = new Map<string, SessionFact>()
  for (const s of sessions) {
    const prev = byChat.get(s.chatId)
    if (!prev) {
      byChat.set(s.chatId, { ...s })
      continue
    }
    prev.answers += s.answers
    prev.agentTickets += s.agentTickets
    prev.downs += s.downs
    prev.questions += s.questions
  }
  const all = [...byChat.values()]

  const answered = all.filter((s) => s.answers > 0)
  const escalated = answered.filter((s) => s.agentTickets > 0)
  const deflected = answered.length - escalated.length
  const lowConfidence = answered.filter((s) => s.agentTickets === 0 && s.downs > 0).length
  const unanswered = all.filter((s) => s.answers === 0 && s.questions > 0).length

  const attributed = all.reduce((sum, s) => sum + s.agentTickets, 0)
  const agentTotal = attributed + input.unattributedAgentTickets

  return {
    answeredSessions: answered.length,
    escalatedSessions: escalated.length,
    deflectedSessions: deflected,
    deflectionRate: ratio(deflected, answered.length),
    lowConfidenceDeflections: lowConfidence,
    lowConfidenceShare: ratio(lowConfidence, deflected),
    unansweredSessions: unanswered,
    unattributedAgentTickets: input.unattributedAgentTickets,
    attributionCoverage: agentTotal === 0 ? null : ratio(attributed, agentTotal),
  }
}

/** 升级工单的分类分布 → 知识缺口优先级（哪个类别最接不住） */
export function rankKnowledgeGaps(
  rows: { category: string; escalated: number }[],
): { category: string; escalated: number }[] {
  return [...rows]
    .filter((r) => r.escalated > 0)
    .sort((a, b) => b.escalated - a.escalated || a.category.localeCompare(b.category))
}
