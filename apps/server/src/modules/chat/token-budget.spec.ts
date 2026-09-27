import {
  budgetLimit,
  budgetMessage,
  dayWindow,
  isOverBudget,
  type BudgetState,
} from './token-budget'

// 行为依据（与实现一致）：
// - 缺省不限：预算是运维决策，代码不替用户拍数字；非正/非法一律按不限
// - 窗口是服务器本地自然日 [00:00, 次日 00:00)
// - 面向用户的文案要给出实际数字与重置时间，而不是笼统的「请求过于频繁」

describe('budgetLimit', () => {
  it('缺省与非法值都按不限（0）', () => {
    for (const raw of [undefined, '', 'abc', '0', '-1', '   ']) {
      expect(budgetLimit(raw)).toBe(0)
    }
  })

  it('正整数生效', () => {
    expect(budgetLimit('10000')).toBe(10000)
    expect(budgetLimit(' 20000 ')).toBe(20000)
  })

  it('小数只取整数部分（token 没有半个）', () => {
    expect(budgetLimit('1500.9')).toBe(1500)
  })
})

describe('dayWindow', () => {
  it('窗口是本地自然日，次日 00:00 重置', () => {
    const now = new Date(2026, 8, 27, 14, 35, 12, 500)
    const { start, resetsAt } = dayWindow(now)
    expect(start).toEqual(new Date(2026, 8, 27, 0, 0, 0, 0))
    expect(resetsAt).toEqual(new Date(2026, 8, 28, 0, 0, 0, 0))
  })

  it('跨月/跨年边界正确', () => {
    expect(dayWindow(new Date(2026, 11, 31, 23, 59)).resetsAt).toEqual(new Date(2027, 0, 1))
    expect(dayWindow(new Date(2026, 1, 28, 12)).resetsAt).toEqual(new Date(2026, 2, 1))
  })
})

describe('isOverBudget / budgetMessage', () => {
  const state = (over: Partial<BudgetState>): BudgetState => ({
    budgetTokens: 10_000,
    usedTokens: 0,
    windowStart: new Date(2026, 8, 27, 0, 0, 0, 0),
    resetsAt: new Date(2026, 8, 28, 0, 0, 0, 0),
    ...over,
  })

  it('不限预算时永不拦截', () => {
    expect(isOverBudget(state({ budgetTokens: 0, usedTokens: 99_999_999 }))).toBe(false)
  })

  it('用满即拦（等于预算就不该再放行）', () => {
    expect(isOverBudget(state({ usedTokens: 9_999 }))).toBe(false)
    expect(isOverBudget(state({ usedTokens: 10_000 }))).toBe(true)
  })

  it('文案带真实数字与重置时间', () => {
    expect(budgetMessage(state({ usedTokens: 12_000 }))).toBe(
      '今天的模型用量已达预算上限 10000 tokens，00:00 后自动重置',
    )
    // 未超但被查询时（如看板提示）：说明还剩多少
    expect(budgetMessage(state({ usedTokens: 4_000 }))).toBe(
      '今天的模型用量还剩 6000 tokens（已用 4000 / 预算 10000），00:00 后重置',
    )
  })
})
