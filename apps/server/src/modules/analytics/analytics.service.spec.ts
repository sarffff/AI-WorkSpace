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
}) {
  const prisma = {
    agentRun: {
      findMany: jest.fn().mockResolvedValue(overrides?.runs ?? runs),
      findUnique: jest
        .fn()
        .mockResolvedValue(overrides?.detail !== undefined ? overrides.detail : runs[0]),
    },
    message: {
      groupBy: jest.fn().mockResolvedValue(overrides?.feedbackRows ?? []),
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
