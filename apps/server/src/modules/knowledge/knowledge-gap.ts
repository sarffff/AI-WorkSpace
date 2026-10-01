// ===== 知识回流：AI 接不住、人工解决了的问题 = 文档缺口 =====
//
// 偏转率的上限不在模型，在知识库覆盖了多少真实求助。所以比"AI 升级了多少单"更有用的
// 是：这些单最后被人怎么解决的，能不能沉淀成下次 AI 能查到的文档。
//
// 收进来的一条候选必须同时满足（缺一不可）：
// 1. 由 AI 对话升级（source='agent'）—— 说明 AI 判定自己处理不了
// 2. 工单已被人工解决（resolved/closed）—— 没解决就没有"答案"可沉淀，
//    收了只会制造一堆没有结论的待办
// 3. 有会话归属（chatId 非空）—— 追不到用户原话时，问题只能退化成 AI 写的标题，
//    而标题是转述，转述会丢掉真正卡住的那句话
//
// 缺口分两类，可操作性完全不同：
// - no_hit：升级那次检索一个片段都没命中 → 库里根本没有，补文档
// - hit_but_escalated：命中了却还是升级 → 文档在但没解决，是质量问题（或缺关键章节）
// 追不到 AgentRun（观测关掉、或历史数据）时标 unknown_hits 而**不是丢掉这条候选** ——
// 观测开关不该让缺口清单静默变短。

/** 分类标签，用于草稿正文里给写文档的人一个落点 */
const CATEGORY_LABEL_FALLBACK = '未分类'

export interface GapTicket {
  id: string
  title: string
  /** 工单描述（AI 建单时写的问题说明） */
  content: string
  category: string
  chatId: string | null
  status: string
  createdAt: Date
  /** 时间线里的人工评论，按时间正序（系统事件已剔除） */
  humanComments: string[]
  /** 用户在会话里说过的原话，按时间正序 */
  userQuestions: string[]
  /** 升级那次运行的 RAG 命中片段数；null = 追不到运行 */
  ragHits: number | null
}

export type GapReason = 'no_hit' | 'hit_but_escalated' | 'unknown_hits'

export interface GapCandidate {
  ticketId: string
  chatId: string
  category: string
  reason: GapReason
  /** 最贴近问题本质的那句：优先用户原话，回退 AI 写的标题 */
  question: string
  /** 问题是否来自用户原话（false = 只有 AI 的转述，可信度更低） */
  questionIsUserWords: boolean
  /** 人工处理结论（评论拼合）；空串表示没有留下可沉淀的答案 */
  solution: string
  hasSolution: boolean
  /** 可直接粘进知识库的 Markdown 草稿 */
  markdown: string
}

const RESOLVED = new Set(['resolved', 'closed'])

/** 排序权重：没有命中的最该先补（补一篇就少一类升级），质量问题其次 */
const REASON_RANK: Record<GapReason, number> = {
  no_hit: 0,
  unknown_hits: 1,
  hit_but_escalated: 2,
}

function classifyReason(t: GapTicket): GapReason {
  if (t.ragHits === null) return 'unknown_hits'
  return t.ragHits === 0 ? 'no_hit' : 'hit_but_escalated'
}

/**
 * 用户原话里挑最能当标题的一条。
 * 取最长而不是第一条：第一条常是"在吗/帮我看看"，真正卡住的在后面那句。
 * 长度门槛只为滤掉寒暄（"在吗" 两个字），不评判问题写得好不好 ——
 * "打印机没纸了" 六个字也是完整的求助，卡太严会把真问题筛没。
 */
function pickQuestion(t: GapTicket): { question: string; fromUser: boolean } {
  const candidates = t.userQuestions.map((q) => q.trim()).filter((q) => q.length >= 5)
  if (candidates.length === 0) return { question: t.title.trim(), fromUser: false }
  const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a))
  return { question: longest, fromUser: true }
}

/** 人工评论拼成处理结论：去空、去重（坐席常原样重复一句），保序 */
function pickSolution(t: GapTicket): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const raw of t.humanComments) {
    const s = raw.replace(/\s+/g, ' ').trim()
    if (s.length < 4 || seen.has(s)) continue
    seen.add(s)
    parts.push(s)
  }
  return parts.join('\n')
}

