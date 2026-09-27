import { ForbiddenException, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { LlmClient } from '@/common/llm-client'
import type { EmbeddingsClient } from '@/common/embeddings'
import type { SettingsService } from '@/modules/settings/settings.service'
import type { PrismaService } from '@/prisma/prisma.service'
import { KnowledgeService } from './knowledge.service'
import type { IndexingQueueService } from './indexing-queue.service'
import type { UploadPayloadStore } from './upload-payload.store'

// 只测「三张表 → 纯函数输入」这层装配：判定与草稿由 knowledge-gap.spec.ts 钉。
// 装配最容易错的是接线本身 —— 会话原话按 chatId 对齐、命中数按 ticketId 对齐、
// 人工评论不能把系统事件算进去。

const staff = { id: 'u1', role: 'agent', department: 'IT' }

interface Fixture {
  tickets?: Array<{
    id: string
    title: string
    content: string
    category: string
    chatId: string | null
    status: string
    createdAt: Date
    comments: { content: string }[]
  }>
  userMsgs?: Array<{ chatId: string; content: string }>
  runs?: Array<{ ticketId: string | null; sources: number }>
  unlinked?: number
}

function makeService(fx: Fixture) {
  const seen: Record<string, unknown> = {}
  const prisma = {
    ticket: {
      findMany: async (args: unknown) => {
        seen.ticketFindMany = args
        return fx.tickets ?? []
      },
      count: async (args: unknown) => {
        seen.ticketCount = args
        return fx.unlinked ?? 0
      },
    },
    message: {
      findMany: async (args: unknown) => {
        seen.messageFindMany = args
        return fx.userMsgs ?? []
      },
    },
    agentRun: {
      findMany: async (args: unknown) => {
        seen.runFindMany = args
        return fx.runs ?? []
      },
    },
  }
  const service = new KnowledgeService(
    prisma as unknown as PrismaService,
    {} as ConfigService,
    {} as LlmClient,
    {} as EmbeddingsClient,
    {} as SettingsService,
    {} as IndexingQueueService,
    {} as UploadPayloadStore,
  )
  return { service, seen }
}

const ticket = (over: Partial<NonNullable<Fixture['tickets']>[number]>) => ({
  id: 't1',
  title: 'VPN 连不上',
  content: '证书重装后仍失败',
  category: 'network',
  chatId: 'c1',
  status: 'resolved',
  createdAt: new Date(2026, 8, 20),
  comments: [{ content: '已解锁账号并重置证书' }],
  ...over,
})

describe('KnowledgeService.getGapCandidates 装配', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  it('员工不可见', async () => {
    const { service } = makeService({})
    await expect(service.getGapCandidates({ role: 'employee' })).rejects.toThrow(ForbiddenException)
  })

  it('按 chatId 取用户原话、按 ticketId 取命中数，拼成一条候选', async () => {
    const { service } = makeService({
      tickets: [ticket({})],
      userMsgs: [
        { chatId: 'c1', content: '在吗' },
        { chatId: 'c1', content: '我的 VPN 连不上，证书重装了也没用' },
        { chatId: 'c9', content: '别的会话的问题，不该混进来' },
      ],
      runs: [{ ticketId: 't1', sources: 0 }],
    })

    const res = await service.getGapCandidates(staff)
    expect(res.summary.total).toBe(1)
    const [c] = res.candidates
    expect(c.question).toBe('我的 VPN 连不上，证书重装了也没用')
    expect(c.questionIsUserWords).toBe(true)
    expect(c.reason).toBe('no_hit')
    expect(c.solution).toBe('已解锁账号并重置证书')
    expect(res.scanned).toBe(1)
  })

  it('追不到运行时仍出候选，标 unknown_hits（观测关掉不该让清单静默变短）', async () => {
    const { service } = makeService({ tickets: [ticket({})], runs: [] })
    const res = await service.getGapCandidates(staff)
    expect(res.candidates[0].reason).toBe('unknown_hits')
  })

  it('只查已解决且归属会话的 AI 工单，人工评论排除系统事件', async () => {
    const { service, seen } = makeService({ tickets: [] })
    await service.getGapCandidates(staff, 14, 20)

    const where = (seen.ticketFindMany as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ source: 'agent', chatId: { not: null } })
    expect(where.status).toEqual({ in: ['resolved', 'closed'] })
    expect((seen.ticketFindMany as { take: number }).take).toBe(20)
    // 时间窗按传入天数
    const gte = (where.createdAt as { gte: Date }).gte.getTime()
    expect(Date.now() - gte).toBeGreaterThanOrEqual(13 * 86_400_000)
    // 系统事件（受理/流转）不是处理结论，必须在 DB 侧就排除
    const include = (seen.ticketFindMany as { include: { comments: { where: { kind: string } } } })
      .include
    expect(include.comments.where.kind).toBe('comment')
  })

  it('没有工单时不去查消息与运行（省两次无谓往返）', async () => {
    const { service, seen } = makeService({ tickets: [] })
    const res = await service.getGapCandidates(staff)
    expect(res.summary.total).toBe(0)
    expect(seen.messageFindMany).toBeUndefined()
    expect(seen.runFindMany).toBeUndefined()
  })

  it('把追不回会话的已解决工单数原样上报', async () => {
    const { service } = makeService({ tickets: [], unlinked: 7 })
    const res = await service.getGapCandidates(staff)
    expect(res.unlinkedResolvedTickets).toBe(7)
  })

  it('同一工单多条运行时取最后一次的命中数', async () => {
    const { service } = makeService({
      tickets: [ticket({})],
      userMsgs: [{ chatId: 'c1', content: 'vpn 连不上怎么办呀' }],
      runs: [
        { ticketId: 't1', sources: 3 },
        { ticketId: 't1', sources: 0 },
      ],
    })
    const res = await service.getGapCandidates(staff)
    expect(res.candidates[0].reason).toBe('no_hit')
  })
})
