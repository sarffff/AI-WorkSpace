import {
  backtestDispatch,
  previewDispatch,
  suggestAssignee,
  type DispatchAgent,
  type DispatchTicketRow,
} from './dispatch-preview'

// 行为依据（与实现一致）：
// - 唯一正向信号 = 「该坐席在该分类、在剪点之前已完结的工单数」；剪点之后完结的一律不算
// - 被建议的这张单自己永远不进历史（否则回测是抄答案）
// - category=other 判 unroutable_category，即使有人完结过 other 也不派
// - 无信号/不可路由时 assigneeId 为 null，不是"随便挑一个"
// - 排序：证据 > 同部门 > 在办少 > id；maxLoad 只影响人选，不影响 basis 判定
// - autoDispatchable = 有信号且证据 >= minEvidence 且有人没到饱和线
// - accuracy 的分母是 decided，hitRate 的分母是 evaluated
// - 每条派过人的历史单（assigneeId 非空）本身也是一次待回测的决策，既进 evaluated 也进命中判定；
//   窗口最早那几条必然落在 no_signal/thin_evidence，那是冷启动的真实形状，不是 bug

const T = (n: number) => new Date(2026, 8, n) // 本地 9 月 n 日

const agent = (id: string, department: string | null = null): DispatchAgent => ({
  id,
  name: `${id} 坐席`,
  department,
})

function ticket(over: Partial<DispatchTicketRow> & { id: string }): DispatchTicketRow {
  return {
    title: `工单 ${over.id}`,
    category: 'network',
    priority: 'normal',
    assigneeId: null,
    creatorDepartment: null,
    createdAt: T(1),
    resolvedAt: null,
    ...over,
  }
}

/** 已完结、有受理人的历史单（信号来源） */
const done = (
  id: string,
  assigneeId: string,
  resolvedAt: Date,
  category = 'network',
): DispatchTicketRow =>
  ticket({
    id,
    assigneeId,
    createdAt: new Date(resolvedAt.getTime() - 86_400_000),
    resolvedAt,
    category,
  })

const open = (id: string, over: Partial<DispatchTicketRow> = {}): DispatchTicketRow =>
  ticket({ id, ...over })

const agents = [agent('a1'), agent('a2')]

