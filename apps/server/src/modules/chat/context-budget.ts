import type OpenAI from 'openai'

// ===== 上下文预算：token 估算与超限收敛（纯函数，便于单测） =====
//
// 从 chat.service 抽出，原因：Agent 工具循环内每轮都会往 messages 追加
// assistant(tool_calls) 与 tool 结果，循环前裁剪一次并不能保证循环内始终在预算内。

type Msg = OpenAI.Chat.ChatCompletionMessageParam

// 预算压缩后替换 tool 结果 content 的占位（保留 assistant/tool 配对结构，
// 只丢内容 —— 直接删 tool 消息会让 tool_call_id 失配，API 报 400）
export const COMPACTED_TOOL_RESULT =
  '{"note":"该工具结果已因上下文预算被压缩，如仍需要请重新调用该工具"}'

// 粗略 token 估算（API 未返回 usage 时的兜底）：CJK 每字 ≈ 1 token，ASCII ≈ 4 字符/token，其余 ≈ 2 字符/token
export function estimateTokens(text: string): number {
  let tokens = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) tokens += 1
    else if (code < 128) tokens += 0.25
    else tokens += 0.5
  }
  return Math.ceil(tokens)
}

// 单条消息 token 估算：字符串/多段 content 与 assistant tool_calls 均计入
export function msgTokens(msg: Msg): number {
  let total = 0
  const content = msg.content
  if (typeof content === 'string') {
    total += estimateTokens(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const text = (part as { text?: string }).text
      if (typeof text === 'string') total += estimateTokens(text)
    }
  } else if (content) {
    total += estimateTokens(JSON.stringify(content))
  }
  const toolCalls = (msg as { tool_calls?: unknown }).tool_calls
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    total += estimateTokens(JSON.stringify(toolCalls))
  }
  return total
}

export function totalTokens(messages: Msg[]): number {
  return messages.reduce((sum, m) => sum + msgTokens(m), 0)
}

export interface TrimResult {
  /** 被裁掉的历史消息条数（调用方据此下调 historyEnd 游标） */
  dropped: number
  /** 裁剪后的总 token */
  total: number
  /** 裁剪后仍超限（历史已裁空，剩下的都是不可裁内容） */
  overLimit: boolean
}

// 从 history 区间裁剪最旧的非 system 消息直到进入预算；不静默截断内容。
// history 区间为 [historyStart, historyEnd)，historyEnd 不含末尾的当前提问。
export function trimHistoryToBudget(
  messages: Msg[],
  historyStart: number,
  historyEnd: number,
  limit: number,
): TrimResult {
  let total = totalTokens(messages)
  let dropped = 0
  while (total > limit) {
    let idx = -1
    for (let i = historyStart; i < historyEnd - dropped; i++) {
      if (messages[i].role !== 'system') {
        idx = i
        break
      }
    }
    if (idx < 0) break
    const [removed] = messages.splice(idx, 1)
    total -= msgTokens(removed)
    dropped++
  }
  return { dropped, total, overLimit: total > limit }
}

export interface LoopBudgetResult extends TrimResult {
  /** 被压缩为占位的历史 tool 结果条数 */
  compacted: number
}

// 工具循环轮末的预算收敛：
// 1) 先按同一策略裁剪最旧历史；
// 2) 仍超限则把「本轮之前」的 tool 结果压缩为占位（本轮结果必须完整保留，
//    否则模型拿不到刚拿到的数据）；
// 3) 两步都做完仍超限 → overLimit=true，由调用方决定是否报错。
//
// protectedFrom 为本轮 assistant(tool_calls) 在 messages 中的下标，
// 该下标起的消息一律不动。
export function enforceLoopBudget(
  messages: Msg[],
  historyStart: number,
  historyEnd: number,
  protectedFrom: number,
  limit: number,
): LoopBudgetResult {
  const trimmed = trimHistoryToBudget(messages, historyStart, historyEnd, limit)
  let total = trimmed.total
  let compacted = 0
  if (total <= limit) {
    return { ...trimmed, total, compacted, overLimit: false }
  }
  // 裁剪造成的左移量：循环内追加的消息下标同步前移
  const shift = trimmed.dropped
  const placeholderTokens = estimateTokens(COMPACTED_TOOL_RESULT)
  for (let i = historyEnd - shift + 1; i < protectedFrom - shift && total > limit; i++) {
    const m = messages[i]
    if (m.role !== 'tool' || typeof m.content !== 'string') continue
    const before = msgTokens(m)
    // 压缩不能反向增大占用（极短结果直接跳过）
    if (before <= placeholderTokens) continue
    m.content = COMPACTED_TOOL_RESULT
    total -= before - msgTokens(m)
    compacted++
  }
  return { dropped: trimmed.dropped, total, compacted, overLimit: total > limit }
}
