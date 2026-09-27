import { ForbiddenException } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import { TicketsService } from './tickets.service'

// 只测「DB 行 → 纯函数输入」这层装配，判据本身由 dispatch-preview.spec.ts 钉。
// 装配能错的三处：时间窗把未完结的老单切掉、status→resolvedAt 折算错、转派事件文案与
// 查询前缀漂移。所以断言既看查询条件，也看跑出来的建议 —— 折算错了建议就会翻转。

const DAY = 86_400_000
const D = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY)

const staff = { role: 'agent' }

interface UserRow {
  id: string
  name: string | null
  email: string
  department: string | null
}

interface TicketRow {
  id: string
  title: string
  category: string
  priority: string
  status: string
  createdAt: Date
  updatedAt: Date
  assigneeId: string | null
  creator: { department: string | null }
}

function makeService(fx: {
  users?: UserRow[]
  tickets?: TicketRow[]
  reassigns?: { ticketId: string }[]
}) {
  const seen: Record<string, unknown> = {}
  const prisma = {
    user: {
      findMany: async (args: unknown) => {
        seen.userFindMany = args
        return fx.users ?? []
      },
    },
    ticket: {
      findMany: async (args: unknown) => {
        seen.ticketFindMany = args
        return fx.tickets ?? []
      },
    },
    ticketComment: {
      findMany: async (args: unknown) => {
        seen.commentFindMany = args
        return fx.reassigns ?? []
      },
    },
  }
  return { service: new TicketsService(prisma as unknown as PrismaService), seen }
}

const agentRow = (id: string, over: Partial<UserRow> = {}): UserRow => ({
  id,
  name: `${id} 坐席`,
  email: `${id}@corp.com`,
  department: null,
  ...over,
})

const AGENTS = [agentRow('a1'), agentRow('a2')]

function trow(id: string, over: Partial<TicketRow> = {}): TicketRow {
  return {
    id,
    title: `工单 ${id}`,
    category: 'network',
    priority: 'normal',
    status: 'resolved',
    createdAt: D(-20),
    updatedAt: D(-15),
    assigneeId: 'a1',
    creator: { department: null },
    ...over,
  }
}

/** 没人接的单 */
const pending = (id: string, over: Partial<TicketRow> = {}): TicketRow =>
  trow(id, { status: 'open', assigneeId: null, updatedAt: D(-1), ...over })

/** 某坐席在该分类已完结 n 单 */
function history(agentId: string, n: number): TicketRow[] {
  return Array.from({ length: n }, (_, i) =>
    trow(`${agentId}-done-${i}`, {
      assigneeId: agentId,
      createdAt: D(-30 + i),
      updatedAt: D(-25 + i),
      status: 'resolved',
    }),
  )
}

