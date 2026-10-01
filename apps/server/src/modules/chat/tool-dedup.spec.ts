import { markDuplicates, toolCallSignature, type RoundCall } from './tool-dedup'

// 行为依据（与实现一致）：
// - 签名 = 工具名 + 规范化参数；key 顺序不影响；空参数与 {} 同签名；非 JSON 退回原始串
// - markDuplicates 同时处理跨轮（seen）与同轮内重复，第一个出现的算新鲜、其余算重复

describe('toolCallSignature', () => {
  it('相同工具 + 相同参数 → 同一签名', () => {
    expect(toolCallSignature('search_knowledge', '{"query":"vpn"}')).toBe(
      toolCallSignature('search_knowledge', '{"query":"vpn"}'),
    )
  })

  it('参数 key 顺序不影响签名', () => {
    expect(toolCallSignature('t', '{"a":1,"b":2}')).toBe(toolCallSignature('t', '{"b":2,"a":1}'))
  })

  it('空参数与空对象归一到同一签名', () => {
    expect(toolCallSignature('t', '')).toBe(toolCallSignature('t', '{}'))
    expect(toolCallSignature('t', undefined)).toBe(toolCallSignature('t', '{}'))
  })

  it('不同工具或不同参数 → 不同签名', () => {
    expect(toolCallSignature('t', '{"q":"a"}')).not.toBe(toolCallSignature('t', '{"q":"b"}'))
    expect(toolCallSignature('a', '{"q":"x"}')).not.toBe(toolCallSignature('b', '{"q":"x"}'))
  })

  it('非 JSON 参数退回原始串（拿不到结构也不放过重复）', () => {
    expect(toolCallSignature('t', 'not json')).toBe(toolCallSignature('t', 'not json'))
    expect(toolCallSignature('t', 'not json')).toBe('t:not json')
  })
})

describe('markDuplicates', () => {
  const call = (id: string, name: string, rawArgs?: string): RoundCall => ({ id, name, rawArgs })

  it('同一轮内相同签名：第一个新鲜，其余判重复', () => {
    const { duplicateIds } = markDuplicates(
      [
        call('1', 'search_knowledge', '{"query":"vpn"}'),
        call('2', 'search_knowledge', '{"query":"vpn"}'),
        call('3', 'search_knowledge', '{"query":"other"}'),
      ],
      new Set(),
    )
    expect(duplicateIds.has('1')).toBe(false)
    expect(duplicateIds.has('2')).toBe(true)
    expect(duplicateIds.has('3')).toBe(false)
  })

  it('跨轮：签名已在 seen 中则判重复', () => {
    const seen = new Set([toolCallSignature('get_ticket', '{"id":"TK1"}')])
    const { duplicateIds } = markDuplicates([call('1', 'get_ticket', '{"id":"TK1"}')], seen)
    expect(duplicateIds.has('1')).toBe(true)
  })

  it('signatureById 覆盖每个调用，供调用方成功后写入 seen', () => {
    const { signatureById } = markDuplicates(
      [call('1', 'search_knowledge', '{"query":"vpn"}')],
      new Set(),
    )
    expect(signatureById.get('1')).toBe(toolCallSignature('search_knowledge', '{"query":"vpn"}'))
  })

  it('不同调用互不影响（无误判）', () => {
    const { duplicateIds } = markDuplicates(
      [call('1', 'search_knowledge', '{"query":"a"}'), call('2', 'get_ticket', '{"id":"x"}')],
      new Set(),
    )
    expect(duplicateIds.size).toBe(0)
  })
})
