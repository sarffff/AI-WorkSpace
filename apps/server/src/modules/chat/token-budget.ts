// ===== 每用户每日 token 预算 =====
//
// 限流管的是「请求有多频繁」，管不住「一次提问烧掉多少」：一路 Agent 是
// 1-4 次决策 + 1 次流式生成，每轮决策还要重发整个上下文。跑飞的循环（反思轮
// 反复重查、超长历史顶着上下文上限）能在几分钟内把上游配额吃穿，而这笔钱是按
// token 计的。所以除了频率，还需要一个用量闸门。
//
// 口径用 Message 上已落库的 promptTokens/completionTokens —— 与看板同一份数字，
// 不另立账本；也不依赖 AgentRun（AGENT_TRACE=off 时不落轨迹，用它会在关掉观测时
// 静默变成无限制）。
//
// 缺省 0 = 不限：预算是运维决策，不该由代码替用户拍数字。

export interface BudgetState {
  /** 0 表示不限 */
  budgetTokens: number
  usedTokens: number
  windowStart: Date
  resetsAt: Date
}

/** env USER_DAILY_TOKEN_BUDGET：非正/非法一律按「不限」 */
export function budgetLimit(raw: string | undefined): number {
  const v = parseInt(raw ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** 自然日窗口（服务器本地时区）：[当日 00:00, 次日 00:00) */
export function dayWindow(now: Date): { start: Date; resetsAt: Date } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const resetsAt = new Date(start)
  resetsAt.setDate(resetsAt.getDate() + 1)
  return { start, resetsAt }
}

export function isOverBudget(state: BudgetState): boolean {
  return state.budgetTokens > 0 && state.usedTokens >= state.budgetTokens
}

/** 面向用户的说明：给出实际数字与重置时间，而不是笼统的「请求过于频繁」 */
export function budgetMessage(state: BudgetState): string {
  const left = Math.max(state.budgetTokens - state.usedTokens, 0)
  const reset = `${state.resetsAt.getHours().toString().padStart(2, '0')}:00`
  return left > 0
    ? `今天的模型用量还剩 ${left} tokens（已用 ${state.usedTokens} / 预算 ${state.budgetTokens}），${reset} 后重置`
    : `今天的模型用量已达预算上限 ${state.budgetTokens} tokens，${reset} 后自动重置`
}
