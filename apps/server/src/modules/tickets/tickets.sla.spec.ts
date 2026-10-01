import { ForbiddenException, Logger } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import type { NotificationsService } from '../notifications/notifications.service'
import { TicketsService } from './tickets.service'

// 行为依据（与实现一致）：
// - 建单按优先级从此刻折算 dueAt（urgent 4h/high 8h/normal 24h/low 48h）
// - 改优先级且未完结时按 createdAt 重算 dueAt；已解决/关闭不动
// - slaBreaches 只坐席可用，扫未完结存量按 dueAt 分 已违约/濒临(剩余<=窗口25%)/在时限，
//   dueAt 为空的老单单列为 unscheduled，不混进分档

const HOUR = 3_600_000

describe('TicketsService SLA dueAt 写入', () => {
  function make() {
    const created: Record<string, unknown>[] = []
    const updated: Record<string, unknown>[] = []
    const events: string[] = []
    const prisma = {
      ticket: {
        create: async (a: { data: Record<string, unknown> }) => {
          created.push(a.data)
          return { id: 'TK1', priority: a.data.priority, ...a.data }
        },
        // getVisibleTicket 用；测试按需覆盖返回值
        findUnique: async () => make.current,
        update: async (a: { data: Record<string, unknown> }) => {
          updated.push(a.data)
          return { id: 'TK1', creator: {}, assignee: {}, ...a.data }
        },
      },
      ticketComment: {
        create: async (a: { data: { content: string } }) => {
          events.push(a.data.content)
          return a.data
        },
      },
      memory: {},
    }
    return {
      service: new TicketsService(prisma as unknown as PrismaService),
      created,
      updated,
      events,
    }
  }
  // getVisibleTicket 的返回，测试各自设置
  make.current = {} as Record<string, unknown>

  it('建单按优先级折算 dueAt（high → +8h）', async () => {
    const { service, created } = make()
    const t0 = Date.now()
    await service.create('u1', { title: 't', content: 'c', priority: 'high', category: 'network' })
    const dueAt = created[0].dueAt as Date
    // 允许几秒执行误差
    expect(dueAt.getTime() - t0).toBeGreaterThanOrEqual(8 * HOUR - 5000)
    expect(dueAt.getTime() - t0).toBeLessThanOrEqual(8 * HOUR + 5000)
  })

  it('缺省优先级按 normal → +24h', async () => {
    const { service, created } = make()
    const t0 = Date.now()
    await service.create('u1', { title: 't', content: 'c' })
    const dueAt = created[0].dueAt as Date
    expect(dueAt.getTime() - t0).toBeGreaterThanOrEqual(24 * HOUR - 5000)
  })

  it('改优先级且未完结：按 createdAt 重算 dueAt（normal→urgent = createdAt+4h）', async () => {
    const { service, updated } = make()
    const createdAt = new Date('2026-09-01T00:00:00.000Z')
    make.current = { id: 'TK1', creatorId: 'u1', priority: 'normal', status: 'open', createdAt }
    await service.update({ id: 'admin', role: 'agent' }, 'TK1', { priority: 'urgent' })
    const data = updated[0]
    expect((data.dueAt as Date).getTime()).toBe(createdAt.getTime() + 4 * HOUR)
  })

  it('已解决的工单改优先级不动 dueAt（违约扫描只看未完结的）', async () => {
    const { service, updated } = make()
    make.current = {
      id: 'TK1',
      creatorId: 'u1',
      priority: 'normal',
      status: 'resolved',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    }
    await service.update({ id: 'admin', role: 'agent' }, 'TK1', { priority: 'urgent' })
    expect(updated[0].dueAt).toBeUndefined()
  })
})