describe('TicketsService.dispatchPreview 装配', () => {
  it('员工不可见', async () => {
    const { service } = makeService({})
    await expect(service.dispatchPreview({ role: 'employee' })).rejects.toThrow(ForbiddenException)
    await expect(service.dispatchBacktest({ role: 'employee' })).rejects.toThrow(ForbiddenException)
  })

  it('花名册只取坐席/管理员，没名字的用邮箱顶上', async () => {
    const { service, seen } = makeService({
      users: [agentRow('a1', { name: null })],
      tickets: [pending('t1')],
    })
    const res = await service.dispatchPreview(staff)
    expect((seen.userFindMany as { where: { role: { in: string[] } } }).where.role.in).toEqual([
      'agent',
      'admin',
    ])
    expect(res.roster).toEqual([{ id: 'a1', name: 'a1@corp.com', department: null }])
  })

  it('时间窗带上仍未完结的老单，否则压着老单的坐席算出来最闲', async () => {
    const { service, seen } = makeService({ users: AGENTS })
    await service.dispatchPreview(staff, 90)
    const where = (seen.ticketFindMany as { where: { OR: Array<Record<string, unknown>> } }).where
    expect(where.OR).toEqual([
      { createdAt: { gte: expect.any(Date) } },
      { status: { in: ['open', 'processing'] } },
    ])
  })

  it('days 钳到 365 天，非法值退回 90 天', async () => {
    const { service, seen } = makeService({ users: AGENTS })
    await service.dispatchPreview(staff, 99_999)
    const gteOf = () =>
      (
        (seen.ticketFindMany as { where: { OR: [{ createdAt: { gte: Date } }] } }).where.OR[0]
          .createdAt as { gte: Date }
      ).gte.getTime()
    expect(Date.now() - gteOf()).toBeGreaterThanOrEqual(364 * DAY)

    await service.dispatchPreview(staff, Number.NaN)
    expect(Date.now() - gteOf()).toBeLessThanOrEqual(91 * DAY)
  })

  it('未完结的单不作分类证据：只有 open 记录的坐席拿不到建议', async () => {
    const { service } = makeService({
      users: AGENTS,
      tickets: [
        trow('stale', { status: 'processing', assigneeId: 'a1', updatedAt: D(-2) }),
        trow('stale2', { status: 'open', assigneeId: 'a1', updatedAt: D(-2) }),
        pending('t1'),
      ],
    })
    const res = await service.dispatchPreview(staff)
    expect(res.pending[0]).toMatchObject({ ticketId: 't1', basis: 'no_signal', assigneeId: null })
  })

  it('已完结记录折成 resolvedAt 后成为证据，指向做过该分类的坐席', async () => {
    const { service } = makeService({
      users: AGENTS,
      tickets: [...history('a1', 2), ...history('a2', 1), pending('t1')],
    })
    const res = await service.dispatchPreview(staff)
    expect(res.pending[0]).toMatchObject({
      assigneeId: 'a1',
      basis: 'category_affinity',
      evidence: 2,
      autoDispatchable: true,
    })
    expect(res.noRoster).toBe(false)
  })

  it('证据并列时在办负载少的优先，未完结老单也计入负载', async () => {
    const { service } = makeService({
      users: AGENTS,
      tickets: [
        ...history('a1', 2),
        ...history('a2', 2),
        // a1 手上挂着一张三个月前至今未完结的单
        trow('old-open', {
          assigneeId: 'a1',
          status: 'open',
          createdAt: D(-90),
          updatedAt: D(-80),
        }),
        pending('t1'),
      ],
    })
    const res = await service.dispatchPreview(staff)
    expect(res.pending[0].assigneeId).toBe('a2')
    expect(res.pending[0].candidates.map((c) => [c.agentId, c.inFlight])).toEqual([
      ['a2', 0],
      ['a1', 1],
    ])
  })

  it('limit 只截清单，总数与可自动派条数按全量算', async () => {
    const { service } = makeService({
      users: AGENTS,
      tickets: [...history('a1', 3), pending('t1'), pending('t2')],
    })
    const capped = await service.dispatchPreview(staff, 90, 1)
    expect(capped.pending).toHaveLength(1)
    expect(capped.pendingTotal).toBe(2)
    expect(capped.autoDispatchable).toBe(2)

    const bogus = await service.dispatchPreview(staff, 90, 0)
    expect(bogus.pending).toHaveLength(2) // limit=0 退回默认值，不是"清空清单"
  })

  it('minEvidence 与 maxLoad 是调用方可调的旋钮，不写死在代码里', async () => {
    const { service } = makeService({
      users: AGENTS,
      tickets: [
        ...history('a1', 1),
        trow('busy', { assigneeId: 'a1', status: 'open', createdAt: D(-5), updatedAt: D(-5) }),
        pending('t1'),
      ],
    })
    expect((await service.dispatchPreview(staff)).autoDispatchable).toBe(0)
    expect(
      (await service.dispatchPreview(staff, 90, 50, { minEvidence: 1 })).autoDispatchable,
    ).toBe(1)

    const saturated = await service.dispatchPreview(staff, 90, 50, { minEvidence: 1, maxLoad: 0 })
    // 唯一有证据的坐席已到饱和线：依据仍在，但这次没有人可派
    expect(saturated.pending[0]).toMatchObject({
      basis: 'category_affinity',
      assigneeId: null,
      blockedByLoad: true,
    })
  })
})

