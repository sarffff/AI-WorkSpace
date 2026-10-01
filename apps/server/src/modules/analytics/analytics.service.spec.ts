import { ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import type { SafeUser } from '../auth/auth.service'
import { AnalyticsService } from './analytics.service'

// 行为依据（与实现一致）：
// - overview/listRuns/runDetail 仅坐席/管理员可用（其余角色抛 ForbiddenException）
// - overview 取期内（createdAt >= now - days）最多 1000 条（按 createdAt 倒序），JS 内聚合
// - 检索命中率 = sources>0 运行占比；工单转化率 = ticketId 非空占比；无运行时为 null
// - 工具分布只统计 steps 里 kind==='tool' 的元素；model 为 null 归入 "unknown"
// - 每日聚合按本地时区 YYYY-MM-DD 分组，按日期升序返回

interface RunFixture {
  id: string
  chatId: string
  userId: string
  model: string | null
  status: string
  rounds: number
  toolCalls: number
  sources: number
  ticketId: string | null
  ticketTitle: string | null
  promptTokens: number
  completionTokens: number
  replyChars: number
  totalMs: number
  steps: unknown
  createdAt: Date
}

const dayMs = 86400_000
const dayKey = (d: Date): string => {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 期内存量：day1（2 天前）两条、day2（1 天前）一条
const day1 = new Date(Date.now() - 2 * dayMs)
const day2 = new Date(Date.now() - 1 * dayMs)

const runs: RunFixture[] = [
  {
    // 命中 + 建单：检索 → 建单 → 生成，4 步轨迹
    id: 'run-a',
    chatId: 'chat-a',
    userId: 'user-1',
    model: 'glm-4.5-air',
    status: 'completed',
    rounds: 2,
    toolCalls: 3,
    sources: 4,
    ticketId: 't1',
    ticketTitle: 'VPN 连接失败',
    promptTokens: 1000,
    completionTokens: 500,
    replyChars: 240,
    totalMs: 8000,
    steps: [
      {
        kind: 'decision',
        round: 1,
        model: 'glm-4.5-air',
        promptTokens: 400,
        completionTokens: 100,
        ms: 1200,
      },
      {
        kind: 'tool',
        tool: 'search_knowledge',
        status: 'done',
        summary: '命中 4 片段',
        ms: 900,
        round: 1,
      },
      { kind: 'tool', tool: 'create_ticket', status: 'done', summary: '已建单', ms: 600, round: 2 },
      {
        kind: 'generate',
        model: 'glm-4.5-air',
        promptTokens: 600,
        completionTokens: 400,
        ms: 5300,
        stream: true,
      },
    ],
    createdAt: day1,
  },
  {
    // 无命中无建单，model 为 null → unknown；steps 含 null 脏数据应被忽略
    id: 'run-b',
    chatId: 'chat-b',
    userId: 'user-2',
    model: null,
    status: 'partial',
    rounds: 1,
    toolCalls: 1,
    sources: 0,
    ticketId: null,
    ticketTitle: null,
    promptTokens: 300,
    completionTokens: 200,
    replyChars: 80,
    totalMs: 2000,
    steps: [null, { kind: 'tool', tool: 'get_ticket', status: 'start', round: 1 }],
    createdAt: day1,
  },
  {
    // 命中 + 建单：检索 → 查工单 → 生成，无 decision 步骤
    id: 'run-c',
    chatId: 'chat-c',
    userId: 'user-1',
    model: 'glm-4.5-air',
    status: 'completed',
    rounds: 3,
    toolCalls: 2,
    sources: 1,
    ticketId: 't2',
    ticketTitle: '打印机故障',
    promptTokens: 200,
    completionTokens: 100,
    replyChars: 60,
    totalMs: 5000,
    steps: [
      { kind: 'tool', tool: 'search_knowledge', status: 'done', round: 1 },
      { kind: 'tool', tool: 'lookup_my_tickets', status: 'done', round: 2 },
      {
        kind: 'generate',
        model: 'glm-4.5-air',
        promptTokens: 200,
        completionTokens: 100,
        ms: 4900,
        stream: true,
      },
    ],
    createdAt: day2,
  },
]

const staff: SafeUser = {
  id: 'staff-1',
  email: 'staff@example.com',
  name: null,
  avatar: null,
  department: null,
  role: 'agent',
}

const employee: SafeUser = { ...staff, id: 'emp-1', role: 'employee' }

function makeService(overrides?: {
  runs?: RunFixture[]
  detail?: RunFixture | null
  feedbackRows?: {
    feedback: string | null
    feedbackReason: string | null
    _count: { _all: number }
  }[]
  // deflection 的聚合行 + 未归属计数
  roleRows?: { chatId: string; role: string; _count: { _all: number } }[]
  /** 带引用来源的回答（sources 非空） */
  citedRows?: { chatId: string; _count: { _all: number } }[]
  downRows?: { chatId: string; _count: { _all: number } }[]
  ticketRows?: { chatId: string | null; _count: { _all: number } }[]
  categoryRows?: { category: string; _count: { _all: number } }[]
  unattributed?: number
}) {
  const o = overrides
  const prisma = {
    agentRun: {
      findMany: jest.fn().mockResolvedValue(o?.runs ?? runs),
      findUnique: jest.fn().mockResolvedValue(o?.detail !== undefined ? o.detail : runs[0]),
    },
    message: {
      // 按 by 分派，避免和调用顺序耦合（overview 与 deflection 用同一个 groupBy 不同分组）
      groupBy: jest.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => {
        if (args.by.includes('role')) return o?.roleRows ?? []
        if (args.by.includes('feedback')) return o?.feedbackRows ?? []
        // 剩下两条都是 by:['chatId']，只能靠 where 区分：带 sources 条件的那条是"有引用的回答"
        if (args.where && 'sources' in args.where) return o?.citedRows ?? []
        return o?.downRows ?? []
      }),
    },
    ticket: {
      groupBy: jest.fn(async (args: { by: string[]; where: Record<string, unknown> }) =>
        args.by.includes('category') ? (o?.categoryRows ?? []) : (o?.ticketRows ?? []),
      ),
      count: jest.fn(async (_args: { where: Record<string, unknown> }) => o?.unattributed ?? 0),
    },
  }
  return {
    service: new AnalyticsService(prisma as unknown as PrismaService),
    prisma,
  }
}

describe('AnalyticsService', () => {
  it('普通员工访问 overview/listRuns/runDetail 均被拒绝', async () => {
    const { service } = makeService()
    await expect(service.overview(employee)).rejects.toThrow(ForbiddenException)
    await expect(service.listRuns(employee)).rejects.toThrow(ForbiddenException)
    await expect(service.runDetail(employee, 'run-a')).rejects.toThrow(ForbiddenException)
  })

  it('overview 聚合：总量/命中率/转化率/平均轮次与耗时', async () => {
    const { service } = makeService()
    const result = await service.overview(staff)

    expect(result.periodDays).toBe(30)
    expect(result.totalRuns).toBe(3)
    expect(result.totalToolCalls).toBe(6)
    expect(result.totalPromptTokens).toBe(1500)
    expect(result.totalCompletionTokens).toBe(800)
    expect(result.avgRounds).toBe(2)
    expect(result.avgTotalMs).toBe(5000)
    expect(result.searchHitRate).toBe(0.667) // 命中 run-a/run-c，2/3
    expect(result.ticketConversionRate).toBe(0.667) // 建单 run-a/run-c，2/3
    // 默认无反馈：分母为 0 → 满意度率为 null（不是 0）
    expect(result.feedback).toEqual({
      up: 0,
      down: 0,
      rated: 0,
      satisfactionRate: null,
      reasonDistribution: [],
    })
  })

  it('overview 分布：工具按 steps 统计、模型 null 归入 unknown、每日按日期升序', async () => {
    const { service } = makeService()
    const result = await service.overview(staff, 7)

    expect(result.toolDistribution).toEqual([
      { tool: 'search_knowledge', count: 2 },
      { tool: 'create_ticket', count: 1 },
      { tool: 'get_ticket', count: 1 },
      { tool: 'lookup_my_tickets', count: 1 },
    ])
    expect(result.modelDistribution).toEqual([
      { model: 'glm-4.5-air', runs: 2 },
      { model: 'unknown', runs: 1 },
    ])
    expect(result.daily).toEqual([
      { date: dayKey(day1), runs: 2, promptTokens: 1300, completionTokens: 700 },
      { date: dayKey(day2), runs: 1, promptTokens: 200, completionTokens: 100 },
    ])
  })

  it('overview 查询条件：期内 + 倒序 + 上限 1000 条', async () => {
    const { service, prisma } = makeService()
    await service.overview(staff, 7)

    expect(prisma.agentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { gte: expect.any(Date) } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    )
  })

  it('无运行数据时比率与均值为 null，分布为空数组', async () => {
    const { service } = makeService({ runs: [] })
    const result = await service.overview(staff)

    expect(result.totalRuns).toBe(0)
    expect(result.searchHitRate).toBeNull()
    expect(result.ticketConversionRate).toBeNull()
    expect(result.avgRounds).toBeNull()
    expect(result.avgTotalMs).toBeNull()
    expect(result.toolDistribution).toEqual([])
    expect(result.modelDistribution).toEqual([])
    expect(result.daily).toEqual([])
  })

  it('overview 聚合反馈：满意度率只按已评价消息计，无原因的 👎 归入 unspecified', async () => {
    const { service } = makeService({
      feedbackRows: [
        { feedback: 'up', feedbackReason: null, _count: { _all: 7 } },
        { feedback: 'down', feedbackReason: 'wrong', _count: { _all: 2 } },
        { feedback: 'down', feedbackReason: 'unsolved', _count: { _all: 1 } },
        { feedback: 'down', feedbackReason: null, _count: { _all: 1 } },
      ],
    })
    const result = await service.overview(staff)
    expect(result.feedback.up).toBe(7)
    expect(result.feedback.down).toBe(4)
    expect(result.feedback.rated).toBe(11)
    expect(result.feedback.satisfactionRate).toBe(0.636) // 7/11
    expect(result.feedback.reasonDistribution).toEqual([
      { reason: 'wrong', count: 2 },
      { reason: 'unsolved', count: 1 },
      { reason: 'unspecified', count: 1 },
    ])
  })

  it('listRuns 按倒序分页查询，仅取轻量字段', async () => {
    const { service, prisma } = makeService()
    await service.listRuns(staff, 20, 40)

    expect(prisma.agentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 40,
        select: expect.not.objectContaining({ steps: expect.anything() }),
      }),
    )
  })

  it('runDetail 返回完整行（含 steps）；不存在抛 NotFoundException', async () => {
    const { service } = makeService()
    await expect(service.runDetail(staff, 'run-a')).resolves.toEqual(runs[0])

    const { service: empty } = makeService({ detail: null })
    await expect(empty.runDetail(staff, 'missing')).rejects.toThrow(NotFoundException)
  })
})