describe('TicketsService.slaBreaches', () => {
  const now = Date.now()
  const active = [
    // normal（窗口 24h）已超时 2h → breached
    {
      id: 'b1',
      title: '超时单',
      priority: 'normal',
      category: 'network',
      status: 'processing',
      dueAt: new Date(now - 2 * HOUR),
      createdAt: new Date(now - 26 * HOUR),
      assignee: { name: '张三', email: null },
    },
    // urgent（窗口 4h，阈值 1h）剩 0.5h → atRisk
    {
      id: 'r1',
      title: '快到期',
      priority: 'urgent',
      category: 'account',
      status: 'open',
      dueAt: new Date(now + 0.5 * HOUR),
      createdAt: new Date(now - 3.5 * HOUR),
      assignee: null,
    },
    // normal 剩 10h（> 阈值 6h）→ onTrack
    {
      id: 'k1',
      title: '还早',
      priority: 'normal',
      category: 'software',
      status: 'open',
      dueAt: new Date(now + 10 * HOUR),
      createdAt: new Date(now - 14 * HOUR),
      assignee: null,
    },
    // 老单没有 dueAt → unscheduled
    {
      id: 'u1',
      title: '未排期',
      priority: 'low',
      category: 'other',
      status: 'open',
      dueAt: null,
      createdAt: new Date(now - 100 * HOUR),
      assignee: null,
    },
  ]

  function make(rows: unknown[]) {
    const prisma = { ticket: { findMany: async () => rows } }
    return new TicketsService(prisma as unknown as PrismaService)
  }

  it('员工不可查看', async () => {
    await expect(make(active).slaBreaches({ role: 'employee' })).rejects.toThrow(ForbiddenException)
  })

  it('按 dueAt 分档，老单单列为 unscheduled 不混进分档', async () => {
    const res = await make(active).slaBreaches({ role: 'agent' })
    expect(res.activeTotal).toBe(4)
    expect(res.breachedCount).toBe(1)
    expect(res.atRiskCount).toBe(1)
    expect(res.onTrackCount).toBe(1)
    expect(res.unscheduledCount).toBe(1)
    expect(res.breached[0]).toMatchObject({ id: 'b1', assignee: '张三' })
    expect((res.breached[0] as { overdueHours: number }).overdueHours).toBeCloseTo(2, 0)
    expect(res.atRisk[0]).toMatchObject({ id: 'r1' })
    expect((res.atRisk[0] as { remainingHours: number }).remainingHours).toBeCloseTo(0.5, 1)
  })

  it('违约的按超时最久在前排序', async () => {
    const rows = [
      { ...active[0], id: 'less', dueAt: new Date(now - 1 * HOUR) },
      { ...active[0], id: 'more', dueAt: new Date(now - 9 * HOUR) },
    ]
    const res = await make(rows).slaBreaches({ role: 'admin' })
    expect(res.breached.map((b) => (b as { id: string }).id)).toEqual(['more', 'less'])
  })
})

