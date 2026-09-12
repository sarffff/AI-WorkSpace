import type { PrismaService } from '@/prisma/prisma.service'
import type { EmbeddingsClient } from '@/common/embeddings'
import { MemoryService } from './memory.service'

// 行为依据（与实现一致）：
// - remember：content trim + 截断 255；userId+category+content 唯一键走 upsert（天然去重）；
//   embedding 未配置/失败时存 null 且不阻塞写入；每类超过 50 条按 updatedAt 升序删除最旧
// - getUserMemory：无 query 或 embedding 不可用 → 按 updatedAt 倒序取最近 limit 条；
//   有 query 且向量可用 → 有向量的记忆按余弦排序取 Top-K，无向量的按 updatedAt 倒序补足至 limit

function makeService() {
  const prisma = {
    memory: {
      upsert: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  }
  const embeddings = { get: jest.fn().mockReturnValue(null) }
  const service = new MemoryService(
    prisma as unknown as PrismaService,
    embeddings as unknown as EmbeddingsClient,
  )
  return { service, prisma, embeddings }
}

describe('MemoryService.remember', () => {
  it('同 userId+category+content 走 upsert 去重（不新增、仅刷新时间）', async () => {
    const { service, prisma } = makeService()

    await service.remember('u1', 'fact', ' 喜欢喝咖啡 ', 'c1')
    await service.remember('u1', 'fact', '喜欢喝咖啡', 'c2')

    expect(prisma.memory.upsert).toHaveBeenCalledTimes(2)
    const [first, second] = prisma.memory.upsert.mock.calls
    // 两次调用命中同一唯一键 → 内容相同不会产生重复记录
    expect(second[0].where).toEqual({
      userId_category_content: { userId: 'u1', category: 'fact', content: '喜欢喝咖啡' },
    })
    expect(first[0].where).toEqual(second[0].where)
    // 写入内容 trim 后入库，update 侧刷新 updatedAt
    expect(first[0].create).toEqual({
      userId: 'u1',
      category: 'fact',
      content: '喜欢喝咖啡',
      chatId: 'c1',
    })
    expect(first[0].update.updatedAt).toBeInstanceOf(Date)
  })

  it('内容超过 255 字截断后写入', async () => {
    const { service, prisma } = makeService()
    const long = 'x'.repeat(300)

    await service.remember('u1', 'fact', long)

    const arg = prisma.memory.upsert.mock.calls[0][0]
    expect(arg.create.content).toHaveLength(255)
    expect(arg.create.content).toBe(long.slice(0, 255))
  })

  it('空白内容直接返回，不写库', async () => {
    const { service, prisma } = makeService()

    await service.remember('u1', 'fact', '   ')

    expect(prisma.memory.upsert).not.toHaveBeenCalled()
  })

  it('embedding 可用时随写入计算向量', async () => {
    const { service, prisma, embeddings } = makeService()
    const embedQuery = jest.fn().mockResolvedValue([0.1, 0.2, 0.3])
    embeddings.get.mockReturnValue({ embedQuery })

    await service.remember('u1', 'fact', '喜欢喝咖啡')

    expect(embedQuery).toHaveBeenCalledWith('喜欢喝咖啡')
    expect(prisma.memory.upsert.mock.calls[0][0].create.embedding).toEqual([0.1, 0.2, 0.3])
  })

  it('embedding 调用失败不阻塞写入（存 null）', async () => {
    const { service, prisma, embeddings } = makeService()
    embeddings.get.mockReturnValue({
      embedQuery: jest.fn().mockRejectedValue(new Error('网络错误')),
    })

    await service.remember('u1', 'fact', '喜欢喝咖啡')

    expect(prisma.memory.upsert).toHaveBeenCalled()
    expect(prisma.memory.upsert.mock.calls[0][0].create.embedding).toBeUndefined()
  })

  it('单类超过 50 条时按更新时间删除最旧的多余条目', async () => {
    const { service, prisma } = makeService()
    prisma.memory.count.mockResolvedValue(51)
    prisma.memory.findMany.mockResolvedValue([{ id: 'oldest-id' }])

    await service.remember('u1', 'fact', '新记忆')

    expect(prisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', category: 'fact' },
        orderBy: { updatedAt: 'asc' },
        take: 1, // 51 - 50
      }),
    )
    expect(prisma.memory.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['oldest-id'] } } })
  })
})

describe('MemoryService.getUserMemory', () => {
  it('无 query 时按 updatedAt 倒序取最近 limit 条', async () => {
    const { service, prisma } = makeService()
    prisma.memory.findMany.mockResolvedValue([{ content: '记忆A' }, { content: '记忆B' }])

    const result = await service.getUserMemory('u1', undefined, 10)

    expect(prisma.memory.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    })
    expect(result).toEqual(['记忆A', '记忆B'])
  })

  it('有 query 但 embedding 未配置 → 回退按更新时间召回', async () => {
    const { service, prisma, embeddings } = makeService()
    embeddings.get.mockReturnValue(null)
    prisma.memory.findMany.mockResolvedValue([{ content: '记忆A' }])

    const result = await service.getUserMemory('u1', 'VPN 怎么连')

    expect(prisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { updatedAt: 'desc' } }),
    )
    expect(result).toEqual(['记忆A'])
  })

  it('有 query 时按余弦相似度排序，无向量的记忆按 updatedAt 补足', async () => {
    const { service, prisma, embeddings } = makeService()
    embeddings.get.mockReturnValue({ embedQuery: jest.fn().mockResolvedValue([1, 0]) })
    const newer = new Date('2026-08-30T00:00:00.000Z')
    const older = new Date('2026-08-01T00:00:00.000Z')
    prisma.memory.findMany.mockResolvedValue([
      { content: '打印机维修', embedding: [0, 1], updatedAt: older },
      { content: 'VPN 设置', embedding: [1, 0], updatedAt: older },
      { content: '坏向量记录', embedding: 'xx', updatedAt: newer },
      { content: '老偏好', embedding: null, updatedAt: older },
    ])

    // limit=3：Top-K 语义命中先排，无向量按 updatedAt 倒序补足
    const top3 = await service.getUserMemory('u1', 'VPN 怎么连', 3)
    expect(top3).toEqual(['VPN 设置', '打印机维修', '坏向量记录'])

    // limit 足够大时全量返回（语义命中在前，无向量兜底在后）
    const all = await service.getUserMemory('u1', 'VPN 怎么连', 10)
    expect(all).toEqual(['VPN 设置', '打印机维修', '坏向量记录', '老偏好'])

    // 语义召回路径按 userId 全量加载（含 embedding 列）
    expect(prisma.memory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        select: { content: true, embedding: true, updatedAt: true },
      }),
    )
  })

  it('embedQuery 抛错 → 回退按更新时间召回', async () => {
    const { service, prisma, embeddings } = makeService()
    embeddings.get.mockReturnValue({
      embedQuery: jest.fn().mockRejectedValue(new Error('网络错误')),
    })
    prisma.memory.findMany.mockResolvedValue([{ content: '记忆A' }])

    const result = await service.getUserMemory('u1', 'VPN 怎么连')

    expect(result).toEqual(['记忆A'])
  })
})
