import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// ===== 每用户并发对话流上限 =====
//
// 一次 SSE 对话是这条链路上最贵的资源：一路 Agent 会打出 1-4 次决策调用 + 1 次流式
// 生成，还要在服务端挂住一个连接（HITL 确认门更可以挂很久）。此前对单客户端零约束，
// 一个脚本循环开流就能把上游模型配额和进程内存一起打满。
//
// 只数「在途流」而不做令牌桶：真正的约束是并发占用的连接与生成任务数，
// 请求频率限流由 ThrottlerGuard 另管。
//
// 计数是单进程内存态 —— 与本项目既有的 pendingConfirms / 检索索引缓存同一取舍，
// 多实例部署需要换成共享存储（Redis），届时只改本类。

export const DEFAULT_MAX_CONCURRENT_STREAMS = 2

@Injectable()
export class StreamSlotService implements BeforeApplicationShutdown {
  private readonly active = new Map<string, number>()
  private readonly logger = new Logger(StreamSlotService.name)

  constructor(private readonly config: ConfigService) {}

  /** 每用户在途流上限（env MAX_CONCURRENT_STREAMS_PER_USER）；<=0 表示不限 */
  maxPerUser(): number {
    const v = parseInt(this.config.get<string>('MAX_CONCURRENT_STREAMS_PER_USER') ?? '', 10)
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_CONCURRENT_STREAMS
  }

  /** 尝试占用一个槽位；已达上限返回 false 且不做任何改动 */
  tryAcquire(userId: string): boolean {
    const max = this.maxPerUser()
    const current = this.active.get(userId) ?? 0
    if (current >= max) return false
    this.active.set(userId, current + 1)
    return true
  }

  /**
   * 释放在途槽位。幂等：未占用过或重复释放都不会把计数压成负数，
   * 否则异常路径下多释放几次就会让上限形同虚设。
   */
  release(userId: string): void {
    const current = this.active.get(userId) ?? 0
    if (current <= 1) this.active.delete(userId)
    else this.active.set(userId, current - 1)
  }

  activeCount(userId: string): number {
    return this.active.get(userId) ?? 0
  }

  // ===== 同一会话互斥 =====
  //
  // 与「每用户并发数」是两回事：一个用户开两条不同的会话是正常的（受上面的并发上限管），
  // 但对同一个 chatId 并发开流会交错写同一份消息、产出双份 AgentRun，甚至各自走到一次
  // 确认门。状态码也刻意区分：409 = 这个会话正忙，429 = 你的配额用完了。

  private readonly chatClaims = new Map<string, string>()

  /** 占用会话；已被占用返回 false 且不改动持有者 */
  tryClaimChat(chatId: string, userId: string): boolean {
    if (this.chatClaims.has(chatId)) return false
    this.chatClaims.set(chatId, userId)
    return true
  }

  releaseChat(chatId: string): void {
    this.chatClaims.delete(chatId)
  }

  chatHolder(chatId: string): string | undefined {
    return this.chatClaims.get(chatId)
  }

  // ===== 停机时把在途流收回来 =====
  //
  // SSE 是「永不自己结束」的响应：SIGTERM 后 HTTP 服务器的 close 会一直等它排空，
  // 于是发版/重启要么卡到被 SIGKILL（半成品回答与 AgentRun 轨迹一起丢），
  // 要么靠运维手动强杀。这里注册每条流的收尾回调，停机时逐个取消 ——
  // 走的正是客户端断连那条路径：掐掉在途请求、保存半成品、落 partial 轨迹。
  //
  // 钩子必须用 beforeApplicationShutdown：Nest 的 close() 顺序是
  // onModuleDestroy → beforeApplicationShutdown → dispose()（关 HTTP 服务器）→
  // onApplicationShutdown。放在 onApplicationShutdown 里就晚了一步 ——
  // 那时 dispose() 已经卡在排空连接上，回调根本没机会跑。

  private readonly cancelling = new Map<string, () => void>()

  registerCancel(chatId: string, cancel: () => void): void {
    this.cancelling.set(chatId, cancel)
  }

  unregisterCancel(chatId: string): void {
    this.cancelling.delete(chatId)
  }

  /** 在途流数（跨用户合计）：也是停机排空要等的东西 */
  inFlight(): number {
    return this.cancelling.size
  }

  async beforeApplicationShutdown(): Promise<void> {
    const draining = this.cancelling.size
    if (!draining) return
    this.logger.log(`shutting down: cancelling ${draining} in-flight stream(s)`)
    for (const [chatId, cancel] of [...this.cancelling]) {
      // 单条流的收尾出错不该拖住整个进程退出
      try {
        cancel()
      } catch (err) {
        this.logger.warn(
          `cancel stream on shutdown failed: chat=${chatId}, ${err instanceof Error ? err.message : 'unknown'}`,
        )
      }
    }
    this.cancelling.clear()
  }
}
