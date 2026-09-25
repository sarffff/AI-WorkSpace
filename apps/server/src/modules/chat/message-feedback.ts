import {
  FEEDBACK_REASONS,
  FEEDBACK_VALUES,
  type FeedbackReason,
  type FeedbackValue,
} from '@/modules/tickets/ticket-taxonomy'

// ===== 答案反馈的校验与归一（纯函数，便于单测） =====
//
// 归一规则：
// - feedback 为 null 表示撤销评价（再次点同一按钮），连带清空原因与时间
// - reason 只在 down 时保留 —— up 携带原因无意义，静默丢弃而非报错
// - 非法枚举一律拒绝（前端只会送合法值，非法即异常调用）

export interface FeedbackPatch {
  feedback: FeedbackValue | null
  feedbackReason: FeedbackReason | null
  feedbackAt: Date | null
}

// 显式互斥字段（同 agent-tools/schema.ts 的 ValidateResult）：
// 两分支无共同可选字段时按 ok 收窄不稳定，补 never 保证 narrowing
export type NormalizeResult =
  { ok: true; patch: FeedbackPatch; error?: never } | { ok: false; error: string; patch?: never }

export function normalizeFeedback(
  feedback: unknown,
  reason: unknown,
  now: Date = new Date(),
): NormalizeResult {
  // 撤销评价
  if (feedback === null || feedback === undefined || feedback === '') {
    return { ok: true, patch: { feedback: null, feedbackReason: null, feedbackAt: null } }
  }
  if (typeof feedback !== 'string' || !(FEEDBACK_VALUES as readonly string[]).includes(feedback)) {
    return { ok: false, error: '反馈取值不合法（up | down）' }
  }
  const value = feedback as FeedbackValue

  // up：忽略 reason（不报错，容忍前端多送）
  if (value === 'up') {
    return { ok: true, patch: { feedback: 'up', feedbackReason: null, feedbackAt: now } }
  }

  // down：reason 可选，给了就必须合法
  if (reason === null || reason === undefined || reason === '') {
    return { ok: true, patch: { feedback: 'down', feedbackReason: null, feedbackAt: now } }
  }
  if (typeof reason !== 'string' || !(FEEDBACK_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: '反馈原因不合法' }
  }
  return {
    ok: true,
    patch: { feedback: 'down', feedbackReason: reason as FeedbackReason, feedbackAt: now },
  }
}

// 仅 assistant 消息可评价（用户自己的提问无从评价）
export function isRatableMessage(msg: { role: string; chatId: string }, chatId: string): boolean {
  return msg.role === 'assistant' && msg.chatId === chatId
}
