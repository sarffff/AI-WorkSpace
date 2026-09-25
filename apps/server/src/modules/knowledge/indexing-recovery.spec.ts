import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { EmbeddingsClient } from '@/common/embeddings'
import type { LlmClient } from '@/common/llm-client'
import type { PrismaService } from '@/prisma/prisma.service'
import type { SettingsService } from '@/modules/settings/settings.service'
import { IndexingQueueService } from './indexing-queue.service'
import { KnowledgeService } from './knowledge.service'

// 行为依据（与实现一致）：
// - 上传字节只在内存队列暂存、从不落盘，重启后无法续跑 → 中断文档必须收敛到 failed
// - 只处理 createdAt 早于「now - 宽限期」的 processing 文档（宽限期默认 10 分钟，
//   env RAG_INDEX_STALE_GRACE_MIN），避免多实例部署误杀另一实例正在索引的文档
// - 恢复失败只记日志，绝不阻塞启动

const GRACE_MIN = '10'

interface FindArgs {
  where?: Record<string, unknown>
  select?: Record<string, unknown>
}

function makeService(opts: { stranded?: { id: string; name: string }[]; findError?: Error }) {
  const calls = {
    findMany: [] as FindArgs[],
    updateMany: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    warnings: [] as string[],
    registerHandler: 0,
  }
  const prisma = {
    document: {
      findMany: async (args: FindArgs) => {
        calls.findMany.push(args)
        if (opts.findError) throw opts.findError
        return opts.stranded ?? []
      },
      updateMany: async (args: {
        where: Record<string, unknown>
        data: Record<string, unknown>
      }) => {
        calls.updateMany.push(args)
        return { count: (args.where.id as { in: string[] }).in.length }
      },
    },
  }

  const config = {
    get: (key: string) => (key === 'RAG_INDEX_STALE_GRACE_MIN' ? GRACE_MIN : undefined),
  }
  const queue = {
    registerHandler: () => {
      calls.registerHandler++
    },
  }

  const service = new KnowledgeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    {} as LlmClient,
    {} as EmbeddingsClient,
    {} as SettingsService,
    queue as unknown as IndexingQueueService,
  )

  // 捕获恢复过程的 warn 文案，便于断言「用户能知道为什么」
  jest.spyOn(Logger.prototype, 'warn').mockImplementation((msg: unknown) => {
    calls.warnings.push(String(msg))
  })

  // onModuleInit 内部 fire-and-forget，等一个宏任务让恢复跑完
  const settle = () => new Promise((r) => setImmediate(r))

  return { service, calls, settle }
}

describe('KnowledgeService 启动恢复中断索引', () => {
  afterEach(() => jest.restoreAllMocks())

  it('注册队列处理函数，并只捞超期的 processing 文档', async () => {
    const { service, calls, settle } = makeService({})
    service.onModuleInit()
    await settle()

    expect(calls.registerHandler).toBe(1)
    expect(calls.findMany).toHaveLength(1)
    const where = calls.findMany[0]?.where as Record<string, unknown>
    expect(where.status).toBe('processing')
    const createdAt = where.createdAt as { lt: Date }
    expect(createdAt.lt).toBeInstanceOf(Date)
    // 宽限期 10 分钟：cutoff 应落在 now-10min 附近
    const minutesAgo = (Date.now() - createdAt.lt.getTime()) / 60_000
    expect(minutesAgo).toBeGreaterThan(9.5)
    expect(minutesAgo).toBeLessThan(10.5)
  })

  it('没有中断文档时不写库、不告警', async () => {
    const { service, calls, settle } = makeService({ stranded: [] })
    service.onModuleInit()
    await settle()

    expect(calls.updateMany).toHaveLength(0)
    expect(calls.warnings).toHaveLength(0)
  })

  it('把中断文档批量置为 failed，并在日志里点名文档', async () => {
    const { service, calls, settle } = makeService({
      stranded: [
        { id: 'd1', name: 'vpn-manual.pdf' },
        { id: 'd2', name: 'onboarding.docx' },
      ],
    })
    service.onModuleInit()
    await settle()

    expect(calls.updateMany).toHaveLength(1)
    expect(calls.updateMany[0]?.data.status).toBe('failed')
    expect(calls.updateMany[0]?.where.id).toEqual({ in: ['d1', 'd2'] })
    expect(calls.warnings.join(' ')).toContain('vpn-manual.pdf')
    expect(calls.warnings.join(' ')).toContain('需重新上传')
  })

  it('恢复过程出错只记日志，不阻塞启动', async () => {
    const errors: string[] = []
    jest.spyOn(Logger.prototype, 'error').mockImplementation((msg: unknown) => {
      errors.push(String(msg))
    })
    const { service, calls, settle } = makeService({ findError: new Error('db down') })

    expect(() => service.onModuleInit()).not.toThrow()
    await settle()

    expect(calls.updateMany).toHaveLength(0)
    expect(errors.join(' ')).toContain('db down')
  })
})