/**
 * 本地日期 YYYY-MM-DD。
 * 不能用 toISOString().slice(0,10)：那是 UTC 切日，东八区的工单会集体往前错一天，
 * 而写文档的人对日期的直觉是本地日期。
 */
function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function toMarkdown(c: Omit<GapCandidate, 'markdown'>, t: GapTicket): string {
  const lines = [
    `# ${c.question}`,
    '',
    `分类：${c.category || CATEGORY_LABEL_FALLBACK}`,
    `来源：工单 ${t.id.slice(0, 8)}（${localDate(t.createdAt)}）`,
    '',
    '## 处理结论',
    '',
    c.hasSolution ? c.solution : '_（坐席未在时间线留下处理说明，需回访补充）_',
    '',
    '## 原始问题上下文',
    '',
    c.questionIsUserWords ? '（下面这段是用户原话）' : '（用户原话未留存，下面是 AI 建单时的转述）',
    t.content.trim(),
  ]
  return lines.join('\n')
}

/**
 * 工单行 → 缺口候选。调用方负责按 source='agent' 与时间窗过滤，
 * 这里再收"能不能沉淀成知识"的三个硬条件。
 */
export function extractGapCandidates(tickets: GapTicket[]): GapCandidate[] {
  const out: GapCandidate[] = []
  for (const t of tickets) {
    if (!RESOLVED.has(t.status)) continue
    // 没有会话归属就追不到用户原话；这类只配当"知道缺但补不了"的统计，不进候选清单
    if (!t.chatId) continue
    const { question, fromUser } = pickQuestion(t)
    const solution = pickSolution(t)
    const base: Omit<GapCandidate, 'markdown'> = {
      ticketId: t.id,
      chatId: t.chatId,
      category: t.category,
      reason: classifyReason(t),
      question,
      questionIsUserWords: fromUser,
      solution,
      hasSolution: solution.length > 0,
    }
    out.push({ ...base, markdown: toMarkdown(base, t) })
  }
  return out.sort(
    (a, b) =>
      REASON_RANK[a.reason] - REASON_RANK[b.reason] ||
      Number(b.hasSolution) - Number(a.hasSolution) ||
      a.ticketId.localeCompare(b.ticketId),
  )
}

export interface GapSummary {
  total: number
  /** 有处理结论、可直接成文的条数 */
  withSolution: number
  byReason: Record<GapReason, number>
  /** 同一问题重复出现（不同工单、同一段用户原话）—— 补一篇能省多次升级 */
  recurring: { question: string; times: number; ticketIds: string[] }[]
}

export function summarizeGaps(candidates: GapCandidate[]): GapSummary {
  const byReason: Record<GapReason, number> = {
    no_hit: 0,
    hit_but_escalated: 0,
    unknown_hits: 0,
  }
  const grouped = new Map<string, string[]>()
  for (const c of candidates) {
    byReason[c.reason] += 1
    if (!c.questionIsUserWords) continue // 只有 AI 转述的不参与"重复求助"判定
    const key = c.question.trim().toLowerCase()
    grouped.set(key, [...(grouped.get(key) ?? []), c.ticketId])
  }
  const recurring = [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([question, ids]) => ({ question, times: ids.length, ticketIds: ids }))
    .sort((a, b) => b.times - a.times || a.question.localeCompare(b.question))

  return {
    total: candidates.length,
    withSolution: candidates.filter((c) => c.hasSolution).length,
    byReason,
    recurring,
  }
}

// ===== 缺口台账：清单可以重算，处置必须留下 =====
//
// 上面那份候选清单是纯推导 —— 每次请求都能从工单里再算出来。它有一个没法回避的缺陷：
// 补完文档之后缺口不会消失，因为触发它的那张工单还在。于是"待补清单"越攒越长，
// 没人知道哪些其实已经成文、哪些被判断过"不值得成文"。
//
// 落库的不是清单，是**人对清单的动作**，所以同步规则只有一条：
// 见过的 ticketId 一律不碰（已有行永远不覆盖、不删除）—— 坐席的处置不能被一次重算冲掉。

