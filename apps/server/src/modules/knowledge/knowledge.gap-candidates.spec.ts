import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common'
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
  /** 缺口台账已有行 */
  ledger?: Array<{
    ticketId: string
    chatId: string | null
    category: string
    question: string
    reason: string
    hasSolution: boolean
    status: string
    closedAt: Date | null
    closedDocId: string | null
    firstSeenAt: Date
  }>
  /** 可见文档 id（成文处置要校验出处真的看得见） */
  docIds?: string[]
}

function makeService(fx: Fixture, deps: { queue?: unknown; payloads?: unknown } = {}) {
  const seen: Record<string, unknown> = {}
  const gapCreates: unknown[] = []
  const gapUpdates: Array<{ where: { ticketId: string }; data: Record<string, unknown> }> = []
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
    knowledgeGap: {
      findMany: async (args: unknown) => {
        seen.gapFindMany = args
        return fx.ledger ?? []
      },
      findUnique: async (args: { where: { ticketId: string } }) => {
        seen.gapFindUnique = args
        return (fx.ledger ?? []).find((r) => r.ticketId === args.where.ticketId) ?? null
      },
      createMany: async (args: { data: unknown[] }) => {
        seen.gapCreateMany = args
        gapCreates.push(...args.data)
        return { count: args.data.length }
      },
      update: async (args: { where: { ticketId: string }; data: Record<string, unknown> }) => {
        gapUpdates.push({ where: args.where, data: args.data })
        return { ticketId: args.where.ticketId, ...args.data }
      },
    },
    document: {
      findFirst: async (args: { where: { id: string } }) => {
        seen.docFindFirst = args
        return (fx.docIds ?? []).includes(args.where.id) ? { id: args.where.id } : null
      },
      create: async (args: { data: Record<string, unknown> }) => ({
        id: 'doc-new',
        ...args.data,
        chunkList: [],
      }),
    },
  }
  const service = new KnowledgeService(
    prisma as unknown as PrismaService,
    {} as ConfigService,
    {} as LlmClient,
    {} as EmbeddingsClient,
    {} as SettingsService,
    (deps.queue ?? {}) as IndexingQueueService,
    (deps.payloads ?? {}) as UploadPayloadStore,
  )
  return { service, seen, gapCreates, gapUpdates }
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

const ledgerRow = (
  over: Partial<NonNullable<Fixture['ledger']>[number]> & { ticketId: string },
) => ({
  chatId: 'c1',
  category: 'network',
  question: '我的 VPN 连不上，证书也重新装过了还是不行',
  reason: 'no_hit',
  hasSolution: true,
  status: 'open',
  closedAt: null,
  closedDocId: null,
  firstSeenAt: new Date(2026, 9, 1),
  ...over,
})

describe('KnowledgeService 缺口台账同步', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  it('第一次算出的缺口落进台账', async () => {
    const { service, gapCreates } = makeService({
      tickets: [ticket({})],
      userMsgs: [{ chatId: 'c1', content: '我的 VPN 连不上，证书也重新装过了还是不行' }],
    })
    const res = await service.getGapCandidates(staff)
    expect(gapCreates).toHaveLength(1)
    // 这条没装配 AgentRun → 命中数拿不到，落的是 unknown_hits 而不是假装 no_hit
    expect(gapCreates[0]).toMatchObject({
      ticketId: 't1',
      reason: 'unknown_hits',
      category: 'network',
    })
    expect(res.board).toMatchObject({ total: 1, open: 1, covered: 0, dismissed: 0 })
  })

  it('已在台账里的缺口不重复建行，处置过的不再回到待补清单', async () => {
    const { service, gapCreates } = makeService({
      tickets: [ticket({ id: 't1' }), ticket({ id: 't2' })],
      userMsgs: [{ chatId: 'c1', content: '我的 VPN 连不上，证书也重新装过了还是不行' }],
      ledger: [
        ledgerRow({
          ticketId: 't1',
          status: 'covered',
          closedDocId: 'doc-1',
          closedAt: new Date(),
        }),
        ledgerRow({ ticketId: 't2' }),
      ],
    })
    const res = await service.getGapCandidates(staff)
    expect(gapCreates).toEqual([])
    // t1 已成文 → 清单里没有了；t2 台账里是 open → 即使窗口重算出它也不再新建
    expect(res.candidates.map((c) => c.ticketId)).toEqual(['t2'])
    expect(res.board).toMatchObject({ total: 2, open: 1, covered: 1 })
  })

  it('没有新缺口时一次写库都不做', async () => {
    const { service, seen } = makeService({ tickets: [], ledger: [] })
    const res = await service.getGapCandidates(staff)
    expect(seen.gapCreateMany).toBeUndefined()
    expect(res.candidates).toEqual([])
    expect(res.board.oldestOpenDays).toBeNull()
  })
})

