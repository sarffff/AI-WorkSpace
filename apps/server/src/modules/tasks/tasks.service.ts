import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import { SettingsService } from '@/modules/settings/settings.service'

interface PlannedStep {
  title: string
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name)

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private settingsService: SettingsService,
  ) {}

  private async createClient(): Promise<OpenAI> {
    const [apiUrl, apiKey] = await Promise.all([
      this.settingsService.get('LLM_API_URL'),
      this.settingsService.get('LLM_API_KEY'),
    ])
    return new OpenAI({
      baseURL:
        apiUrl ||
        this.configService.get<string>('LLM_API_URL') ||
        'https://open.bigmodel.cn/api/paas/v4/',
      apiKey: apiKey || this.configService.get<string>('LLM_API_KEY'),
    })
  }

  private async resolveModel(): Promise<string> {
    const configured = await this.settingsService.get('LLM_API_MODEL')
    return configured || this.configService.get<string>('LLM_API_MODEL') || 'glm-4.5-air'
  }

  async assertOwned(userId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } })
    if (!task || task.userId !== userId) throw new NotFoundException('任务不存在')
    return task
  }

  async list(userId: string) {
    const tasks = await this.prisma.task.findMany({
      where: { userId },
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    })
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      error: t.error,
      steps: t.steps.map((s) => ({
        id: s.id,
        order: s.order,
        title: s.title,
        status: s.status,
        output: s.output?.slice(0, 160) || '',
        error: s.error,
      })),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
  }

  async get(userId: string, taskId: string) {
    await this.assertOwned(userId, taskId)
    return this.prisma.task.findUnique({
      where: { id: taskId },
      include: { steps: { orderBy: { order: 'asc' } } },
    })
  }

  async remove(userId: string, taskId: string) {
    await this.assertOwned(userId, taskId)
    await this.prisma.task.delete({ where: { id: taskId } })
    return { success: true }
  }

  // 创建任务并让模型拆解执行计划（不立即执行）
  async create(userId: string, prompt: string) {
    if (!prompt?.trim()) throw new BadRequestException('任务描述不能为空')
    const client = await this.createClient()
    const model = await this.resolveModel()

    const task = await this.prisma.task.create({
      data: {
        title: prompt.trim().slice(0, 50),
        prompt: prompt.trim(),
        userId,
        status: 'queued',
      },
    })

    try {
      const plan = await client.chat.completions.create({
        model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              '你是任务规划器。将用户的任务拆解为 3~6 个可执行的步骤，每个步骤应相互衔接、可独立完成。' +
              '只输出 JSON 数组，不要输出任何其他文字，格式：[{"title": "步骤描述"}]',
          },
          { role: 'user', content: prompt },
        ],
      })
      const raw = plan.choices[0]?.message?.content || '[]'
      const steps: PlannedStep[] = this.parseSteps(raw)
      await this.prisma.taskStep.createMany({
        data: steps.map((s, i) => ({
          taskId: task.id,
          order: i,
          title: s.title.slice(0, 200),
          status: 'pending',
        })),
      })
      this.logger.log(`[task] create ${task.id}: ${steps.length} steps`)
    } catch (err) {
      this.logger.error(`[task] plan failed for ${task.id}: ${err.message}`)
      await this.prisma.taskStep.create({
        data: { taskId: task.id, order: 0, title: '执行整个任务', status: 'pending' },
      })
    }

    return this.get(userId, task.id)
  }

  // 逐步骤执行（每步基于前序结果），失败不中断后续步骤
  async run(userId: string, taskId: string) {
    const task = await this.assertOwned(userId, taskId)
    if (task.status !== 'queued' && task.status !== 'failed') {
      throw new BadRequestException('任务已在执行或已完成，无法重复启动')
    }

    const client = await this.createClient()
    const model = await this.resolveModel()
    const steps = await this.prisma.taskStep.findMany({
      where: { taskId },
      orderBy: { order: 'asc' },
    })

    await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'running', error: null },
    })

    const context: string[] = []
    for (const step of steps) {
      await this.prisma.taskStep.update({ where: { id: step.id }, data: { status: 'running' } })
      try {
        const res = await client.chat.completions.create({
          model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                '你是任务执行器，严格执行给定的当前步骤，输出可直接使用的结论。' +
                '若提供了之前的执行结果，请结合它们，不要重复已完成的工作。',
            },
            ...context.map((part) => ({ role: 'assistant' as const, content: part })),
            {
              role: 'user',
              content: `当前步骤：${step.title}\n（步骤 ${step.order + 1}/${steps.length}）`,
            },
          ],
        })
        const output = res.choices[0]?.message?.content || '（无输出）'
        await this.prisma.taskStep.update({
          where: { id: step.id },
          data: { status: 'succeeded', output },
        })
        context.push(`【已完成：${step.title}】\n${output}`)
        this.logger.log(`[task] step ${step.order + 1} done len=${output.length}`)
      } catch (err) {
        this.logger.error(`[task] step ${step.order + 1} failed: ${err.message}`)
        await this.prisma.taskStep.update({
          where: { id: step.id },
          data: { status: 'failed', error: err.message },
        })
        context.push(`【步骤失败：${step.title}】\n${err.message}`)
      }
    }

    const failed = (await this.prisma.taskStep.findMany({ where: { taskId } })).filter(
      (s) => s.status === 'failed',
    )
    const done = failed.length === 0
    const result = context.map((c, i) => `--- 步骤 ${i + 1} ---\n${c}`).join('\n\n')

    await this.prisma.task.update({
      where: { id: taskId },
      data: {
        status: done ? 'succeeded' : 'failed',
        result,
        error: done ? null : `有 ${failed.length} 个步骤执行失败`,
      },
    })
    return this.get(userId, taskId)
  }

  private parseSteps(raw: string): PlannedStep[] {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return [{ title: '完成整个任务' }]
    try {
      const parsed = JSON.parse(match[0])
      if (!Array.isArray(parsed)) return [{ title: '完成整个任务' }]
      const steps = parsed
        .map((p) => ({ title: String(p?.title ?? '').trim() }))
        .filter((s) => s.title.length > 0)
        .slice(0, 6)
      return steps.length > 0 ? steps : [{ title: '完成整个任务' }]
    } catch {
      return [{ title: '完成整个任务' }]
    }
  }
}
