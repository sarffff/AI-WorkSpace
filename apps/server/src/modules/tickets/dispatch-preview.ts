// ===== 自动派单的预演：只给建议，一个字段都不写 =====
//
// 「这单该给谁」现在是坐席的临场判断，没人说得清依据是什么。在替他们做决定之前，
// 先拿历史工单量一遍：按「该分类下过去完成最多的坐席」来派，能不能猜中实际受理人。
// 猜不中就说明路由规则不在分类维度里，自动派单不该上。
//
// 几个刻意的选择，每条都有对应测试：
// - 不给未来信息：给某张单出建议时，历史只取「在那一刻之前已经完结」的工单，且排除它
//   本身。不这么剪的话，命中率是抄答案抄出来的
// - 没信号就不硬凑：该分类下无人完结过时判为 no_signal，不进"敢自动派"的集合，
//   单独报覆盖度 —— 冷启动和真信号得分开看
// - other 不参与：这个分类的定义就是"判断不了"，按它派是把噪声当依据，单独标出来
// - 必须有基线对照：和「纯按负载派」比，赢不了就说明分类信号没有附加价值
// - 必须报上限：分类路由的天花板 = 每个分类里"被派得最多的那个受理人"的占比。
//   贴着天花板说明团队本来就不按分类分工，换维度才有意义，调算法没有

/** 参与派单的坐席（agent/admin，与工单转派下拉同一口径） */
export interface DispatchAgent {
  id: string
  name: string
  department: string | null
}

/**
 * 派单算法消费的工单行：只带决策要用的字段。
 * status/时间线都不在这里，完结时刻由调用方折算成 resolvedAt。
 */
export interface DispatchTicketRow {
  id: string
  title: string
  category: string
  priority: string
  /** 最终受理人：回测的真值 */
  assigneeId: string | null
  creatorDepartment: string | null
  createdAt: Date
  /** 完结时刻；未完结为 null */
  resolvedAt: Date | null
}

export type DispatchBasis =
  /** 该分类下有坐席完结过，建议据此给出 */
  | 'category_affinity'
  /** 该分类下无人完结过：没有依据，交回人工 */
  | 'no_signal'
  /** 分类是 other（"判断不了"），按它派等于拿噪声当依据 */
  | 'unroutable_category'

/** 候选受理人及其排序依据；短名单原样返回，便于坐席核对为什么是他 */
export interface DispatchCandidate {
  agentId: string
  /** 该坐席在此分类下的历史完结数（唯一的正向证据） */
  affinity: number
  /** 那一刻的在办单数：越少越优先（证据并列时的次级依据） */
  inFlight: number
  /** 与工单创建人同部门 */
  sameDepartment: boolean
}

export interface DispatchSuggestion {
  ticketId: string
  title: string
  category: string
  priority: string
  /** 建议受理人；无可派坐席时为 null */
  assigneeId: string | null
  basis: DispatchBasis
  /** 第一名的证据数（该分类完结数） */
  evidence: number
  /** 第一名在该分类全部历史完结中的份额 0~1；无信号为 0 */
  confidence: number
  /** 与第二名的证据差：0 意味着"选谁其实都一样" */
  margin: number
  /** 排序后的候选短名单（最多 topK 条，已剔除到饱和线的人） */
  candidates: DispatchCandidate[]
  /** 有分类信号，但候选全被在办上限挡住了：缺的是人手不是依据 */
  blockedByLoad: boolean
  /** 证据是否强到可以放手给自动派单 */
  autoDispatchable: boolean
}

export interface BacktestDecision {
  ticketId: string
  category: string
  actualAssigneeId: string
  suggestedAssigneeId: string | null
  basis: DispatchBasis
  evidence: number
  confidence: number
  /** 敢自动派的单里，建议正好是真值 */
  autoDispatchable: boolean
  hit: boolean
  /** 真值出现在短名单前 K 内 */
  inTopK: boolean
  /** 这单被转过派：首次派单是错的 */
  reassigned: boolean
  /** 真值受理人当时在该分类没有完结记录 —— 这次派单不吃分类信号 */
  actualHadNoAffinity: boolean
  /** 基线（谁最闲给谁）会派给谁 */
  baselineAssigneeId: string | null
  baselineHit: boolean
}