describe('suggestAssignee', () => {
  it('该分类无人完结过时判无信号，且不硬塞人选', () => {
    const sug = suggestAssignee(open('t1'), agents, [done('h1', 'a1', T(1), 'hardware')], T(10))
    expect(sug.basis).toBe('no_signal')
    expect(sug.assigneeId).toBeNull()
    expect(sug.evidence).toBe(0)
    expect(sug.confidence).toBe(0)
    expect(sug.autoDispatchable).toBe(false)
  })

  it('按该分类历史完结数给建议，份额与差距一并给出', () => {
    const rows = [done('h1', 'a1', T(1)), done('h2', 'a1', T(2)), done('h3', 'a2', T(3))]
    const sug = suggestAssignee(open('t1'), agents, rows, T(10))
    expect(sug.basis).toBe('category_affinity')
    expect(sug.assigneeId).toBe('a1')
    expect(sug.evidence).toBe(2)
    expect(sug.confidence).toBe(0.6667)
    expect(sug.margin).toBe(1)
    expect(sug.candidates.map((c) => c.agentId)).toEqual(['a1', 'a2'])
    expect(sug.autoDispatchable).toBe(true)
  })

  it('剪点之后才完结的单不能作为证据（回测不许抄未来）', () => {
    const rows = [done('h1', 'a1', T(20))]
    const sug = suggestAssignee(open('t1'), agents, rows, T(10))
    expect(sug.basis).toBe('no_signal')
  })

  it('被建议的单自己即使已完结也不进历史', () => {
    const self = ticket({ id: 't1', assigneeId: 'a1', createdAt: T(5), resolvedAt: T(5) })
    const sug = suggestAssignee(self, agents, [self], T(5))
    expect(sug.basis).toBe('no_signal')
    expect(sug.candidates.find((c) => c.agentId === 'a1')?.affinity).toBe(0)
  })

  it('other 分类判不可路由，哪怕有人做过 other', () => {
    const rows = [done('h1', 'a1', T(1), 'other'), done('h2', 'a1', T(2), 'other')]
    const sug = suggestAssignee(open('t1', { category: 'other' }), agents, rows, T(10))
    expect(sug.basis).toBe('unroutable_category')
    expect(sug.assigneeId).toBeNull()
    expect(sug.evidence).toBe(0)
  })

  it('证据并列时同部门优先，再看在办少的', () => {
    const rows = [done('h1', 'a1', T(1)), done('h2', 'a2', T(1))]
    // a2 手上还压着两单在办，a1 一单
    const backlog = [
      ticket({ id: 'b1', assigneeId: 'a1', createdAt: T(1) }),
      ticket({ id: 'b2', assigneeId: 'a2', createdAt: T(1) }),
      ticket({ id: 'b3', assigneeId: 'a2', createdAt: T(2) }),
    ]
    const same = suggestAssignee(
      open('t1', { creatorDepartment: 'IT' }),
      [agent('a1'), agent('a2', 'IT')],
      [...rows, ...backlog],
      T(10),
    )
    expect(same.assigneeId).toBe('a2') // 同部门压过负载

    const neutral = suggestAssignee(open('t1'), agents, [...rows, ...backlog], T(10))
    expect(neutral.assigneeId).toBe('a1') // 无部门信号时看谁手上活少
    expect(neutral.margin).toBe(0)
  })

  it('没有坐席时短名单为空且不崩', () => {
    const sug = suggestAssignee(open('t1'), [], [done('h1', 'a1', T(1))], T(10))
    expect(sug.assigneeId).toBeNull()
    expect(sug.candidates).toEqual([])
    expect(sug.margin).toBe(0)
  })

  it('minEvidence 门槛：只有一单经验时不给自动派单', () => {
    const sug = suggestAssignee(open('t1'), agents, [done('h1', 'a1', T(1))], T(10))
    expect(sug.basis).toBe('category_affinity')
    expect(sug.autoDispatchable).toBe(false)
    expect(
      suggestAssignee(open('t1'), agents, [done('h1', 'a1', T(1))], T(10), { minEvidence: 1 }),
    ).toMatchObject({ autoDispatchable: true })
  })

  it('maxLoad 挡住首选人时退给次选，全挡住则报缺人手而不是缺依据', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      done('h3', 'a2', T(3)),
      ticket({ id: 'b1', assigneeId: 'a1', createdAt: T(1) }),
      ticket({ id: 'b2', assigneeId: 'a1', createdAt: T(1) }),
      ticket({ id: 'b3', assigneeId: 'a2', createdAt: T(1) }),
    ]
    const capped = suggestAssignee(open('t1'), agents, rows, T(10), { maxLoad: 1 })
    expect(capped.basis).toBe('category_affinity')
    expect(capped.assigneeId).toBe('a2')
    expect(capped.candidates.map((c) => c.agentId)).toEqual(['a2'])

    const full = suggestAssignee(open('t1'), agents, rows, T(10), { maxLoad: 0 })
    expect(full.basis).toBe('category_affinity')
    expect(full.assigneeId).toBeNull()
    expect(full.blockedByLoad).toBe(true)
    expect(full.autoDispatchable).toBe(false)
  })
})

