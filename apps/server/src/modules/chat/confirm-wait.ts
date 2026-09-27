export type ConfirmOutcome = 'approved' | 'rejected' | 'expired'

// ===== HITL 确认门的有界等待 =====
//
// 确认门原本只等一个内存 resolver。两个后果：
// 1. 多实例部署下确认请求打到另一台机器，那台会按持久化草稿把单建出来，
//    而本实例的生成器永远等不到 —— SSE 连接、会话槽位、界面「生成中」全部冻住，
//    直到用户关窗口。
// 2. 单机也一样：用户把确认卡晾在一边，这一路流就无限期占着。
//
// 改成三路竞速：本实例的 resolver / 草稿状态被别处改写（轮询）/ 超时。
// 超时不是失败也不是拒绝 —— 草稿保持 pending，用户之后重新进入会话时确认卡会被
// GET /ticket-drafts 恢复，那时点确认走 resolveConfirm 的持久化分支照样能建单。
//
// 第四个入口是调用方的取消信号（客户端断连）：生成器此刻正 await 在这里、没有中间
// yield，queued 的 return() 要等它 settle 才生效 —— 不接信号的话，用户关了窗口后
// 这条流还会占着会话槽位与轮询直到超时窗口跑完。按 'expired' 收，语义与超时同一路。
//
// 独立成纯函数模块（依赖注入读写），是为了能不带 Prisma/LLM 直接测这三条分支。

export interface ConfirmWaitDeps {
  /** 读草稿当前状态；读失败应返回 null（本轮不据此判定） */
  readDraftStatus: (requestId: string) => Promise<string | null>
  timeoutMs: number
  pollMs: number
}

export async function waitForConfirmRequest(
  deps: ConfirmWaitDeps,
  requestId: string,
  localDecision: Promise<boolean>,
  signal?: AbortSignal,
): Promise<ConfirmOutcome> {
  let poll: NodeJS.Timeout | undefined
  let expiry: NodeJS.Timeout | undefined
  let onGone: (() => void) | undefined

  // 轮询而不是订阅：本项目的共享状态层就是 MySQL，加发布订阅为这一个场景不值当
  const fromDraft = new Promise<ConfirmOutcome>((resolve) => {
    poll = setInterval(() => {
      void deps
        .readDraftStatus(requestId)
        .then((status) => {
          if (status === 'approved' || status === 'rejected') resolve(status)
        })
        .catch(() => undefined)
    }, deps.pollMs)
  })

  const timedOut = new Promise<ConfirmOutcome>((resolve) => {
    expiry = setTimeout(() => resolve('expired'), deps.timeoutMs)
  })

  const racers: Promise<ConfirmOutcome>[] = [
    localDecision.then((approved) => (approved ? 'approved' : 'rejected')),
    fromDraft,
    timedOut,
  ]
  if (signal) {
    // 断连与超时同归：本轮不建单，草稿留着
    racers.push(
      new Promise<ConfirmOutcome>((resolve) => {
        if (signal.aborted) {
          resolve('expired')
          return
        }
        onGone = () => resolve('expired')
        signal.addEventListener('abort', onGone, { once: true })
      }),
    )
  }

  try {
    return await Promise.race(racers)
  } finally {
    if (poll) clearInterval(poll)
    if (expiry) clearTimeout(expiry)
    if (signal && onGone) signal.removeEventListener('abort', onGone)
  }
}

/** 等待窗口与轮询间隔：轮询至少 100ms，最多占等待窗口的四分之一 */
export function confirmWaitWindows(rawTimeout?: string, rawPoll?: string) {
  const timeoutMs = parseInt(rawTimeout ?? '', 10)
  const pollRaw = parseInt(rawPoll ?? '', 10)
  const t = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000
  const p = Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : Math.max(100, Math.min(2000, t / 4))
  return { timeoutMs: t, pollMs: p }
}