export interface CategoryBacktest {
  category: string
  evaluated: number
  decided: number
  hits: number
  accuracy: number | null
  /** 该分类的分类路由天花板：被派得最多的受理人占比 */
  ceiling: number | null
}

export interface DispatchBacktest {
  /** 有真值（已派过人）的单数 */
  evaluated: number
  /** 证据够硬、真会交给机器派的单数 */
  decided: number
  /** 有信号但证据不足门槛的单数 */
  thinEvidence: number
  noSignal: number
  unroutable: number
  hits: number
  /** hits / decided：机器出手时的准确率 */
  accuracy: number | null
  /** decided / evaluated：多大的比例敢让机器派 */
  coverage: number | null
  /** hits / evaluated：真开自动派单，多少单能一次派对（不敢派的那部分算没中） */
  hitRate: number | null
  topK: number
  topKHits: number
  /** 同一 decided 子集上的基线命中：分类信号必须赢它才有价值 */
  baselineHits: number
  baselineAccuracy: number | null
  /** 被转过派的单数（首次派单失误的真实规模） */
  reassigned: number
  /** 其中"我们建议的就是最终受理人"—— 这次转派本可以省掉 */
  wouldSaveReassignment: number
  /** decided 的 miss 里，真值受理人当时在该分类无完结记录的数量 */
  missesExplainedByNoAffinity: number
  /** 全体 evaluated 的分类路由天花板，命中率贴着它就该换维度而不是换算法 */
  ceilingAccuracy: number | null
  byCategory: CategoryBacktest[]
  decisions: BacktestDecision[]
}

export interface DispatchOptions {
  /** 短名单长度，默认 3 */
  topK?: number
  /** 自动派单的证据门槛：该分类至少完结过几单才敢放手，默认 2 */
  minEvidence?: number
  /** 在办单上限，超过就不派给该坐席。默认不设 —— 饱和阈值是运营决定，不是代码决定 */
  maxLoad?: number | null
}

const DEFAULT_TOP_K = 3
const DEFAULT_MIN_EVIDENCE = 2

/** 判断不了 = 没有路由依据 */
const UNROUTABLE = new Set(['other'])

/** 紧急的先派，同优先级按挂得久的先派 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const priorityRank = (p: string) => PRIORITY_RANK[p] ?? PRIORITY_RANK.normal

const round4 = (n: number) => Math.round(n * 1e4) / 1e4
const ratio = (n: number, d: number) => (d === 0 ? null : round4(n / d))

function normalize(opts: DispatchOptions) {
  return {
    topK: Math.max(1, Math.round(opts.topK ?? DEFAULT_TOP_K)),
    minEvidence: Math.max(1, Math.round(opts.minEvidence ?? DEFAULT_MIN_EVIDENCE)),
    // 0 是合法阈值（等于"永不因饱和排除人"），所以判 null/undefined 而不是判真假
    maxLoad:
      opts.maxLoad === undefined || opts.maxLoad === null
        ? null
        : Math.max(0, Math.round(opts.maxLoad)),
  }
}

/**
 * 某坐席在 at 一刻的在办单数。
 * 按最终受理人 + createdAt 归责，会把"建单后才被受理"的空档也算成忙碌，是个偏高的近似。
 * 负载只在证据并列时当次级依据用，偏保守不动主判据。
 */
function inFlightAt(tickets: DispatchTicketRow[], agentId: string, at: Date, excludeId: string) {
  let n = 0
  for (const t of tickets) {
    if (t.id === excludeId || t.assigneeId !== agentId) continue
    if (t.createdAt > at) continue
    if (t.resolvedAt === null || t.resolvedAt > at) n++
  }
  return n
}