export type GapStatus = 'open' | 'covered' | 'dismissed'

/** 台账行（与 KnowledgeGap 表同构；question 已按列宽截断） */
export interface GapRecord {
  ticketId: string
  chatId: string | null
  category: string
  question: string
  reason: GapReason
  hasSolution: boolean
  status: GapStatus
  closedAt: Date | null
  closedDocId: string | null
  firstSeenAt: Date
}

export type NewGapRow = Pick<
  GapRecord,
  'ticketId' | 'chatId' | 'category' | 'question' | 'reason' | 'hasSolution'
>

/** 列宽：与 schema 的 question VarChar(500) 对齐，超长截断而不是让整批写入失败 */
const QUESTION_MAX_CHARS = 500

/**
 * 同步计划：给没见过的 ticketId 建行，已有的一律不动。
 * 也不因为"这次重算没算出它"就删行 —— 工单被删或状态回退都不该让处置记录消失。
 */
export function planGapSync(
  candidates: GapCandidate[],
  existing: Array<{ ticketId: string }>,
): NewGapRow[] {
  const known = new Set(existing.map((r) => r.ticketId))
  const out: NewGapRow[] = []
  for (const c of candidates) {
    if (known.has(c.ticketId)) continue
    known.add(c.ticketId) // 同一批里也不会出现两次同 ticketId，这里是防御
    out.push({
      ticketId: c.ticketId,
      chatId: c.chatId,
      category: c.category,
      question: c.question.trim().slice(0, QUESTION_MAX_CHARS),
      reason: c.reason,
      hasSolution: c.hasSolution,
    })
  }
  return out
}

/**
 * 归一化求助文案：只认**完全相同**的一句话。
 * 不做相似度/关键词匹配 —— 猜出来的"复发了"会让人对着一个不相干的单子去改文档。
 */
const sameAsk = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

export interface GapReopen {
  /** 当初判为已成文的那条 */
  closedTicketId: string
  closedDocId: string | null
  closedAt: Date
  /** 之后又出现并再次被人工解决的同一句求助 */
  recurredTicketId: string
  recurredAt: Date
  question: string
  category: string
}

export interface GapBoard {
  total: number
  open: number
  covered: number
  dismissed: number
  /** 最早一条未补缺口挂了多少天（向下取整）；没有未补项时 null */
  oldestOpenDays: number | null
  /** 有成文日期、却缺 closedDocId 的条数：处置没留出处，回溯不了"补的是什么" */
  coveredWithoutDoc: number
  /** 成文之后同一句求助又出现 —— 那篇文档没解决它 */
  reopened: GapReopen[]
}

export function summarizeGapBoard(rows: GapRecord[], now = new Date()): GapBoard {
  const open = rows.filter((r) => r.status === 'open')
  const covered = rows.filter((r) => r.status === 'covered')

  const dayMs = 86_400_000
  const oldest = open.reduce<Date | null>(
    (min, r) => (!min || r.firstSeenAt < min ? r.firstSeenAt : min),
    null,
  )

  // 复发判定只在"关闭之后新出现的同问句未补行"之间做：
  // 关闭之前就有同句求助的，是同一次故障的两张单，不是文档失效的证据
  const reopened: GapReopen[] = []
  for (const c of covered) {
    if (!c.closedAt) continue
    for (const r of open) {
      if (r.firstSeenAt <= c.closedAt) continue
      if (r.category !== c.category || !sameAsk(r.question, c.question)) continue
      reopened.push({
        closedTicketId: c.ticketId,
        closedDocId: c.closedDocId,
        closedAt: c.closedAt,
        recurredTicketId: r.ticketId,
        recurredAt: r.firstSeenAt,
        question: r.question,
        category: r.category,
      })
    }
  }
  reopened.sort((a, b) => b.recurredAt.getTime() - a.recurredAt.getTime())

  return {
    total: rows.length,
    open: open.length,
    covered: covered.length,
    dismissed: rows.length - open.length - covered.length,
    oldestOpenDays: oldest
      ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / dayMs))
      : null,
    coveredWithoutDoc: covered.filter((c) => !c.closedDocId).length,
    reopened,
  }
}