describe('KnowledgeService.setGapStatus', () => {
  const base = { tickets: [], ledger: [ledgerRow({ ticketId: 't1' })], docIds: ['doc-1'] }

  it('员工不能处置缺口', async () => {
    const { service } = makeService(base)
    await expect(
      service.setGapStatus({ id: 'e', role: 'employee', department: null }, 't1', {
        status: 'dismissed',
      }),
    ).rejects.toThrow(ForbiddenException)
  })

  it('台账里没有这条就说没有，不做"顺手创建"', async () => {
    const { service } = makeService(base)
    await expect(service.setGapStatus(staff, 'nope', { status: 'dismissed' })).rejects.toThrow(
      NotFoundException,
    )
  })

  it('说成文却指不出文档，拒绝', async () => {
    const { service } = makeService(base)
    await expect(service.setGapStatus(staff, 't1', { status: 'covered' })).rejects.toThrow(
      BadRequestException,
    )
  })

  it('指一篇自己看不见的文档也算没指', async () => {
    const { service } = makeService({ ...base, docIds: [] })
    await expect(
      service.setGapStatus(staff, 't1', { status: 'covered', documentId: 'doc-x' }),
    ).rejects.toThrow(BadRequestException)
  })

  it('成文：记处置人、出处与时间', async () => {
    const { service, gapUpdates } = makeService(base)
    await service.setGapStatus(staff, 't1', {
      status: 'covered',
      documentId: 'doc-1',
      note: '补了 VPN 章节',
    })
    const data = gapUpdates[0].data
    expect(data).toMatchObject({ status: 'covered', closedBy: 'u1', closedDocId: 'doc-1' })
    expect(data.closedAt).toBeInstanceOf(Date)
    expect(data.closeNote).toBe('补了 VPN 章节')
  })

  it('重新打开把处置痕迹清空，但行还在（复发要能被再次看见）', async () => {
    const { service, gapUpdates } = makeService({
      tickets: [],
      ledger: [
        ledgerRow({
          ticketId: 't1',
          status: 'covered',
          closedDocId: 'doc-1',
          closedAt: new Date(),
        }),
      ],
      docIds: ['doc-1'],
    })
    await service.setGapStatus(staff, 't1', { status: 'open' })
    expect(gapUpdates[0].data).toMatchObject({
      status: 'open',
      closedBy: null,
      closedDocId: null,
      closedAt: null,
    })
  })

  it('不打算成文（dismissed）不要求出处，但同样留处置人', async () => {
    const { service, gapUpdates } = makeService(base)
    await service.setGapStatus(staff, 't1', { status: 'dismissed', note: '一次性故障，不成文' })
    expect(gapUpdates[0].data).toMatchObject({
      status: 'dismissed',
      closedBy: 'u1',
      closedDocId: null,
    })
  })
})

describe('KnowledgeService 缺口晋升成文即闭环', () => {
  const deps = {
    payloads: { write: async () => undefined },
    queue: { enqueue: () => undefined, get: () => undefined },
  }

  it('带 fromGapTicketId 建文档：文档一落地，缺口记为已成文且出处是这篇', async () => {
    const { service, gapUpdates, seen } = makeService(
      // 刚建出来的这篇文档 id 是 doc-new，处置校验时要真的能看见它才算出处
      { tickets: [], ledger: [ledgerRow({ ticketId: 't1' })], docIds: ['doc-new'] },
      deps,
    )
    const doc = await service.createDocumentFromText(staff, {
      name: 'vpn-排查',
      content: '第一步确认客户端版本，第二步确认网关地址，8004 需重装并升级系统补丁。',
      fromGapTicketId: 't1',
    })
    expect(doc.id).toBe('doc-new')
    expect(seen.docFindFirst).toMatchObject({ where: { id: 'doc-new' } })
    expect(gapUpdates[0]).toMatchObject({
      where: { ticketId: 't1' },
      data: { status: 'covered', closedDocId: 'doc-new', closedBy: 'u1' },
    })
  })

  it('记账失败不影响成文：文档已经写进知识库了，不能因为台账问题吐回去', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service } = makeService({ tickets: [], ledger: [], docIds: [] }, deps)
    // ledger 为空 → setGapStatus 找不到行会抛 NotFound，成文路径必须照旧返回
    const doc = await service.createDocumentFromText(staff, {
      name: 'sop.md',
      content: '报销单丢失的处理步骤：先向财务报备，再走补签流程，两级审批各一次。',
      fromGapTicketId: 'ghost',
    })
    expect(doc.id).toBe('doc-new')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('缺口成文记账失败'))
  })
})
