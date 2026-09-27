import { computeDeflection, rankKnowledgeGaps, type SessionFact } from './deflection'

// 行为依据（与实现一致）：
// - 分母只数有过 AI 回答的会话；只有提问没有回答的单列，不进任何比率
// - 单位是会话：一个会话建了两张单也只算一次升级
// - 无数据时 rate 是 null，不是 0（0% 会被读成"一个都没挡住"）
// - 没归属会话的 AI 工单不进分子，但报数并给出 coverage

const s = (over: Partial<SessionFact> & { chatId: string }): SessionFact => ({
  answers: 1,
  agentTickets: 0,
  downs: 0,
  questions: 1,
  ...over,
})

describe('computeDeflection', () => {
  it('4 个接住的会话里 1 个升级 → 偏转率 0.75', () => {
    const r = computeDeflection({
      sessions: [
        s({ chatId: 'c1' }),
        s({ chatId: 'c2' }),
        s({ chatId: 'c3' }),
        s({ chatId: 'c4', agentTickets: 1 }),
      ],
      unattributedAgentTickets: 0,
    })
    expect(r).toMatchObject({
      answeredSessions: 4,
      escalatedSessions: 1,
      deflectedSessions: 3,
      deflectionRate: 0.75,
      unansweredSessions: 0,
    })
  })

  it('同一会话多张工单只算一次升级（单位是会话不是工单）', () => {
    const r = computeDeflection({
      sessions: [s({ chatId: 'c1', agentTickets: 3 }), s({ chatId: 'c2' })],
      unattributedAgentTickets: 0,
    })
    expect(r.escalatedSessions).toBe(1)
    expect(r.deflectionRate).toBe(0.5)
    // 但归属覆盖按工单条数算：3 张都追得回会话
    expect(r.attributionCoverage).toBe(1)
  })

  it('只有提问没有回答的会话：单列上报，不进分母也不进分子', () => {
    // 断连/生成失败/停机留下的会话。算进分母会压低偏转率（把故障算成没接住），
    // 算成"没升级"又会把偏转率抬高 —— 两头都不能混
    const r = computeDeflection({
      sessions: [s({ chatId: 'c1' }), s({ chatId: 'c2', answers: 0, questions: 2 })],
      unattributedAgentTickets: 0,
    })
    expect(r.answeredSessions).toBe(1)
    expect(r.unansweredSessions).toBe(1)
    expect(r.deflectionRate).toBe(1)
  })

  it('没有任何会话：rate 是 null 而不是 0%', () => {
    const r = computeDeflection({ sessions: [], unattributedAgentTickets: 0 })
    expect(r.deflectionRate).toBeNull()
    expect(r.answeredSessions).toBe(0)
    expect(r.attributionCoverage).toBeNull()
    expect(r.lowConfidenceShare).toBeNull()
  })

  it('未升级但有 👎 算低置信偏转，并给出占偏转成功的比例', () => {
    const r = computeDeflection({
      sessions: [
        s({ chatId: 'c1' }),
        s({ chatId: 'c2', downs: 1 }),
        s({ chatId: 'c3', downs: 2 }),
        s({ chatId: 'c4', agentTickets: 1, downs: 1 }), // 升级了，不算低置信
      ],
      unattributedAgentTickets: 0,
    })
    expect(r.escalatedSessions).toBe(1)
    expect(r.deflectedSessions).toBe(3)
    expect(r.lowConfidenceDeflections).toBe(2)
    expect(r.lowConfidenceShare).toBeCloseTo(2 / 3, 4)
  })

  it('无归属的 AI 工单不进分子，但计入 coverage 的分母', () => {
    const r = computeDeflection({
      sessions: [s({ chatId: 'c1' }), s({ chatId: 'c2', agentTickets: 1 })],
      unattributedAgentTickets: 1, // 回填前的老数据
    })
    expect(r.escalatedSessions).toBe(1)
    expect(r.unattributedAgentTickets).toBe(1)
    expect(r.attributionCoverage).toBe(0.5)
  })

  it('同一 chatId 的多条聚合行会先合并再判定', () => {
    // 按 (chatId, role) groupBy 出来的行：同一会话会出现多次
    const r = computeDeflection({
      sessions: [
        s({ chatId: 'c1', answers: 2, questions: 0 }),
        s({ chatId: 'c1', answers: 0, questions: 2 }),
        s({ chatId: 'c1', answers: 0, questions: 0, agentTickets: 1, downs: 1 }),
      ],
      unattributedAgentTickets: 0,
    })
    expect(r.answeredSessions).toBe(1)
    expect(r.escalatedSessions).toBe(1)
    expect(r.unansweredSessions).toBe(0)
    expect(r.attributionCoverage).toBe(1)
  })
})

describe('rankKnowledgeGaps', () => {
  it('按升级数降序，并滤掉零升级的分类', () => {
    expect(
      rankKnowledgeGaps([
        { category: 'network', escalated: 2 },
        { category: 'other', escalated: 0 },
        { category: 'account', escalated: 7 },
      ]),
    ).toEqual([
      { category: 'account', escalated: 7 },
      { category: 'network', escalated: 2 },
    ])
  })

  it('数量相同按分类名稳定排序（同一输入两次输出一致）', () => {
    const rows = [
      { category: 'software', escalated: 1 },
      { category: 'hardware', escalated: 1 },
    ]
    expect(rankKnowledgeGaps(rows)).toEqual(rankKnowledgeGaps([...rows].reverse()))
  })
})