// groupBy 行 → 会话事实 这层映射：纯函数已有自己的 spec，这里只测装配
describe('AnalyticsService.deflection', () => {
  it('普通员工不可见', async () => {
    const { service } = makeService()
    await expect(service.deflection(employee)).rejects.toThrow(ForbiddenException)
  })

  it('按 role 分桶装配会话事实，偏转率按会话算', async () => {
    const { service } = makeService({
      roleRows: [
        { chatId: 'c1', role: 'user', _count: { _all: 2 } },
        { chatId: 'c1', role: 'assistant', _count: { _all: 2 } },
        { chatId: 'c2', role: 'user', _count: { _all: 1 } },
        { chatId: 'c2', role: 'assistant', _count: { _all: 1 } },
        { chatId: 'c3', role: 'user', _count: { _all: 1 } },
        { chatId: 'c3', role: 'assistant', _count: { _all: 1 } },
        // 只提问没人答（断连/失败）：不进分母
        { chatId: 'c4', role: 'user', _count: { _all: 3 } },
      ],
      downRows: [{ chatId: 'c3', _count: { _all: 1 } }],
      // 只有 c1 的回答带引用：c3 没升级、也没被 👎，但整段会话没查过资料 → 无依据偏转
      citedRows: [{ chatId: 'c1', _count: { _all: 2 } }],
      ticketRows: [{ chatId: 'c2', _count: { _all: 1 } }],
      categoryRows: [
        { category: 'network', _count: { _all: 1 } },
        { category: 'other', _count: { _all: 0 } },
      ],
      unattributed: 0,
    })

    const r = await service.deflection(staff, 30)
    expect(r).toMatchObject({
      answeredSessions: 3,
      escalatedSessions: 1,
      deflectedSessions: 2,
      deflectionRate: 0.6667,
      lowConfidenceDeflections: 1,
      ungroundedDeflections: 1,
      ungroundedShare: 0.5,
      unansweredSessions: 1,
      attributionCoverage: 1,
    })
    // 知识缺口按升级数排，零的丢掉
    expect(r.knowledgeGaps).toEqual([{ category: 'network', escalated: 1 }])
  })

  it('查询条件带期内与来源，未归属单独 count（不能靠 JS 过滤代替）', async () => {
    const { service, prisma } = makeService({ unattributed: 2 })
    const r = await service.deflection(staff, 7)

    const since = new Date(Date.now() - 7 * 86400_000)
    const countArgs = prisma.ticket.count.mock.calls[0][0] as {
      where: { source: string; createdAt: { gte: Date }; chatId: null }
    }
    expect(countArgs.where).toEqual({
      source: 'agent',
      createdAt: expect.any(Object),
      chatId: null,
    })
    expect(countArgs.where.createdAt.gte.getTime()).toBeCloseTo(since.getTime(), -2)
    const groupArgs = prisma.ticket.groupBy.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(groupArgs.where.source).toBe('agent')
    expect((groupArgs.where.createdAt as { gte: Date }).gte.getTime()).toBeCloseTo(
      since.getTime(),
      -2,
    )
    // 2 张老工单追不回会话：不进分子，但 coverage 要体现出来
    expect(r.unattributedAgentTickets).toBe(2)
    // 「有引用的回答」那条聚合必须自己带上 sources 条件：少了它，无依据偏转会把
    // 所有会话都算成有依据（等于这个指标永远为 0）
    const msgGroupArgs = prisma.message.groupBy.mock.calls as Array<
      [{ by: string[]; where?: Record<string, unknown> }]
    >
    const citedArgs = msgGroupArgs.find(
      ([a]) => a.by.join(',') === 'chatId' && a.where && 'sources' in a.where,
    )?.[0]
    expect(citedArgs).toBeDefined()
    expect(citedArgs!.where).toMatchObject({
      role: 'assistant',
      sources: { not: null },
      createdAt: expect.any(Object),
    })
    expect(r.attributionCoverage).toBe(0)
  })
})
