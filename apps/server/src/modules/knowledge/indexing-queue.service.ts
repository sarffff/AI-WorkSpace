import { Injectable, Logger } from '@nestjs/common'

// 索引进度（前端轮询展示）
export interface IndexProgress {
  stage: 'queued' | 'extracting' | 'chunking' | 'embedding' | 'storing' | 'done' | 'failed'
  percent: number // 0-100
  chunks?: number
  error?: string
}

/**
 * 轻量进程内索引队列：
 * - 上传接口立即返回（文档落库为 processing），文件字节暂存内存
 * - 单工作线程顺序消费（embedding 接口对并发不友好）
 * - 每个文档的 stage/percent 可查询，前端轮询渲染进度
 * 不引入 BullMQ/Redis：桌面级吞吐下进程内队列足够，避免重新拉回外部依赖。
 */
@Injectable()
export class IndexingQueueService {
  private readonly logger = new Logger(IndexingQueueService.name)

  private queue: Array<{ documentId: string; buffer: Buffer }> = []
  private readonly progress = new Map<string, IndexProgress>()
  private readonly payloads = new Map<string, Buffer>()
  private running = false
  private handler: ((documentId: string, buffer: Buffer) => Promise<void>) | null = null

  // 由 KnowledgeService 在初始化时注册实际的处理函数（避免构造器循环依赖）
  registerHandler(fn: (documentId: string, buffer: Buffer) => Promise<void>) {
    this.handler = fn
  }

  enqueue(documentId: string, buffer: Buffer) {
    this.payloads.set(documentId, buffer)
    this.progress.set(documentId, { stage: 'queued', percent: 0 })
    this.queue.push({ documentId, buffer })
    this.logger.log(`enqueue document ${documentId} (pending=${this.queue.length})`)
    void this.drain()
  }

  // 更新进度（stage 必填，其余字段增量合并）
  update(
    documentId: string,
    patch: Partial<IndexProgress> & { stage: IndexProgress['stage']; percent: number },
  ) {
    const prev = this.progress.get(documentId)
    this.progress.set(documentId, { ...prev, ...patch })
  }

  get(documentId: string): IndexProgress | undefined {
    return this.progress.get(documentId)
  }

  payload(documentId: string): Buffer | undefined {
    return this.payloads.get(documentId)
  }

  // 顺序消费队列；单条失败不影响后续任务
  private async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!
        const startedAt = Date.now()
        try {
          await this.handler?.(job.documentId, job.buffer)
          this.logger.log(`document ${job.documentId} processed in ${Date.now() - startedAt}ms`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.logger.error(
            `document ${job.documentId} failed after ${Date.now() - startedAt}ms: ${message}`,
          )
          this.update(job.documentId, { stage: 'failed', percent: 100, error: message })
        } finally {
          this.payloads.delete(job.documentId)
        }
      }
    } finally {
      this.running = false
    }
  }
}