describe('previewDispatch', () => {
  it('只看待派单：有受理人的、已完结的都不进清单', () => {
    const rows = [
      open('t1'),
      ticket({ id: 't2', assigneeId: 'a1', createdAt: T(2) }),
      done('t3', 'a1', T(3)),
    ]
    const res = previewDispatch(rows, agents, T(10))
    expect(res.pending.map((p) => p.ticketId)).toEqual(['t1'])
    expect(res.pendingTotal).toBe(1)
  })

  it('紧急的先派，同级按创建时间先派，limit 截断但总数照报', () => {
    const rows = [
      open('slow-old', { createdAt: T(1) }),
      open('slow-new', { createdAt: T(5) }),
      open('urgent', { createdAt: T(4), priority: 'urgent' }),
      open('high', { createdAt: T(2), priority: 'high' }),
    ]
    const all = previewDispatch(rows, agents, T(10))
    expect(all.pending.map((p) => p.ticketId)).toEqual(['urgent', 'high', 'slow-old', 'slow-new'])

    const capped = previewDispatch(rows, agents, T(10), { limit: 2 })
    expect(capped.pending.map((p) => p.ticketId)).toEqual(['urgent', 'high'])
    expect(capped.pendingTotal).toBe(4)
  })

  it('没有可派坐席时明确报出来，别让人以为是算法没算出来', () => {
    const res = previewDispatch([open('t1')], [], T(10))
    expect(res.noRoster).toBe(true)
    expect(res.pending[0].assigneeId).toBeNull()
  })

  it('autoDispatchable 统计的是全量清单而不是截断后的那一屏', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      open('t1'),
      open('t2'),
      open('t3'),
    ]
    const res = previewDispatch(rows, agents, T(10), { limit: 1 })
    expect(res.pending).toHaveLength(1)
    expect(res.autoDispatchable).toBe(3)
  })
})

