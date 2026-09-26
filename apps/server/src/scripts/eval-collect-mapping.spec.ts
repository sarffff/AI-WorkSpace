import {
  dedupeCandidates,
  extractToolNames,
  toCandidate,
  type EvalCandidate,
  type FeedbackRow,
} from './eval-collect-mapping'

// 行为依据（与实现一致）：
// - extractToolNames 只取 steps 中 kind==='tool' 的 tool 字段，去重保序
// - toCandidate 的 expect* 填「实际行为」而非期望行为（负例的实际行为可能就是错的），
//   note 打上【待复核】并写入不满原因与实际调用
// - ticketId 非空也算建单（HITL 确认后建单，轨迹里可能已有 create_ticket 步骤）
// - dedupeCandidates 按 query 去重，带原因的优先保留

const step = (tool: string, status = 'done') => ({ kind: 'tool', tool, status })

const row = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  query: '公司 VPN 连不上怎么办',
  feedbackReason: 'wrong',
  run: { steps: [step('search_knowledge')], sources: 3, ticketId: null, personaVersion: null },
  documentNames: ['VPN 排障手册'],
  ...over,
})

describe('extractToolNames', () => {
  it('提取工具名并去重保序', () => {
    const steps = [
      { kind: 'decision', round: 1 },
      step('search_knowledge', 'start'),
      step('search_knowledge'),
      step('create_ticket'),
      { kind: 'generate', model: 'x' },
    ]
    expect(extractToolNames(steps)).toEqual(['search_knowledge', 'create_ticket'])
  })

  it.each([
    ['null', null],
    ['非数组', { a: 1 }],
    ['空数组', []],
  ])('steps 为 %s 时返回空数组', (_label, steps) => {
    expect(extractToolNames(steps)).toEqual([])
  })

  it('忽略缺 tool 字段或非对象的异常元素', () => {
    expect(extractToolNames([{ kind: 'tool' }, null, 'x', step('get_ticket')])).toEqual([
      'get_ticket',
    ])
  })
})

describe('toCandidate', () => {
  it('expect* 反映实际行为，note 标注待复核与不满原因', () => {
    const c = toCandidate(row())
    expect(c).toEqual<EvalCandidate>({
      query: '公司 VPN 连不上怎么办',
      expectSearch: true,
      expectTicket: false,
      expectTicketLookup: false,
      expectedDocs: ['VPN 排障手册'],
      note: '【待复核】用户不满：答案错误；实际行为：search_knowledge',
    })
  })

  it('未调用工具时如实记录', () => {
    const c = toCandidate(
      row({ run: { steps: [], sources: 0, ticketId: null, personaVersion: null } }),
    )
    expect(c.expectSearch).toBe(false)
    expect(c.note).toContain('实际行为：未调用工具')
  })

  it('ticketId 非空即算建单（HITL 确认后建单）', () => {
    const c = toCandidate(
      row({ run: { steps: [], sources: 0, ticketId: 'TK-1', personaVersion: null } }),
    )
    expect(c.expectTicket).toBe(true)
  })

  it.each([
    ['lookup_my_tickets', 'lookup_my_tickets'],
    ['get_ticket', 'get_ticket'],
  ])('%s 计入 expectTicketLookup', (_label, tool) => {
    const c = toCandidate(
      row({ run: { steps: [step(tool)], sources: 0, ticketId: null, personaVersion: null } }),
    )
    expect(c.expectTicketLookup).toBe(true)
  })

  it('无轨迹时标注原因（AGENT_TRACE 关闭或存量数据）', () => {
    const c = toCandidate(row({ run: null }))
    expect(c.note).toContain('无轨迹')
    expect(c.expectSearch).toBe(false)
  })

  // 版本化的全部意义在这条断言上：负例若不带当时生效的提示词版本，
  // 发布新版后就无法判断这条负例是否已被修掉
  it('带版本号时写入 note，供发布新版后回看是否已修', () => {
    const c = toCandidate(
      row({
        run: { steps: [step('search_knowledge')], sources: 3, ticketId: null, personaVersion: 7 },
      }),
    )
    expect(c.note).toContain('提示词 v7')
  })

  it('版本为 0（回退内置副本）时不标注版本，避免读出「v0」这种无意义归因', () => {
    const c = toCandidate(
      row({ run: { steps: [], sources: 0, ticketId: null, personaVersion: 0 } }),
    )
    expect(c.note).not.toContain('提示词 v')
  })

  it('未选原因时标注「未选原因」', () => {
    const c = toCandidate(row({ feedbackReason: null }))
    expect(c.note).toContain('用户不满：未选原因')
  })

  it('未知原因值直接透出（不崩）', () => {
    const c = toCandidate(row({ feedbackReason: 'something_new' }))
    expect(c.note).toContain('something_new')
  })
})

describe('dedupeCandidates', () => {
  it('同一 query 去重', () => {
    const a = toCandidate(row())
    const b = toCandidate(row())
    expect(dedupeCandidates([a, b])).toHaveLength(1)
  })

  it('去重时保留带原因的那条', () => {
    const noReason = toCandidate(row({ feedbackReason: null }))
    const withReason = toCandidate(row({ feedbackReason: 'unsolved' }))
    const out = dedupeCandidates([noReason, withReason])
    expect(out).toHaveLength(1)
    expect(out[0].note).toContain('没解决我的问题')
  })

  it('不同 query 各自保留', () => {
    const out = dedupeCandidates([toCandidate(row()), toCandidate(row({ query: '另一个问题' }))])
    expect(out).toHaveLength(2)
  })
})