// 扫描器是「每阶段只推一次」这个不变量的唯一执行者，也是 SLA 从"事后统计"走向
// "事前预警"的那一步；它同时是 notifyStaff 那条 fire-and-forget 链的入口。
describe('TicketsService.scanSlaStages', () => {
  const H = 3_600_000
  const now = new Date('2026-10-01T12:00:00.000Z')

  interface Row {
    id: string
    title: string
    priority: string
    dueAt: Date | null
    slaNotifyStage: string | null
  }

  function makeScan(rows: Row[], opts: { failStaffLookup?: boolean } = {}) {
    const stageWrites: Array<{ id: string; stage: string }> = []
    const sent: Array<{ userIds: string[]; type: string }> = []
    const seen: Record<string, unknown> = {}
    const prisma = {
      ticket: {
        findMany: async (a: unknown) => {
          seen.ticketFindMany = a
          return rows
        },
        update: async (a: { where: { id: string }; data: { slaNotifyStage: string } }) => {
          stageWrites.push({ id: a.where.id, stage: a.data.slaNotifyStage })
          return a
        },
      },
      user: {
        findMany: async () => {
          if (opts.failStaffLookup) throw new Error('db down')
          return [{ id: 's1' }, { id: 's2' }]
        },
      },
    }
    const notifications = {
      send: async (userIds: string[], input: { type: string }) => {
        sent.push({ userIds, type: input.type })
      },
    }
    const service = new TicketsService(
      prisma as unknown as PrismaService,
      undefined,
      notifications as unknown as NotificationsService,
    )
    return { service, stageWrites, sent, seen }
  }

  // 通知是旁路的异步链，扫描返回后还要等一轮才落定
  const flush = () => new Promise((res) => setImmediate(res))

  it('已过期且未通知：推到 breached 并通知全体坐席', async () => {
    const { service, stageWrites, sent } = makeScan([
      {
        id: 't1',
        title: '超时单',
        priority: 'high',
        dueAt: new Date(now.getTime() - H),
        slaNotifyStage: null,
      },
    ])
    expect(await service.scanSlaStages(now)).toEqual({ atRisk: 0, breached: 1 })
    await flush()
    expect(stageWrites).toEqual([{ id: 't1', stage: 'breached' }])
    expect(sent).toEqual([{ userIds: ['s1', 's2'], type: 'sla_breached' }])
  })

  it('同一阶段只推一次：再扫一遍既不重写也不重发', async () => {
    const { service, stageWrites, sent } = makeScan([
      {
        id: 't1',
        title: '已通知过',
        priority: 'high',
        dueAt: new Date(now.getTime() - H),
        slaNotifyStage: 'breached',
      },
    ])
    expect(await service.scanSlaStages(now)).toEqual({ atRisk: 0, breached: 0 })
    await flush()
    expect(stageWrites).toEqual([])
    expect(sent).toEqual([])
  })

  it('濒临时先推 at_risk，真过期后还能再推进到 breached（阶段只前进不复读）', async () => {
    // urgent 窗口 4h，at_risk 门槛 = 剩余 <= 1h
    const row: Row = {
      id: 't1',
      title: '快到期',
      priority: 'urgent',
      dueAt: new Date(now.getTime() + 0.5 * H),
      slaNotifyStage: null,
    }
    const early = makeScan([row])
    expect(await early.service.scanSlaStages(now)).toEqual({ atRisk: 1, breached: 0 })
    await flush()
    expect(early.sent[0]).toMatchObject({ type: 'sla_at_risk' })

    const late = makeScan([
      { ...row, dueAt: new Date(now.getTime() - H), slaNotifyStage: 'at_risk' },
    ])
    expect(await late.service.scanSlaStages(now)).toEqual({ atRisk: 0, breached: 1 })
    await flush()
    expect(late.sent[0]).toMatchObject({ type: 'sla_breached' })
  })

  it('剩余时间还够的单不通知也不写脏阶段', async () => {
    const { service, stageWrites, sent } = makeScan([
      {
        id: 't1',
        title: '还早',
        priority: 'normal',
        dueAt: new Date(now.getTime() + 20 * H),
        slaNotifyStage: null,
      },
    ])
    expect(await service.scanSlaStages(now)).toEqual({ atRisk: 0, breached: 0 })
    await flush()
    expect(stageWrites).toEqual([])
    expect(sent).toEqual([])
  })

  it('dueAt 为空的老单在 DB 侧就被排除', async () => {
    const { service, seen } = makeScan([])
    await service.scanSlaStages(now)
    expect(seen.ticketFindMany).toMatchObject({
      where: { status: { in: ['open', 'processing'] }, dueAt: { not: null } },
    })
  })

  it('取坐席名单失败只告警，绝不留下未处理的 Promise 拒绝', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const unhandled: unknown[] = []
    const onHide = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onHide)
    try {
      const { service } = makeScan(
        [
          {
            id: 't1',
            title: '超时单',
            priority: 'high',
            dueAt: new Date(now.getTime() - H),
            slaNotifyStage: null,
          },
        ],
        { failStaffLookup: true },
      )
      // 扫描照常返回：通知是旁路，不能因为它把主流程拖失败
      expect(await service.scanSlaStages(now)).toEqual({ atRisk: 0, breached: 1 })
      await flush()
      await flush()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('notify staff failed'))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onHide)
      warn.mockRestore()
    }
  })
})