describe('TicketsService.dispatchBacktest 装配', () => {
  it('按时间线的转派事件认出"首次派单错了"，猜中最终受理人算省掉一次转派', async () => {
    const { service, seen } = makeService({
      users: AGENTS,
      tickets: [
        ...history('a1', 3),
        trow('x1', { assigneeId: 'a1', createdAt: D(-10), updatedAt: D(-9) }),
        trow('x2', { assigneeId: 'a1', createdAt: D(-8), updatedAt: D(-7) }),
      ],
      reassigns: [{ ticketId: 'x2' }],
    })
    const res = await service.dispatchBacktest(staff)
    const where = (seen.commentFindMany as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({
      kind: 'system',
      content: { startsWith: '转派给' },
      ticketId: { in: ['a1-done-0', 'a1-done-1', 'a1-done-2', 'x1', 'x2'] },
    })
    expect(res.reassigned).toBe(1)
    expect(res.wouldSaveReassignment).toBe(1)
    expect(res.decisions.find((d) => d.ticketId === 'x2')).toMatchObject({
      reassigned: true,
      hit: true,
    })
  })

  it('没有已派单时不去查时间线', async () => {
    const { service, seen } = makeService({ users: AGENTS, tickets: [pending('t1')] })
    const res = await service.dispatchBacktest(staff)
    expect(seen.commentFindMany).toBeUndefined()
    expect(res.evaluated).toBe(0)
    expect(res.ceilingAccuracy).toBeNull()
  })

  it('转派事件的文案与回测查询的前缀同源，改一边就会红', async () => {
    const events: string[] = []
    const seen: Record<string, unknown> = {}
    const prisma = {
      user: {
        findMany: async () => AGENTS,
        findUnique: async () => ({ name: '张三', email: 'z@corp.com' }),
      },
      ticket: {
        findMany: async (a: unknown) => {
          seen.ticketFindMany = a
          return [...history('a1', 2), trow('x1', { createdAt: D(-10), updatedAt: D(-9) })]
        },
        findUnique: async () => ({
          id: 'x1',
          creatorId: 'u9',
          status: 'open',
          assigneeId: 'a1',
          priority: 'normal',
          category: 'network',
        }),
        update: async (a: { data: Record<string, unknown> }) => ({
          id: 'x1',
          creator: {},
          assignee: {},
          ...a.data,
        }),
      },
      ticketComment: {
        create: async (a: { data: { content: string } }) => {
          events.push(a.data.content)
          return a.data
        },
        findMany: async (a: { where: { content: { startsWith: string } } }) => {
          seen.commentWhere = a.where
          return []
        },
      },
    }
    const service = new TicketsService(prisma as unknown as PrismaService)

    await service.update({ id: 'a2', role: 'agent' }, 'x1', { assigneeId: 'a2' })
    const written = events.find((e) => e.includes('张三'))
    expect(written).toBeDefined()

    await service.dispatchBacktest(staff)
    const prefix = (seen.commentWhere as { content: { startsWith: string } }).content.startsWith
    // 回测靠这个前缀认出"第一次派错了"；文案一改它就静默失效，所以在这儿钉住
    expect(written?.startsWith(prefix)).toBe(true)
  })

  it('分类分布与天花板按真值给出，other 单标成不可路由', async () => {
    const { service } = makeService({
      users: AGENTS,
      tickets: [
        ...history('a1', 2),
        trow('o1', { category: 'other', assigneeId: 'a2', createdAt: D(-10), updatedAt: D(-9) }),
      ],
    })
    const res = await service.dispatchBacktest(staff)
    expect(res.unroutable).toBe(1)
    expect(res.byCategory).toEqual([
      expect.objectContaining({ category: 'network', ceiling: 1 }),
      expect.objectContaining({ category: 'other', ceiling: 1 }),
    ])
    expect(res.decisions.find((d) => d.ticketId === 'o1')?.basis).toBe('unroutable_category')
  })
})
