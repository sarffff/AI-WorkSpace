import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

// 单分类事实上限，超出删除最旧（防无限增长）
const MAX_FACTS_PER_CATEGORY = 50

@Injectable()
export class MemoryService {
  constructor(private prisma: PrismaService) {}

  // 会话开始时注入的长期记忆（按更新时间取最新）
  async getUserMemory(userId: string, limit = 10): Promise<string[]> {
    const rows = await this.prisma.memory.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    })
    return rows.map((r) => r.content)
  }

  // 写入一条事实记忆：内容相同则仅刷新时间（天然去重）
  async remember(userId: string, category: string, content: string, chatId?: string) {
    const text = content.trim().slice(0, 255)
    if (!text) return
    await this.prisma.memory.upsert({
      where: { userId_category_content: { userId, category, content: text } },
      create: { userId, category, content: text, chatId },
      update: { updatedAt: new Date(), ...(chatId ? { chatId } : {}) },
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
