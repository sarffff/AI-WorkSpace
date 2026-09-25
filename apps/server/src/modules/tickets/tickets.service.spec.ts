import { ForbiddenException } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import { TicketsService } from './tickets.service'

// 行为依据（与实现一致）：
// - stats 仅坐席/管理员可用，取期内（createdAt >= since）工单
// - 解决时刻优先取时间线含「已解决」的系统事件，旧数据回退 resolved/closed 的 updatedAt
// - SLA 阈值：urgent 4h / high 8h / normal 24h / low 48h，耗时 <= 阈值算达标
// - 首次响应取「由 X 受理」事件；偏转率 = 1 - AI 升级工单数 / 活跃会话数（会话为 0 时为 null）
// - backlog 来自 status in (open, processing) 的 groupBy 计数

interface TicketFixture {
  id: string
  status: string
  priority: string
  source: string
  category: string
  createdAt: Date
  updatedAt: Date
  comments: { kind: string; content: string; createdAt: Date }[]
}

const base = new Date('2026-08-01T00:00:00.000Z')
const t0 = new Date(base.getTime() + 3600_000) // 所有工单统一在 +1h 创建

const tickets: TicketFixture[] = [
  {
    // urgent，4h 内解决（恰好等于阈值 → 达标）
    id: 'a',
    status: 'resolved',
    priority: 'urgent',
    source: 'manual',
    category: 'network',
    createdAt: t0,
    updatedAt: t0,
    comments: [
      {
        kind: 'system',
        content: '状态变更为「已解决」',
        createdAt: new Date(t0.getTime() + 4 * 3600_000),
      },
    ],
  },
  {
    // urgent，9h 才解决（超时）；无「已解决」事件，回退 updatedAt
    id: 'b',
    status: 'resolved',
    priority: 'urgent',
    source: 'manual',
    category: 'network',
    createdAt: t0,
    updatedAt: new Date(t0.getTime() + 9 * 3600_000),
    comments: [
      { kind: 'system', content: '由 张三 受理', createdAt: new Date(t0.getTime() + 1 * 3600_000) },
    ],
  },
  {
    // high，8h 解决（恰好等于阈值 → 达标）
    id: 'c',
    status: 'closed',
    priority: 'high',
    source: 'manual',
    category: 'hardware',
    createdAt: t0,
    updatedAt: new Date(t0.getTime() + 8 * 3600_000),
    comments: [
      { kind: 'system', content: '由 李四 受理', createdAt: new Date(t0.getTime() + 3 * 3600_000) },
      {
        kind: 'system',
        content: '状态变更为「已解决」',
        createdAt: new Date(t0.getTime() + 8 * 3600_000),
      },
    ],
  },
  {
    // AI 升级、仍待处理：计入偏转率分子，不计入 SLA
    id: 'd',
    status: 'open',
    priority: 'normal',
    source: 'agent',
    category: 'account',
    createdAt: t0,
    updatedAt: t0,
    comments: [],
  },
  {
    // low，99h 解决（超时）
    id: 'e',
    status: 'resolved',
    priority: 'low',
    source: 'manual',
    category: 'process',
    createdAt: t0,
    updatedAt: new Date(t0.getTime() + 99 * 3600_000),
    comments: [],
  },
]

const backlogRows = [
  { status: 'open', _count: { _all: 2 } },
  { status: 'processing', _count: { _all: 3 } },
]

function makeService(overrides?: {
  sessions?: number
  periodTickets?: TicketFixture[]
  backlog?: typeof backlogRows
}) {
  const prisma = {
    chat: { count: jest.fn().mockResolvedValue(overrides?.sessions ?? 10) },
    ticket: {
      findMany: jest.fn().mockResolvedValue(overrides?.periodTickets ?? tickets),
      groupBy: jest.fn().mockResolvedValue(overrides?.backlog ?? backlogRows),
    },
  }
  return {
    service: new TicketsService(prisma as unknown as PrismaService),
    prisma,
  }
}

