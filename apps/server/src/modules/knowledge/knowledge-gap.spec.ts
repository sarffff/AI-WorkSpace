import { extractGapCandidates, summarizeGaps, type GapTicket } from './knowledge-gap'

// 行为依据（与实现一致）：
// - 只收「AI 升级 + 人工已解决 + 有会话归属」的工单，缺一不进候选
// - 缺口分 no_hit（库里根本没有）与 hit_but_escalated（有文档但没答上），前者排前
// - 追不到 AgentRun 标 unknown_hits，不能把这条候选丢掉
// - 问题优先取用户原话（最长那条），没有才回退 AI 写的标题

const t = (over: Partial<GapTicket> & { id: string }): GapTicket => ({
  title: 'VPN 连不上，证书重装无效',
  content: '员工反馈 VPN 连不上，怀疑账号被锁定。',
  category: 'network',
  chatId: 'chat-1',
  status: 'resolved',
  createdAt: new Date(2026, 8, 20),
  humanComments: ['已解锁账号，并重置证书有效期', '补充：内网网段变更需重新导入 profile'],
  userQuestions: ['在吗', '我的 VPN 连不上，证书也重新装过了还是不行'],
  ragHits: 0,
  ...over,
})

describe('extractGapCandidates', () => {
  it('未解决的工单不收（没有答案可沉淀）', () => {
    expect(
      extractGapCandidates([t({ id: 'a', status: 'open' }), t({ id: 'b', status: 'processing' })]),
    ).toEqual([])
    expect(extractGapCandidates([t({ id: 'c', status: 'closed' })])).toHaveLength(1)
  })

  it('没有会话归属的不进候选：追不到用户原话，标题只是 AI 的转述', () => {
    expect(extractGapCandidates([t({ id: 'd', chatId: null })])).toEqual([])
  })

  it('检索零命中判为 no_hit，有命中仍升级判为质量问题', () => {
    const [noHit] = extractGapCandidates([t({ id: 'a', ragHits: 0 })])
    const [hitButEscalated] = extractGapCandidates([t({ id: 'b', ragHits: 3 })])
    expect(noHit.reason).toBe('no_hit')
    expect(hitButEscalated.reason).toBe('hit_but_escalated')
  })

  it('追不到运行时标 unknown_hits 并排在高命中质量问题前面', () => {
    const rows = extractGapCandidates([
      t({ id: 'a', ragHits: 5 }),
      t({ id: 'b', ragHits: null }),
      t({ id: 'c', ragHits: 0 }),
    ])
    expect(rows.map((r) => r.reason)).toEqual(['no_hit', 'unknown_hits', 'hit_but_escalated'])
  })

  it('问题取用户原话里最长的那条，不是第一条也不是标题', () => {
    const [c] = extractGapCandidates([t({ id: 'a' })])
    expect(c.question).toBe('我的 VPN 连不上，证书也重新装过了还是不行')
    expect(c.questionIsUserWords).toBe(true)
  })

  it('原话全是寒暄时回退到工单标题，并标记可信度更低', () => {
    const [c] = extractGapCandidates([t({ id: 'a', userQuestions: ['在吗', '你好', 'hi'] })])
    expect(c.question).toBe('VPN 连不上，证书重装无效')
    expect(c.questionIsUserWords).toBe(false)
  })

  it('短但完整的问题不被长度门槛筛掉（门槛只滤寒暄，不评判质量）', () => {
    const [c] = extractGapCandidates([t({ id: 'a', userQuestions: ['在吗', '打印机没纸了'] })])
    expect(c.question).toBe('打印机没纸了')
    expect(c.questionIsUserWords).toBe(true)
  })

  it('人工评论去空去重后拼成处理结论', () => {
    const [c] = extractGapCandidates([
      t({
        id: 'a',
        humanComments: ['', '已解锁账号', '已解锁账号', '   ', '并重置了证书有效期'],
      }),
    ])
    expect(c.solution).toBe('已解锁账号\n并重置了证书有效期')
    expect(c.hasSolution).toBe(true)
  })

  it('坐席没留处理说明时保留候选并明说需要回访补充', () => {
    const [c] = extractGapCandidates([t({ id: 'a', humanComments: [] })])
    expect(c.hasSolution).toBe(false)
    expect(c.markdown).toContain('坐席未在时间线留下处理说明')
  })

  it('草稿是可粘贴的完整 markdown：标题/分类/来源/结论/原始上下文', () => {
    const [c] = extractGapCandidates([t({ id: 'a' })])
    expect(c.markdown).toContain('# 我的 VPN 连不上，证书也重新装过了还是不行')
    expect(c.markdown).toContain('分类：network')
    expect(c.markdown).toContain('来源：工单 a（2026-09-20）')
    expect(c.markdown).toContain('## 处理结论')
    expect(c.markdown).toContain('已解锁账号，并重置证书有效期')
    expect(c.markdown).toContain('## 原始问题上下文')
    expect(c.markdown).toContain('员工反馈 VPN 连不上，怀疑账号被锁定。')
    // 转述与留痕要区分开，写文档的人才知道哪句可信
    expect(c.markdown).toContain('下面这段是用户原话')
  })

  it('草稿日期用本地日历日，不被 UTC 切成前一天', () => {
    // 本地 23:30（UTC+8）在 UTC 上已是次日 15:30 之前的另一天；toISOString().slice(0,10)
    // 会给出 09-20 之外的日期，写文档的人对日期的直觉是本地日
    const lateEvening = new Date(2026, 8, 20, 23, 30)
    const [c] = extractGapCandidates([t({ id: 'a', createdAt: lateEvening })])
    expect(c.markdown).toContain('来源：工单 a（2026-09-20）')
  })
})

describe('summarizeGaps', () => {
  it('按缺口类型分布计数，并单独统计"有成文素材"的条数', () => {
    const s = summarizeGaps(
      extractGapCandidates([
        t({ id: 'a', ragHits: 0 }),
        t({ id: 'b', ragHits: 2 }),
        t({ id: 'c', ragHits: 0, humanComments: [] }),
      ]),
    )
    expect(s.total).toBe(3)
    expect(s.byReason).toEqual({ no_hit: 2, hit_but_escalated: 1, unknown_hits: 0 })
    expect(s.withSolution).toBe(2)
  })

  it('同一句用户原话重复出现 → 列为高频缺口（补一篇省多次升级）', () => {
    const same = '打印机脱机了怎么恢复'
    const s = summarizeGaps(
      extractGapCandidates([
        t({ id: 'a', userQuestions: [same], chatId: 'c1' }),
        t({ id: 'b', userQuestions: [same], chatId: 'c2' }),
        t({ id: 'c', userQuestions: ['别的完全不同的问题描述'], chatId: 'c3' }),
      ]),
    )
    expect(s.recurring).toEqual([{ question: same, times: 2, ticketIds: ['a', 'b'] }])
  })

  it('只有 AI 转述的问题不参与高频判定（转述措辞不稳定，会假报重复）', () => {
    const s = summarizeGaps(
      extractGapCandidates([
        t({ id: 'a', userQuestions: ['在吗'] }),
        t({ id: 'b', userQuestions: ['在吗'] }),
      ]),
    )
    expect(s.recurring).toEqual([])
  })
})
