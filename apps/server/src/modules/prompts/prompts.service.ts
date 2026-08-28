import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { SavePromptDto } from './prompts.dto'

// 新用户首次访问时初始化的预设提示词
const SEED_PROMPTS: Array<{ title: string; content: string; category: string }> = [
  {
    title: '代码重构专家',
    category: '工程',
    content:
      '你是一位资深代码重构专家。请审查我提供的代码，从性能、可读性与 TypeScript 最佳实践三个维度分析问题，并给出可落地的重构步骤与示例代码。',
  },
  {
    title: 'Monorepo 架构规划师',
    category: '架构',
    content:
      '你是一位前端工程化架构师，精通 pnpm workspace 与 Turborepo。请帮我设计可扩展的 Monorepo 分层结构，包括包依赖关系、构建任务编排与共享配置方案。',
  },
  {
    title: 'SQL & Prisma 查询优化器',
    category: '数据库',
    content:
      '你是一位数据库性能专家，精通 MySQL 与 Prisma ORM。请分析我的慢查询，指出索引与数据建模问题，并给出优化后的 SQL / Prisma 查询写法。',
  },
]

@Injectable()
export class PromptsService {
  constructor(private prisma: PrismaService) {}

  // 列出当前用户的提示词；首次使用（空库）时自动初始化预设
  async list(userId: string) {
    let prompts = await this.prisma.prompt.findMany({
      where: { userId },
      orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
    })
    if (prompts.length === 0) {
      await this.prisma.prompt.createMany({
        data: SEED_PROMPTS.map((p) => ({ ...p, userId })),
      })
      prompts = await this.prisma.prompt.findMany({
        where: { userId },
        orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
      })
    }
    return prompts
  }

  async create(userId: string, dto: SavePromptDto) {
    return this.prisma.prompt.create({
      data: {
        userId,
        title: dto.title,
        content: dto.content,
        category: dto.category?.trim() || '通用',
      },
    })
  }

  // 更新（仅限本人）
  async update(userId: string, id: string, dto: SavePromptDto) {
    const existing = await this.prisma.prompt.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('提示词不存在')
    return this.prisma.prompt.update({
      where: { id },
      data: {
        title: dto.title,
        content: dto.content,
        category: dto.category?.trim() || '通用',
      },
    })
  }

  // 删除（仅限本人）
  async remove(userId: string, id: string) {
    const existing = await this.prisma.prompt.findFirst({ where: { id, userId } })
    if (!existing) throw new NotFoundException('提示词不存在')
    await this.prisma.prompt.delete({ where: { id } })
    return { success: true }
  }
}
