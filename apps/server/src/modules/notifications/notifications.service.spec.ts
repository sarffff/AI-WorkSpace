import { Logger, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import { NotificationsService } from './notifications.service'

// 行为依据（与实现一致）：
// - send 是旁路：目标去重、空 id 过滤、空列表不查库；body 截到 500（列宽）；
//   createMany 失败只告警，绝不把调用方（建单/改状态）拖失败
// - list 一次拿回 items + unreadCount，limit 钳在 1..100
// - markRead 用带 userId 的 updateMany：别人的通知改不到，改不到就 404

interface Fixture {
  items?: unknown[]
  unread?: number
  updateCount?: number
  failCreate?: boolean
}

function make(fx: Fixture = {}) {
  const seen: Record<string, unknown> = {}
  const prisma = {
    notification: {
      createMany: async (a: { data: unknown[] }) => {
        if (fx.failCreate) throw new Error('db down')
        seen.createMany = a.data
        return { count: a.data.length }
      },
      findMany: async (a: unknown) => {
        seen.findMany = a
        return fx.items ?? []
      },
      count: async (a: unknown) => {
        seen.count = a
        return fx.unread ?? 0
      },
      updateMany: async (a: unknown) => {
        seen.updateMany = a
        return { count: fx.updateCount ?? 1 }
      },
    },
  }
  return { service: new NotificationsService(prisma as unknown as PrismaService), seen }
}

describe('NotificationsService.send', () => {
  it('去重、过滤空 id，按人各写一条', async () => {
    const { service, seen } = make()
    await service.send(['a', 'a', '', 'b'], { type: 'ticket_created', title: 't', body: 'b' })
    expect(seen.createMany).toMatchObject([
      { userId: 'a', type: 'ticket_created' },
      { userId: 'b', type: 'ticket_created' },
    ])
  })

  it('没有目标时不碰数据库', async () => {
    const { service, seen } = make()
    await service.send([], { type: 'x', title: 't', body: 'b' })
    expect(seen.createMany).toBeUndefined()
  })

  it('body 超出列宽就截断', async () => {
    const { service, seen } = make()
    await service.send(['a'], { type: 'x', title: 't', body: 'y'.repeat(600) })
    expect((seen.createMany as Array<{ body: string }>)[0].body).toHaveLength(500)
  })

  it('写库失败只告警：通知不能反过来让建单失败', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { service } = make({ failCreate: true })
    await expect(service.send(['a'], { type: 'x', title: 't', body: 'b' })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('send notification failed'))
    warn.mockRestore()
  })
})

describe('NotificationsService 读取与已读', () => {
  it('一次返回条目与未读数，limit 越界被钳住', async () => {
    const { service, seen } = make({ items: [{ id: 'n1' }], unread: 3 })
    const res = await service.list('u1', 5000)
    expect(res).toEqual({ items: [{ id: 'n1' }], unreadCount: 3 })
    expect((seen.findMany as { take: number }).take).toBe(100)
    expect(seen.count).toMatchObject({ where: { userId: 'u1', read: false } })
  })

  it('只列自己的通知', async () => {
    const { service, seen } = make()
    await service.list('u1')
    expect((seen.findMany as { where: { userId: string } }).where.userId).toBe('u1')
  })

  it('标记别人的通知为已读会失败（条件里带 userId）', async () => {
    const { service, seen } = make({ updateCount: 0 })
    await expect(service.markRead('u1', 'n-x')).rejects.toThrow(NotFoundException)
    expect(seen.updateMany).toMatchObject({ where: { id: 'n-x', userId: 'u1' } })
  })

  it('全部已读返回实际更新条数', async () => {
    const { service, seen } = make({ updateCount: 7 })
    expect(await service.markAllRead('u1')).toEqual({ updated: 7 })
    expect(seen.updateMany).toMatchObject({ where: { userId: 'u1', read: false } })
  })
})
