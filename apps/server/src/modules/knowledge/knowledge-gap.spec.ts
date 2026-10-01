import {
  extractGapCandidates,
  planGapSync,
  summarizeGapBoard,
  summarizeGaps,
  type GapRecord,
  type GapTicket,
} from './knowledge-gap'

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

const now = new Date('2026-10-01T00:00:00.000Z')
const day = 86_400_000

const rec = (over: Partial<GapRecord> & { ticketId: string }): GapRecord => ({
  chatId: 'c1',
  category: 'network',
  question: 'VPN 连不上，证书重装无效',
  reason: 'no_hit',
  hasSolution: true,
  status: 'open',
  closedAt: null,
  closedDocId: null,
  firstSeenAt: new Date(now.getTime() - 3 * day),
  ...over,
})

describe('planGapSync', () => {
  const candidatesOf = (...ids: string[]) => extractGapCandidates(ids.map((id) => t({ id })))

  it('只为没见过的工单建行，已有行原样不动', () => {
    const plan = planGapSync(candidatesOf('a', 'b'), [{ ticketId: 'a' }])
    expect(plan.map((p) => p.ticketId)).toEqual(['b'])
    expect(plan[0]).toMatchObject({
      category: 'network',
      reason: 'no_hit',
      hasSolution: true,
      question: '我的 VPN 连不上，证书也重新装过了还是不行',
    })
  })

  it('已有行代表处置结果：即便这次又算出同一条，也不产生任何写入', () => {
    // covered/dismissed 与 open 在同步层面等价 —— 判据只是"见过就没有重算的资格"
    expect(planGapSync(candidatesOf('a'), [{ ticketId: 'a' }])).toEqual([])
  })

  it('问题文案按列宽截断，避免超长原话让整批写入失败', () => {
    const long = '网'.repeat(600)
    const [row] = planGapSync(
      extractGapCandidates([t({ id: 'a', userQuestions: [long], chatId: 'c9' })]),
      [],
    )
    expect(row.question).toHaveLength(500)
  })
})

describe('summarizeGapBoard', () => {
  it('按处置状态计数，并报最早未补缺口挂了多久', () => {
    const board = summarizeGapBoard(
      [
        rec({ ticketId: 'o1', firstSeenAt: new Date(now.getTime() - 40 * day) }),
        rec({ ticketId: 'o2' }),
        rec({ ticketId: 'c1', status: 'covered', closedAt: new Date(now.getTime() - day) }),
        rec({ ticketId: 'd1', status: 'dismissed' }),
      ],
      now,
    )
    expect(board).toMatchObject({ total: 4, open: 2, covered: 1, dismissed: 1, oldestOpenDays: 40 })
  })

  it('没有未补缺口时挂了多久无从谈起（null，不是 0 天）', () => {
    expect(
      summarizeGapBoard([rec({ ticketId: 'c9', status: 'covered' })], now).oldestOpenDays,
    ).toBeNull()
  })

  it('说成文却没留出处的条数单独报：这种处置回溯不了', () => {
    const board = summarizeGapBoard(
      [
        rec({ ticketId: 'c1', status: 'covered', closedAt: new Date(), closedDocId: 'doc-1' }),
        rec({ ticketId: 'c2', status: 'covered', closedAt: new Date(), closedDocId: null }),
      ],
      now,
    )
    expect(board.covered).toBe(2)
    expect(board.coveredWithoutDoc).toBe(1)
  })

  it('成文之后同一句求助又被人工解决 → 判为复发，那篇文档没解决它', () => {
    const board = summarizeGapBoard(
      [
        rec({
          ticketId: 'closed',
          status: 'covered',
          closedAt: new Date(now.getTime() - 10 * day),
          closedDocId: 'doc-1',
        }),
        rec({ ticketId: 'again', firstSeenAt: new Date(now.getTime() - 2 * day) }),
      ],
      now,
    )
    expect(board.reopened).toHaveLength(1)
    expect(board.reopened[0]).toMatchObject({
      closedTicketId: 'closed',
      recurredTicketId: 'again',
      closedDocId: 'doc-1',
      category: 'network',
    })
  })

  it('复发判定要保守：关闭前就存在的同句求助、不同分类、措辞不同都不算', () => {
    const closed = rec({
      ticketId: 'closed',
      status: 'covered',
      closedAt: new Date(now.getTime() - 10 * day),
    })
    const cases: GapRecord[][] = [
      // 同一批求助里的另一张单，比成文更早
      [closed, rec({ ticketId: 'older', firstSeenAt: new Date(now.getTime() - 20 * day) })],
      // 同一句话但归到别的分类
      [closed, rec({ ticketId: 'other', category: 'account', firstSeenAt: new Date() })],
      // 同分类但问的是另一件事
      [closed, rec({ ticketId: 'diff', question: '邮箱附件超限', firstSeenAt: new Date() })],
    ]
    for (const rows of cases) {
      expect(summarizeGapBoard(rows, now).reopened).toEqual([])
    }
  })

  it('问句比对忽略大小写与空白，但不做模糊匹配', () => {
    const rows = [
      rec({
        ticketId: 'closed',
        question: 'VPN  连不上',
        status: 'covered',
        closedAt: new Date(now.getTime() - 10 * day),
      }),
      rec({ ticketId: 'again', question: 'vpn 连不上 ', firstSeenAt: new Date() }),
    ]
    expect(summarizeGapBoard(rows, now).reopened).toHaveLength(1)
  })
})
