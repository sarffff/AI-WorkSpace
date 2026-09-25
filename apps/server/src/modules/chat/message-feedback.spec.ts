import { isRatableMessage, normalizeFeedback } from './message-feedback'

// 行为依据（与实现一致）：
// - feedback 为 null/undefined/'' → 撤销评价（三字段全清空）
// - up 忽略 reason（不报错，容忍前端多送）
// - down 的 reason 可选；给了就必须是四个合法值之一
// - 非法 feedback 取值一律拒绝
// - 仅 assistant 且属于该会话的消息可评价

const at = new Date('2026-09-13T10:00:00.000Z')

describe('normalizeFeedback 撤销评价', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['空字符串', ''],
  ])('feedback 为 %s 时清空三字段', (_label, value) => {
    const res = normalizeFeedback(value, null, at)
    expect(res.ok).toBe(true)
    expect(res.patch).toEqual({ feedback: null, feedbackReason: null, feedbackAt: null })
  })

  it('撤销时即使带了 reason 也一并清空', () => {
    const res = normalizeFeedback(null, 'wrong', at)
    expect(res.patch?.feedbackReason).toBeNull()
  })
})

describe('normalizeFeedback 点赞', () => {
  it('记录 up 并写入时间', () => {
    const res = normalizeFeedback('up', null, at)
    expect(res.patch).toEqual({ feedback: 'up', feedbackReason: null, feedbackAt: at })
  })

  it('up 携带 reason 时静默丢弃（不报错）', () => {
    const res = normalizeFeedback('up', 'wrong', at)
    expect(res.ok).toBe(true)
    expect(res.patch?.feedbackReason).toBeNull()
  })
})

describe('normalizeFeedback 点踩', () => {
  it('无 reason 时也合法（用户可跳过）', () => {
    const res = normalizeFeedback('down', null, at)
    expect(res.patch).toEqual({ feedback: 'down', feedbackReason: null, feedbackAt: at })
  })

  it.each(['wrong', 'unsolved', 'bad_citation', 'irrelevant'])('接受合法原因 %s', (reason) => {
    const res = normalizeFeedback('down', reason, at)
    expect(res.ok).toBe(true)
    expect(res.patch?.feedbackReason).toBe(reason)
  })

  it.each([
    ['未知枚举', 'too_slow'],
    ['数字', 1],
    ['对象', { a: 1 }],
  ])('拒绝非法原因 %s', (_label, reason) => {
    const res = normalizeFeedback('down', reason, at)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('反馈原因不合法')
  })
})

describe('normalizeFeedback 非法取值', () => {
  it.each([
    ['未知字符串', 'maybe'],
    ['数字', 1],
    ['布尔', true],
    ['数组', ['up']],
  ])('拒绝 feedback 为 %s', (_label, value) => {
    const res = normalizeFeedback(value, null, at)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('反馈取值不合法（up | down）')
  })
})

describe('isRatableMessage', () => {
  it('assistant 且同会话可评价', () => {
    expect(isRatableMessage({ role: 'assistant', chatId: 'c1' }, 'c1')).toBe(true)
  })

  it.each([
    ['user 消息', { role: 'user', chatId: 'c1' }, 'c1'],
    ['system 消息', { role: 'system', chatId: 'c1' }, 'c1'],
    ['跨会话消息', { role: 'assistant', chatId: 'c2' }, 'c1'],
  ])('%s 不可评价', (_label, msg, chatId) => {
    expect(isRatableMessage(msg, chatId)).toBe(false)
  })
})
