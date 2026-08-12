import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

// 内置预设提示词（启动时播种，不可删除）
export const PRESET_PROMPTS = [
  {
    name: 'Code Refactoring Expert',
    category: 'Engineering',
    description: 'Review code for performance, readability, and TypeScript best practices.',
    content:
      "You are an expert software engineer. Review the code the user shows for performance, readability, maintainability and best practices. Provide concrete, actionable and concise suggestions in the user's language.",
  },
  {
    name: 'Monorepo Architecture Planner',
    category: 'Architecture',
    description: 'Design scalable pnpm workspaces with NestJS backends and shared packages.',
    content:
      "You are a senior architect specialized in pnpm workspaces and Node.js monorepos. Help design scalable project structures, module boundaries and dependency policies. Answer in the user's language.",
  },
  {
    name: 'SQL & Prisma Query Optimizer',
    category: 'Database',
    description: 'Optimize sluggish MySQL queries and design efficient Prisma relations.',
    content:
      "You are a database performance expert for MySQL and Prisma ORM. Diagnose slow queries, suggest indexes, query shape changes and Prisma relation design, then explain trade-offs. Answer in the user's language.",
  },
]

@Injectable()
export class PromptsService {
  constructor(private prisma: PrismaService) {}

  // 首次启动播种内置预设（幂等）
  async seedPresets() {
    for (const p of PRESET_PROMPTS) {
      const exists = await this.prisma.prompt.findFirst({ where: { name: p.name, preset: true } })
      if (!exists) {
        await this.prisma.prompt.create({ data: { ...p, preset: true } })
      }
    }
  }

  // 内置预设 + 当前用户自定义的提示词
  async list(userId: string) {
    return this.prisma.prompt.findMany({
      where: { OR: [{ preset: true }, { createdBy: userId }] },
      orderBy: [{ preset: 'desc' }, { updatedAt: 'desc' }],
    })
  }

  async create(
    userId: string,
    data: { name: string; category: string; description?: string; content: string },
  ) {
    if (!data.name?.trim() || !data.content?.trim()) {
      throw new BadRequestException('名称和内容不能为空')
    }
    return this.prisma.prompt.create({
      data: {
        name: data.name.trim(),
        category: data.category?.trim() || '通用',
        description: data.description?.trim(),
        content: data.content.trim(),
        createdBy: userId,
      },
    })
  }

  async update(
    userId: string,
    id: string,
    data: { name?: string; category?: string; description?: string; content?: string },
  ) {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } })
    if (!prompt) throw new NotFoundException('提示词不存在')
    if (prompt.preset && prompt.createdBy !== userId) {
      throw new BadRequestException('内置预设不允许修改')
    }
    if (prompt.createdBy && prompt.createdBy !== userId) {
      throw new NotFoundException('提示词不存在')
    }
    return this.prisma.prompt.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        category: data.category?.trim(),
        description: data.description?.trim(),
        content: data.content?.trim(),
      },
    })
  }

  async remove(userId: string, id: string) {
    const prompt = await this.prisma.prompt.findUnique({ where: { id } })
    if (!prompt) throw new NotFoundException('提示词不存在')
    if (prompt.preset) throw new BadRequestException('内置预设不允许删除')
    if (prompt.createdBy !== userId) throw new NotFoundException('提示词不存在')
    await this.prisma.prompt.delete({ where: { id } })
    return { success: true }
  }
}