describe('TicketsService.stats', () => {
  it('普通员工无权查看统计', async () => {
    const { service } = makeService()
    await expect(service.stats({ role: 'user' })).rejects.toThrow(ForbiddenException)
  })

  it('按期内工单统计状态分布、升级数与存量', async () => {
    const { service } = makeService()
    const result = await service.stats({ role: 'agent' })

    expect(result.periodDays).toBe(30)
    expect(result.sessions).toBe(10)
    expect(result.tickets).toEqual({
      total: 5,
      escalated: 1,
      manual: 4,
      open: 1,
      processing: 0,
      resolved: 3,
      closed: 1,
    })
    expect(result.backlog).toBe(5)
    expect(result.deflectRate).toBe(0.9)
  })

  it('SLA 达标率按优先级阈值计算（含边界：恰好等于阈值算达标）', async () => {
    const { service } = makeService()
    const result = await service.stats({ role: 'admin' })

    expect(result.sla.thresholdHours).toEqual({ urgent: 4, high: 8, normal: 24, low: 48 })
    // 达标：a(urgent 4h)、c(high 8h)；未达标：b(urgent 9h)、e(low 99h)
    expect(result.sla.met).toBe(2)
    expect(result.sla.total).toBe(4)
    expect(result.sla.rate).toBe(0.5)
    // (4 + 9 + 8 + 99) / 4 = 30；首次响应 (1 + 3) / 2 = 2
    expect(result.sla.avgResolutionHours).toBe(30)
    expect(result.sla.avgFirstResponseHours).toBe(2)
  })

  it('按优先级分组统计正确', async () => {
    const { service } = makeService()
    const result = await service.stats({ role: 'agent' })

    expect(result.byPriority).toEqual([
      { priority: 'urgent', total: 2, escalated: 0, resolved: 2, slaMet: 1 },
      { priority: 'high', total: 1, escalated: 0, resolved: 1, slaMet: 1 },
      { priority: 'normal', total: 1, escalated: 1, resolved: 0, slaMet: 0 },
      { priority: 'low', total: 1, escalated: 0, resolved: 1, slaMet: 0 },
    ])
  })

  it('按分类分组统计正确（total=0 的分类不返回）', async () => {
    const { service } = makeService()
    const result = await service.stats({ role: 'agent' })

    expect(result.byCategory).toEqual([
      { category: 'account', total: 1, escalated: 1, resolved: 0 },
      { category: 'hardware', total: 1, escalated: 0, resolved: 1 },
      { category: 'network', total: 2, escalated: 0, resolved: 2 },
      { category: 'process', total: 1, escalated: 0, resolved: 1 },
    ])
  })

  it('查询条件：期内工单 + 系统事件时间线 + 未完结存量', async () => {
    const { service, prisma } = makeService()
    await service.stats({ role: 'agent' }, 7)

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
        include: expect.objectContaining({
          comments: expect.objectContaining({ where: { kind: 'system' } }),
        }),
      }),
    )
    expect(prisma.ticket.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['status'],
        where: { status: { in: ['open', 'processing'] } },
      }),
    )
  })

  it('无活跃会话时偏转率为 null；无已解决工单时 SLA 率为 null', async () => {
    const openOnly: TicketFixture[] = [
      {
        id: 'x',
        status: 'open',
        priority: 'normal',
        source: 'manual',
        category: 'other',
        createdAt: t0,
        updatedAt: t0,
        comments: [],
      },
    ]
    const { service } = makeService({ sessions: 0, periodTickets: openOnly })
    const result = await service.stats({ role: 'agent' })

    expect(result.deflectRate).toBeNull()
    expect(result.sla.total).toBe(0)
    expect(result.sla.rate).toBeNull()
    expect(result.sla.avgResolutionHours).toBeNull()
  })
})