describe('backtestDispatch', () => {
  it('真值单自己不进历史：只有一张单时判无信号而不是命中', () => {
    const bt = backtestDispatch([done('t1', 'a1', T(5))], agents)
    expect(bt.evaluated).toBe(1)
    expect(bt.noSignal).toBe(1)
    expect(bt.decided).toBe(0)
    expect(bt.hits).toBe(0)
    // 敢派的一条都没有 → 准确率无从谈起（null）；一次派对率是实打实的 0
    expect(bt.accuracy).toBeNull()
    expect(bt.hitRate).toBe(0)
  })

  it('历史单自己也要回测：窗口早期的落在冷启动，不混进命中里', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      ticket({ id: 'x1', assigneeId: 'a1', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents)
    const byId = new Map(bt.decisions.map((d) => [d.ticketId, d]))
    expect(byId.get('h1')).toMatchObject({ basis: 'no_signal', autoDispatchable: false })
    expect(byId.get('h2')).toMatchObject({ evidence: 1, autoDispatchable: false }) // 一单经验还不敢派
    expect(byId.get('x1')).toMatchObject({ evidence: 2, autoDispatchable: true, hit: true })
    expect(bt.thinEvidence).toBe(1)
  })

  it('命中率分母是"敢自动派的"，一次派对率分母是全部', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      // 这张真值派给了 a2：分类信号会派给 a1 → miss
      ticket({ id: 'x1', assigneeId: 'a2', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents)
    expect(bt.evaluated).toBe(3)
    expect(bt.decided).toBe(1)
    expect(bt.coverage).toBe(0.3333) // 另两张当时还没历史可学
    expect(bt.hits).toBe(0)
    expect(bt.accuracy).toBe(0)
    expect(bt.hitRate).toBe(0)
  })

  it('猜中真值时同时计入命中与短名单', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      ticket({ id: 'x1', assigneeId: 'a1', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents)
    const [d] = bt.decisions.filter((x) => x.ticketId === 'x1')
    expect(d).toMatchObject({
      hit: true,
      inTopK: true,
      suggestedAssigneeId: 'a1',
      actualHadNoAffinity: false,
    })
    expect(bt.hits).toBe(1)
    expect(bt.topKHits).toBe(1)
    expect(bt.accuracy).toBe(1)
  })

  it('分类信号必须赢过"谁最闲给谁"的基线才有价值', () => {
    // 纯负载会选 a2（手上活少），分类经验指向 a1
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      ticket({ id: 'b1', assigneeId: 'a1', createdAt: T(3) }),
      ticket({ id: 'b2', assigneeId: 'a1', createdAt: T(3) }),
      ticket({ id: 'x1', assigneeId: 'a1', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents, { minEvidence: 1 })
    const [d] = bt.decisions.filter((x) => x.ticketId === 'x1')
    expect(d.baselineAssigneeId).toBe('a2')
    expect(d.baselineHit).toBe(false)
    expect(d.hit).toBe(true)
    // 同一个"敢派"子集上比：基线必须低于分类信号，否则要的是负载不是分类
    expect(bt.decided).toBe(4)
    expect(bt.hits).toBe(4)
    expect(bt.baselineHits).toBe(1)
  })

  it('转派过的单：猜中最终受理人算"本可省掉这次转派"', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      ticket({ id: 'x1', assigneeId: 'a1', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents, { reassignTicketIds: ['x1'] })
    expect(bt.reassigned).toBe(1)
    expect(bt.wouldSaveReassignment).toBe(1)
    expect(bt.decisions.find((d) => d.ticketId === 'x1')?.reassigned).toBe(true)
  })

  it('miss 里区分"真值受理人当时根本没有该分类经验"，这类不是算法的锅', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      // a2 从没做过 network：派给他是团队不按分类分工，不是预测失准
      ticket({ id: 'x1', assigneeId: 'a2', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents, { minEvidence: 1 })
    const [d] = bt.decisions.filter((x) => x.ticketId === 'x1')
    expect(d).toMatchObject({ suggestedAssigneeId: 'a1', actualAssigneeId: 'a2', hit: false })
    expect(d.actualHadNoAffinity).toBe(true)
    expect(bt.missesExplainedByNoAffinity).toBe(1)
  })

  it('天花板：真值五五开时任何分类规则都超不过 0.5', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a2', T(2)),
      ticket({ id: 'x1', assigneeId: 'a1', createdAt: T(6), resolvedAt: T(7) }),
      ticket({ id: 'x2', assigneeId: 'a2', createdAt: T(6), resolvedAt: T(7) }),
    ]
    const bt = backtestDispatch(rows, agents)
    // 天花板只由真值分布决定，与算法无关：network 4 单里最多的人接了 2 单
    expect(bt.byCategory).toEqual([
      expect.objectContaining({ category: 'network', evaluated: 4, ceiling: 0.5 }),
    ])
    expect(bt.ceilingAccuracy).toBe(0.5)
    // 默认门槛 2 下这些"经验"都只有一单，属于看着有信号其实不敢派
    expect(bt.decided).toBe(0)
    expect(bt.thinEvidence).toBe(3)
    expect(bt.noSignal).toBe(1)
  })

  it('决策明细按"最该人工核对的在前"排，截断不动小计', () => {
    const rows = [
      done('h1', 'a1', T(1)),
      done('h2', 'a1', T(2)),
      ticket({ id: 'hit', assigneeId: 'a1', createdAt: T(6), resolvedAt: T(7) }),
      ticket({ id: 'miss', assigneeId: 'a2', createdAt: T(7), resolvedAt: T(8) }),
      ticket({
        id: 'other',
        assigneeId: 'a1',
        category: 'other',
        createdAt: T(4),
        resolvedAt: T(5),
      }),
    ]
    const bt = backtestDispatch(rows, agents)
    const order = bt.decisions.map((d) => d.ticketId)
    expect(order[0]).toBe('miss') // 敢派还派错的第一个看
    expect(order[order.length - 1]).toBe('hit') // 派对的排最后
    expect(order.indexOf('h2')).toBeLessThan(order.indexOf('other')) // 有线索但不够硬的排在没线索前
    expect(order.indexOf('other')).toBeLessThan(order.indexOf('hit'))

    const capped = backtestDispatch(rows, agents, { decisionsLimit: 2 })
    expect(capped.decisions.map((d) => d.ticketId)).toEqual(['miss', 'h2'])
    expect(capped.evaluated).toBe(bt.evaluated)
    expect(capped.hits).toBe(bt.hits)
  })

  it('没有真值单时全部为 null 而不是 0', () => {
    const bt = backtestDispatch([open('t1')], agents)
    expect(bt.evaluated).toBe(0)
    expect(bt.accuracy).toBeNull()
    expect(bt.coverage).toBeNull()
    expect(bt.ceilingAccuracy).toBeNull()
    expect(bt.byCategory).toEqual([])
  })
})
