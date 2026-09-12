import type OpenAI from 'openai'
import {
  COMPACTED_TOOL_RESULT,
  enforceLoopBudget,
  estimateTokens,
  msgTokens,
  totalTokens,
  trimHistoryToBudget,
} from './context-budget'

// 行为依据（与实现一致）：
// - estimateTokens：CJK 1/字，ASCII 0.25/字符，其余 0.5/字符，向上取整
// - trimHistoryToBudget 只裁 [historyStart, historyEnd) 内的非 system 消息，从最旧开始
// - enforceLoopBudget 先裁历史，仍超限则把 protectedFrom 之前的 tool 结果压成占位，
//   本轮（protectedFrom 起）消息一律不动

type Msg = OpenAI.Chat.ChatCompletionMessageParam

// 400 个 ASCII 字符 = 100 tokens，便于用整数推演预算
const ascii = (tokens: number) => 'a'.repeat(tokens * 4)

const toolCall = (id: string) => [
  { id, type: 'function' as const, function: { name: 'search_knowledge', arguments: '{"q":"x"}' } },
]

describe('estimateTokens', () => {
  it('按 CJK 1/字、ASCII 0.25/字符 估算并向上取整', () => {
    expect(estimateTokens('中文测试')).toBe(4)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    // 0.25 * 3 = 0.75 → 向上取整为 1
    expect(estimateTokens('abc')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('msgTokens', () => {
  it('计入字符串 content', () => {
    expect(msgTokens({ role: 'user', content: ascii(100) })).toBe(100)
  })

  it('计入多段 content 的 text 片段', () => {
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: ascii(10) },
        { type: 'text', text: ascii(20) },
      ],
    } as unknown as Msg
    expect(msgTokens(msg)).toBe(30)
  })

  it('计入 assistant 的 tool_calls（content 为空也不为 0）', () => {
    const msg = { role: 'assistant', content: null, tool_calls: toolCall('c1') } as unknown as Msg
    expect(msgTokens(msg)).toBeGreaterThan(0)
  })
})

describe('trimHistoryToBudget', () => {
  // [system, h1, h2, prompt]：历史区间为 [1, 3)
  const build = (): Msg[] => [
    { role: 'system', content: ascii(10) },
    { role: 'user', content: ascii(100) },
    { role: 'assistant', content: ascii(100) },
    { role: 'user', content: ascii(10) },
  ]

  it('未超预算时不动任何消息', () => {
    const messages = build()
    const res = trimHistoryToBudget(messages, 1, 3, 10000)
    expect(res).toEqual({ dropped: 0, total: 220, overLimit: false })
    expect(messages).toHaveLength(4)
  })

  it('超预算时从最旧历史开始裁，够用即停', () => {
    const messages = build()
    const res = trimHistoryToBudget(messages, 1, 3, 150)
    expect(res.dropped).toBe(1)
    expect(res.total).toBe(120)
    expect(res.overLimit).toBe(false)
    // 裁掉的是 h1（最旧），h2 与当前提问保留
    expect(messages).toHaveLength(3)
    expect(messages[1].content).toBe(ascii(100))
    expect(messages[1].role).toBe('assistant')
  })

  it('裁空历史仍超限时报告 overLimit，且不动 system 与当前提问', () => {
    const messages = build()
    const res = trimHistoryToBudget(messages, 1, 3, 10)
    expect(res.dropped).toBe(2)
    expect(res.overLimit).toBe(true)
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
  })
})

describe('enforceLoopBudget', () => {
  // 模拟两轮工具循环后的消息序列：
  // [0]system [1]h1 [2]prompt [3]assistant(r1) [4]tool(r1) [5]assistant(r2) [6]tool(r2)
  // historyStart=1，historyEnd=2（prompt 下标），protectedFrom=5（本轮 assistant）
  const build = (): Msg[] => [
    { role: 'system', content: ascii(10) },
    { role: 'user', content: ascii(100) },
    { role: 'user', content: ascii(10) },
    { role: 'assistant', content: null, tool_calls: toolCall('c1') } as unknown as Msg,
    { role: 'tool', tool_call_id: 'c1', content: ascii(200) },
    { role: 'assistant', content: null, tool_calls: toolCall('c2') } as unknown as Msg,
    { role: 'tool', tool_call_id: 'c2', content: ascii(200) },
  ]

  it('未超预算时不裁不压', () => {
    const messages = build()
    const res = enforceLoopBudget(messages, 1, 2, 5, 100000)
    expect(res.dropped).toBe(0)
    expect(res.compacted).toBe(0)
    expect(res.overLimit).toBe(false)
    expect(messages).toHaveLength(7)
  })

  it('优先裁历史，够用就不压缩工具结果', () => {
    const messages = build()
    const full = totalTokens(messages)
    // 恰好能通过裁掉 h1（100 tokens）进入预算
    const res = enforceLoopBudget(messages, 1, 2, 5, full - 100)
    expect(res.dropped).toBe(1)
    expect(res.compacted).toBe(0)
    expect(res.overLimit).toBe(false)
    expect(messages[3].content).toBe(ascii(200)) // 裁剪后左移，原 [4] 的工具结果完好
  })

  it('历史裁完仍超限时压缩旧轮工具结果，本轮结果完整保留', () => {
    const messages = build()
    const res = enforceLoopBudget(messages, 1, 2, 5, 400)
    expect(res.dropped).toBe(1)
    expect(res.compacted).toBe(1)
    expect(res.overLimit).toBe(false)
    // 左移后：[0]system [1]prompt [2]assistant(r1) [3]tool(r1) [4]assistant(r2) [5]tool(r2)
    expect(messages[3].content).toBe(COMPACTED_TOOL_RESULT) // 旧轮被压缩
    expect(messages[5].content).toBe(ascii(200)) // 本轮完整保留
    expect(res.total).toBeLessThanOrEqual(400)
  })

  it('压到极限仍超限时报告 overLimit，且绝不碰本轮消息', () => {
    const messages = build()
    const res = enforceLoopBudget(messages, 1, 2, 5, 50)
    expect(res.overLimit).toBe(true)
    expect(messages[5].content).toBe(ascii(200))
    expect(messages[4].role).toBe('assistant')
  })

  it('工具结果本身比占位更短时跳过压缩（不反向增大占用）', () => {
    const messages = build()
    messages[4] = { role: 'tool', tool_call_id: 'c1', content: '{}' }
    const res = enforceLoopBudget(messages, 1, 2, 5, 50)
    expect(res.compacted).toBe(0)
    expect(messages[3].content).toBe('{}') // 左移后仍是原内容
  })
})
