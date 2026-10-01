// ===== 重复调用检测：同一次运行内，相同工具 + 相同参数只真正执行一次 =====
//
// 模型有时会用完全相同的参数把同一个工具连调好几轮（检索不到时反复搜同一个词最典型），
// 白烧决策轮与 token，还常把会话顶到轮数上限却始终不收敛。这里按「工具名 + 规范化参数」
// 给每次调用算签名：
// - 之前已「成功」跑过的相同签名（在 seen 里）→ 判重复，本轮不再执行；
// - 同一轮内重复出现的相同签名 → 只留第一个，其余判重复。
//
// 失败过的调用不进 seen —— 反思轮本就要模型改参数重试，换了参数签名就变，不受影响；
// 若它原样重试同一个失败调用，拦下来反而对（相同输入必然相同失败）。
//
// 注意 OpenAI 要求 assistant 的每个 tool_call 都有对应 tool 回执，所以「重复」不能直接丢：
// 调用方仍要为它补一条固定回执（DUPLICATE_CALL_NOTICE），只是跳过真正的执行与副作用。

// 递归按 key 排序后序列化，让 {"a":1,"b":2} 与 {"b":2,"a":1} 得到同一签名。
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) out[key] = canonical(src[key])
    return out
  }
  return value
}

/**
 * 工具调用签名。空参数与 `{}` 归一到同一签名；参数非 JSON（模型偶尔给裸串）时退回原始串，
 * 不因为拿不到结构就放过重复。
 */
export function toolCallSignature(name: string, rawArgs?: string): string {
  const raw = (rawArgs ?? '').trim()
  if (!raw) return `${name}:{}`
  try {
    return `${name}:${JSON.stringify(canonical(JSON.parse(raw)))}`
  } catch {
    return `${name}:${raw}`
  }
}

export interface RoundCall {
  id: string
  name: string
  rawArgs?: string
}

export interface DedupResult {
  /** 判为重复、本轮应跳过执行的调用 id */
  duplicateIds: Set<string>
  /** 每个调用 id 的签名：调用方在「成功」执行后据此把签名记进 seen */
  signatureById: Map<string, string>
}

/**
 * 标出本轮里重复的调用。`seen` 为此前各轮成功执行过的签名集合（本函数只读，
 * 由调用方在成功后写入），据此同时处理「跨轮重复」与「同轮内重复」。
 */
export function markDuplicates(calls: RoundCall[], seen: ReadonlySet<string>): DedupResult {
  const duplicateIds = new Set<string>()
  const signatureById = new Map<string, string>()
  const roundSeen = new Set<string>()
  for (const call of calls) {
    const sig = toolCallSignature(call.name, call.rawArgs)
    signatureById.set(call.id, sig)
    if (seen.has(sig) || roundSeen.has(sig)) duplicateIds.add(call.id)
    else roundSeen.add(sig)
  }
  return { duplicateIds, signatureById }
}

/** 回给模型的固定「重复调用」回执文案；也用作前端轨迹摘要的来源 */
export const DUPLICATE_CALL_NOTICE =
  '你已用完全相同的参数调用过该工具，结果与上次相同，本次已跳过。请勿重复调用：请基于已获得的结果作答，或改用不同的查询/参数，或直接回答用户。'

/** 前端轨迹里重复调用那一步的摘要 */
export const DUPLICATE_CALL_SUMMARY = '重复调用，已跳过'