/** 该坐席在 at 之前（不含本次）于该分类的完结数 —— 唯一的正向信号 */
function affinityAt(
  tickets: DispatchTicketRow[],
  agentId: string,
  category: string,
  at: Date,
  excludeId: string,
) {
  let n = 0
  for (const t of tickets) {
    if (t.id === excludeId || t.assigneeId !== agentId || t.category !== category) continue
    if (t.resolvedAt !== null && t.resolvedAt <= at) n++
  }
  return n
}

/** 证据多 > 同部门 > 手上活少；全平则按 id —— 同一批数据必须每次给同一个答案 */
function rankCandidates(cands: DispatchCandidate[]): DispatchCandidate[] {
  return [...cands].sort(
    (a, b) =>
      b.affinity - a.affinity ||
      Number(b.sameDepartment) - Number(a.sameDepartment) ||
      a.inFlight - b.inFlight ||
      a.agentId.localeCompare(b.agentId),
  )
}

/** 纯按负载派（谁最闲给谁），同部门其次，用作分类信号的对照组 */
function leastLoaded(pool: DispatchCandidate[]): string | null {
  if (pool.length === 0) return null
  const sorted = [...pool].sort(
    (a, b) =>
      a.inFlight - b.inFlight ||
      Number(b.sameDepartment) - Number(a.sameDepartment) ||
      a.agentId.localeCompare(b.agentId),
  )
  return sorted[0].agentId
}

function buildPool(
  ticket: Pick<DispatchTicketRow, 'id' | 'category' | 'creatorDepartment'>,
  agents: DispatchAgent[],
  tickets: DispatchTicketRow[],
  at: Date,
): DispatchCandidate[] {
  return agents.map((a) => ({
    agentId: a.id,
    affinity: affinityAt(tickets, a.id, ticket.category, at, ticket.id),
    inFlight: inFlightAt(tickets, a.id, at, ticket.id),
    sameDepartment: !!a.department && a.department === ticket.creatorDepartment,
  }))
}

interface Decision {
  suggestion: DispatchSuggestion
  /** 未经 maxLoad 过滤、也未截断的全量候选：回测算基线要用它，别跟着 topK 一起被砍 */
  pool: DispatchCandidate[]
}

function decide(
  ticket: DispatchTicketRow,
  agents: DispatchAgent[],
  tickets: DispatchTicketRow[],
  at: Date,
  opts: DispatchOptions = {},
): Decision {
  const { topK, minEvidence, maxLoad } = normalize(opts)
  const pool = buildPool(ticket, agents, tickets, at)
  const ranked = rankCandidates(pool)
  const best = ranked[0]
  const second = ranked[1]
  const totalAffinity = pool.reduce((sum, c) => sum + c.affinity, 0)

  const basis: DispatchBasis = UNROUTABLE.has(ticket.category)
    ? 'unroutable_category'
    : !best || best.affinity === 0
      ? 'no_signal'
      : 'category_affinity'
  const confident = basis === 'category_affinity'
  // 饱和线只管"现在能不能派给他"，不参与 basis —— basis 回答的是"有没有依据"，
  // 把"没人手"混进去会让回测看不懂到底缺信号还是缺人。
  // 只在有证据的人里挑： ranked 已按证据降序，第一个没到线的就是最佳可用人选；
  // 全都到了线就退回 null，"这单现在没人接得住"本身就是结论，不该拉个没做过的人顶上
  const available = ranked.find(
    (c) => c.affinity > 0 && (maxLoad === null || c.inFlight <= maxLoad),
  )

  return {
    suggestion: {
      ticketId: ticket.id,
      title: ticket.title,
      category: ticket.category,
      priority: ticket.priority,
      assigneeId: confident && available ? available.agentId : null,
      basis,
      evidence: confident && best ? best.affinity : 0,
      // 份额的分母是该分类全部历史完结数：无人完结过时它是 0，所以无信号时不报份额
      confidence:
        confident && best && totalAffinity > 0 ? round4(best.affinity / totalAffinity) : 0,
      margin: best ? best.affinity - (second?.affinity ?? 0) : 0,
      candidates: ranked.filter((c) => maxLoad === null || c.inFlight <= maxLoad).slice(0, topK),
      // 有信号但所有人都到了饱和线：这是缺人，不是缺依据，单独报出来才有讨论价值
      blockedByLoad: confident && !available,
      autoDispatchable: confident && !!available && (best?.affinity ?? 0) >= minEvidence,
    },
    pool,
  }
}

