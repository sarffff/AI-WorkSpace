import { Injectable, Logger } from '@nestjs/common'

// SSE data 帧载荷（序列化后的 AgentStreamEvent / done / error）
export type StreamEventPayload = Record<string, unknown>

export interface BufferedEvent {
  seq: number
  payload: StreamEventPayload
}

export interface StreamSession {
  chatId: string
  userId: string
  events: BufferedEvent[]
  done: boolean
  /** 显式停止（stop 端点 / 停机排空）：done 帧带此标记，前端据此收尾 */
  stopped?: boolean
  cancel: () => void
  waiters: Set<() => void>
}

// ===== 流会话：把生成与 HTTP 连接解耦（SSE resume） =====
//
// 旧模型是「断连即中断」：网络抖动 / 窗口刷新会把半成品回答丢掉，用户只能重问。
// 现在 pump 在后台消费 Agent 生成器、把事件写进本缓冲；SSE 端点只是订阅者之一：
// - 断连：退订，pump 继续跑，回答照常落库（重载页面直接看到完整答案）
// - 重连：带 afterSeq（已收到的最后 seq）回放错过的事件后 live-tail，不重不丢
// - 中断：只有 POST :id/stop 与停机排空（registerCancel）能取消 pump
//
// 内存态取舍与仓内立场一致（单实例）；多实例部署时本类与 StreamSlotService
// 需一并换共享存储，届时只改这两个类。
// 缓冲保留：done 后 60s 清理，让迟到的重连仍能回放全量。
const RETENTION_MS = 60_000

@Injectable()
export class StreamSessionService {
  private readonly logger = new Logger(StreamSessionService.name)
  private readonly sessions = new Map<string, StreamSession>()

  create(chatId: string, userId: string, cancel: () => void): StreamSession {
    const session: StreamSession = {
      chatId,
      userId,
      events: [],
      done: false,
      cancel,
      waiters: new Set(),
    }
    this.sessions.set(chatId, session)
    return session
  }

  get(chatId: string): StreamSession | undefined {
    return this.sessions.get(chatId)
  }

  // 写入一个事件帧；done 之后的写入丢弃（pump 自己收尾，不接受迟到事件）
  push(chatId: string, payload: StreamEventPayload): void {
    const session = this.sessions.get(chatId)
    if (!session || session.done) return
    session.events.push({ seq: session.events.length + 1, payload })
    this.wake(session)
  }

  // pump 收尾：标记 done 唤醒订阅者；保留窗口后清理缓冲
  finish(chatId: string): void {
    const session = this.sessions.get(chatId)
    if (!session || session.done) return
    session.done = true
    this.wake(session)
    const timer = setTimeout(() => {
      if (this.sessions.get(chatId) === session) this.sessions.delete(chatId)
    }, RETENTION_MS)
    timer.unref?.()
  }

  /** 在途会话数（观测/停机日志用） */
  activeCount(): number {
    let n = 0
    for (const s of this.sessions.values()) if (!s.done) n++
    return n
  }

  private wake(session: StreamSession) {
    for (const resolve of session.waiters) resolve()
    session.waiters.clear()
  }

  // 订阅：先回放缓冲（seq > afterSeq），再等新事件直到 done。
  // 订阅者提前退出（写端发现连接关闭）时挂起的 promise 会在 finish 唤醒后自然收尾
  async *subscribe(chatId: string, afterSeq: number): AsyncGenerator<BufferedEvent> {
    if (!this.sessions.get(chatId)) return
    let cursor = Math.max(0, Math.floor(afterSeq))
    for (;;) {
      const session = this.sessions.get(chatId)
      if (!session) return
      while (cursor < session.events.length) {
        yield session.events[cursor]
        cursor += 1
      }
      if (session.done) return
      await new Promise<void>((resolve) => {
        session.waiters.add(resolve)
      })
    }
  }
}
