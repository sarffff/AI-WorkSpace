import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { EmbeddingsClient, cosineSimilarity } from '@/common/embeddings'
import type { Prisma } from '@prisma/client'

// 单分类事实上限，超出删除最旧（防无限增长）
const MAX_FACTS_PER_CATEGORY = 50

// Json 列中的向量取出：非数字数组/空数组视为无效，按无 embedding 处理
function asVector(v: Prisma.JsonValue | null): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v.every((n) => typeof n === 'number') ? (v as number[]) : null
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name)

  constructor(
    private prisma: PrismaService,
    private embeddingsClient: EmbeddingsClient,
  ) {}

  // 计算 content 的向量；embedding 未配置/调用失败返回 null（不阻塞写入、不抛错）
  private async embedContent(content: string): Promise<number[] | null> {
    const client = this.embeddingsClient.get()
    if (!client) {
      this.logger.warn('embedding 未配置，记忆写入跳过向量化')
      return null
    }
    try {
      return await client.embedQuery(content)
    } catch (err) {
      this.logger.warn(
        `memory embedding failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  // 按更新时间取最新 limit 条（query 语义召回不可用时的整体回退）
  private async getRecentMemory(userId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    return rows.map((r) => r.content)
  }

  // 会话开始时注入的长期记忆。
  // query 非空且 embedding 可用时按语义召回：有向量的记忆按余弦相似度取 Top-K，
  // 无向量的记忆按 updatedAt 兜底补足至 limit；embedding 不可用时整体回退
  // 按更新时间取最近。返回形状仍为 content 数组，调用方无感。
  async getUserMemory(userId: string, query?: string, limit = 10): Promise<string[]> {
    const trimmed = query?.trim()
    if (!trimmed) return this.getRecentMemory(userId, limit)

    const client = this.embeddingsClient.get()
    if (!client) {
      this.logger.warn('embedding 未配置，长期记忆回退按更新时间召回')
      return this.getRecentMemory(userId, limit)
    }

    let queryVector: number[] | null = null
    try {
      queryVector = await client.embedQuery(trimmed)
    } catch (err) {
      this.logger.warn(
        `memory query embedding failed: ${err instanceof Error ? err.message : String(err)}，回退按更新时间召回`,
      )
    }
    if (!queryVector) return this.getRecentMemory(userId, limit)

    // 用户记忆总量受每类上限约束（≤150 条），全量加载后内存排序即可
    const all = await this.prisma.memory.findMany({
      where: { userId },
      select: { content: true, embedding: true, updatedAt: true },
    })
    const scored: { content: string; score: number }[] = []
    const unembedded: { content: string; updatedAt: Date }[] = []
    for (const m of all) {
      const vector = asVector(m.embedding)
      if (vector) {
        scored.push({ content: m.content, score: cosineSimilarity(queryVector, vector) })
      } else {
        unembedded.push({ content: m.content, updatedAt: m.updatedAt })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    unembedded.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())

    const contents = scored.slice(0, limit).map((x) => x.content)
    // 无向量的记忆按更新时间兜底补足至 limit
    const rest = limit - contents.length
    if (rest > 0) {
      contents.push(...unembedded.slice(0, rest).map((x) => x.content))
    }
    return contents
  }

  // 写入一条事实记忆：内容相同则仅刷新时间（天然去重）；顺带计算内容向量
  // （embedding 不可用/失败存 null，不阻塞写入、不抛错）
  async remember(userId: string, category: string, content: string, chatId?: string) {
    const text = content.trim().slice(0, 255)
    if (!text) return
    const embedding = await this.embedContent(text)
    await this.prisma.memory.upsert({
      where: { userId_category_content: { userId, category, content: text } },
      create: { userId, category, content: text, chatId, ...(embedding ? { embedding } : {}) },
      update: {
        updatedAt: new Date(),
        ...(chatId ? { chatId } : {}),
        // 仅在向量计算成功时更新，避免一次失败抹掉已有向量
        ...(embedding ? { embedding } : {}),
      },
    })
    // 上限裁剪：删除最旧的多余条目
    const count = await this.prisma.memory.count({ where: { userId, category } })
    if (count > MAX_FACTS_PER_CATEGORY) {
      const overflow = await this.prisma.memory.findMany({
        where: { userId, category },
        orderBy: { updatedAt: 'asc' },
        take: count - MAX_FACTS_PER_CATEGORY,
        select: { id: true },
      })
      await this.prisma.memory.deleteMany({
        where: { id: { in: overflow.map((o) => o.id) } },
      })
    }
  }

  // 删除某条记忆（按 userId + 内容）
  async forget(userId: string, content: string) {
    await this.prisma.memory.deleteMany({ where: { userId, content } })
  }
}