/**
 * 给一张单出派单建议（不落库）。
 * 历史与负载都以 `at` 为剪点：传"当下"是预演，传这张单自己的创建时刻是回测。
 */
export function suggestAssignee(
  ticket: DispatchTicketRow,
  agents: DispatchAgent[],
  tickets: DispatchTicketRow[],
  at: Date,
  opts: DispatchOptions = {},
): DispatchSuggestion {
  return decide(ticket, agents, tickets, at, opts).suggestion
}

/** 待派单的单：还没有受理人，且没有完结 */
function isPending(t: DispatchTicketRow) {
  return t.assigneeId === null && t.resolvedAt === null
}

export interface PreviewResult {
  /** 按「紧急优先、同优先级按 id 稳定收尾」排序并截断后的建议清单 */
  pending: DispatchSuggestion[]
  /** 截断前的待派单总数：limit 生效时靠它知道还有多少没看到 */
  pendingTotal: number
  /** 清单里够得上自动派单门槛的条数 */
  autoDispatchable: number
  /** 没有可派坐席：预演跑不出任何信号，问题在花名册不在算法 */
  noRoster: boolean
}

/** 对当下的未派单队列做预演 */
export function previewDispatch(
  tickets: DispatchTicketRow[],
  agents: DispatchAgent[],
  now: Date,
  opts: DispatchOptions & { limit?: number } = {},
): PreviewResult {
  const rows = tickets
    .filter(isPending)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
  // 先按「挂得久优先」排好再逐条出建议：sort 稳定，紧急度相同时就落在创建时间上，
  // 第二级排序刻意不再加 id 兜底 —— 加了会把创建时间这个更该先派的信息盖掉
  const all = rows
    .map((t) => suggestAssignee(t, agents, tickets, now, opts))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
  const limit = opts.limit === undefined ? all.length : Math.max(1, Math.round(opts.limit))

  return {
    pending: all.slice(0, limit),
    pendingTotal: all.length,
    autoDispatchable: all.filter((s) => s.autoDispatchable).length,
    noRoster: agents.length === 0,
  }
}

/**
 * 历史回测：假装每张派过人的单从没派过，只用「它创建之前」的历史重派一次，和真值比。
 *
 * 真值取最终受理人。中间转过派的单，首次派单其实是错的 —— 所以另报 reassigned 与
 * wouldSaveReassignment，否则会把"猜中了纠正后的结果"当成"第一次就猜对"。
 */
export function backtestDispatch(
  tickets: DispatchTicketRow[],
  agents: DispatchAgent[],
  opts: DispatchOptions & { reassignTicketIds?: Iterable<string>; decisionsLimit?: number } = {},
): DispatchBacktest {
  const { topK, minEvidence } = normalize(opts)
  const reassigned = new Set(opts.reassignTicketIds ?? [])
  const truth = tickets
    .filter((t) => t.assigneeId !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const decisions: BacktestDecision[] = []
  for (const t of truth) {
    // 刻意不传 maxLoad：回测要量的是"分类信号准不准"，饱和线会把答案糊成"没人可派"
    const { suggestion: sug, pool } = decide(t, agents, tickets, t.createdAt, { topK, minEvidence })
    const actual = t.assigneeId as string
    const baseline = leastLoaded(pool)
    decisions.push({
      ticketId: t.id,
      category: t.category,
      actualAssigneeId: actual,
      suggestedAssigneeId: sug.assigneeId,
      basis: sug.basis,
      evidence: sug.evidence,
      confidence: sug.confidence,
      autoDispatchable: sug.autoDispatchable,
      hit: sug.assigneeId !== null && sug.assigneeId === actual,
      inTopK: sug.candidates.some((c) => c.agentId === actual),
      reassigned: reassigned.has(t.id),
      actualHadNoAffinity: affinityAt(tickets, actual, t.category, t.createdAt, t.id) === 0,
      baselineAssigneeId: baseline,
      baselineHit: baseline === actual,
    })
  }

  return summarizeBacktest(decisions, { topK, limit: opts.decisionsLimit })
}

function summarizeBacktest(
  decisions: BacktestDecision[],
  opts: { topK: number; limit?: number },
): DispatchBacktest {
  const evaluated = decisions.length
  const decided = decisions.filter((d) => d.autoDispatchable)
  const hits = decided.filter((d) => d.hit)
  const reassignedRows = decided.filter((d) => d.reassigned)

  // 天花板按真值算，与算法无关：每个分类里"最常接到单的那个人"能吃下多少
  const byActual = new Map<string, Map<string, number>>()
  for (const d of decisions) {
    const inner = byActual.get(d.category) ?? new Map<string, number>()
    inner.set(d.actualAssigneeId, (inner.get(d.actualAssigneeId) ?? 0) + 1)
    byActual.set(d.category, inner)
  }
  const categories = [...new Set(decisions.map((d) => d.category))].sort()
  const byCategory: CategoryBacktest[] = categories.map((category) => {
    const rows = decisions.filter((d) => d.category === category)
    const act = rows.filter((d) => d.autoDispatchable)
    const counts = [...(byActual.get(category)?.values() ?? [])]
    const majority = counts.length ? Math.max(...counts) : 0
    return {
      category,
      evaluated: rows.length,
      decided: act.length,
      hits: act.filter((d) => d.hit).length,
      accuracy: ratio(act.filter((d) => d.hit).length, act.length),
      ceiling: ratio(majority, rows.length),
    }
  })
  const ceilingTotal = [...byActual.values()].reduce(
    (sum, inner) => sum + Math.max(0, ...[...inner.values()]),
    0,
  )

  return {
    evaluated,
    decided: decided.length,
    thinEvidence: decisions.filter((d) => d.basis === 'category_affinity' && !d.autoDispatchable)
      .length,
    noSignal: decisions.filter((d) => d.basis === 'no_signal').length,
    unroutable: decisions.filter((d) => d.basis === 'unroutable_category').length,
    hits: hits.length,
    accuracy: ratio(hits.length, decided.length),
    coverage: ratio(decided.length, evaluated),
    hitRate: ratio(hits.length, evaluated),
    topK: opts.topK,
    // 短名单里有没有真值：坐席照着三个候选挑也能挑中，比单选命中更能说明"信号有用"
    topKHits: decided.filter((d) => d.inTopK).length,
    baselineHits: decided.filter((d) => d.baselineHit).length,
    baselineAccuracy: ratio(decided.filter((d) => d.baselineHit).length, decided.length),
    reassigned: decisions.filter((d) => d.reassigned).length,
    wouldSaveReassignment: reassignedRows.filter((d) => d.hit).length,
    missesExplainedByNoAffinity: decided.filter((d) => !d.hit && d.actualHadNoAffinity).length,
    ceilingAccuracy: ratio(ceilingTotal, evaluated),
    byCategory,
    // 决策明细按"最该人工核对的在前"排：派错的 > 证据太薄交回人工的 > 什么都没学到的 > 派对的
    decisions: [...decisions]
      .sort(
        (a, b) =>
          attentionRank(b) - attentionRank(a) ||
          b.confidence - a.confidence ||
          a.ticketId.localeCompare(b.ticketId),
      )
      .slice(0, opts.limit === undefined ? decisions.length : Math.max(1, Math.round(opts.limit))),
  }
}

/** 截断只影响给看多少条明细，不影响上面任何一个小计 */
function attentionRank(d: BacktestDecision): number {
  if (d.autoDispatchable) return d.hit ? 0 : 3
  return d.basis === 'category_affinity' ? 2 : 1
}
