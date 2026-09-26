import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'
import {
  BUILTIN_PERSONA_VERSION,
  DEFAULT_AGENT_PERSONA,
  nextPersonaVersion,
  validatePersonaDraft,
  type ActivePersona,
} from './agent-persona'

// ===== Agent 人设的版本存储与读取 =====
//
// 读路径按「进程内缓存一份 active」处理：这段文本每次提问都要进 messages，
// 不该每问一次打一次库。失效只发生在 publish，所以不需要 TTL —— 发布即清缓存。
//
// 兜底原则：提示词存储读不到时退回内置副本并告警，而不是让助手停摆。
// 但绝不能静默兜底（否则版本化形同虚设），因此回退路径会把 version 标成 0，
// AgentRun 里看到 personaVersion=0 就等于"这条回答用的不是库里的版本"。

@Injectable()
export class AgentPersonaService implements OnModuleInit {
  private readonly logger = new Logger(AgentPersonaService.name)
  private cached: ActivePersona | null = null
  private warnedFallback = false

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureSeeded()
  }

  /** 当前生效人设；库不可用时回退内置副本（version=0） */
  async active(): Promise<ActivePersona> {
    if (this.cached) return this.cached
    try {
      const row = await this.prisma.agentPersona.findFirst({
        where: { status: 'active' },
        orderBy: { version: 'desc' },
        select: { version: true, content: true },
      })
      if (row) {
        this.cached = { version: row.version, content: row.content }
        return this.cached
      }
      // active 记录被手工改没了：按内置版本补一条 v1，保持可归因
      const seeded = await this.seed(DEFAULT_AGENT_PERSONA, '内置人设（补种）')
      this.cached = seeded
      return seeded
    } catch (err) {
      if (!this.warnedFallback) {
        this.warnedFallback = true
        this.logger.error(
          '读取生效提示词失败，已回退内置副本（AgentRun.personaVersion 将记为 0）：' +
            (err instanceof Error ? err.message : String(err)),
        )
      }
      return { version: BUILTIN_PERSONA_VERSION, content: DEFAULT_AGENT_PERSONA }
    }
  }

  /** 首启播种：空表时把内置人设写成 v1 并置 active */
  async ensureSeeded(): Promise<void> {
    try {
      const count = await this.prisma.agentPersona.count()
      if (count > 0) return
      await this.seed(DEFAULT_AGENT_PERSONA, '内置人设（迁移自代码常量）')
    } catch (err) {
      // 播种失败不阻塞启动：active() 有内置兜底
      this.logger.warn(
        `提示词播种失败（将使用内置副本）：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * 发布新版本并置为生效。事务内先归档旧的再写新的 —— 中间失败留下 0 条或 2 条
   * active 都会让"当前生效是哪版"变成不确定的。
   */
  async publish(
    actor: { id: string; role: string },
    input: { content?: unknown; note?: unknown },
  ): Promise<{ version: number; note: string | null }> {
    this.assertAdmin(actor)
    const draft = validatePersonaDraft(input)
    if (!draft.ok) throw new BadRequestException(draft.error)

    const existing = await this.prisma.agentPersona.findMany({ select: { version: true } })
    const version = nextPersonaVersion(existing.map((r) => r.version))

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.agentPersona.updateMany({
        where: { status: 'active' },
        data: { status: 'archived' },
      })
      await tx.agentPersona.create({
        data: {
          version,
          content: draft.content,
          note: draft.note,
          status: 'active',
          createdBy: actor.id,
        },
      })
    })

    this.cached = null // 下一次读取重新取 active
    this.warnedFallback = false
    this.logger.log(
      `agent persona v${version} published by ${actor.id}: ${draft.note ?? '(无说明)'}`,
    )
    return { version, note: draft.note }
  }

  /** 版本历史（最近 20 版，含正文供 diff） */
  async history(actor: { id: string; role: string }) {
    this.assertAdmin(actor)
    const rows = await this.prisma.agentPersona.findMany({
      orderBy: { version: 'desc' },
      take: 20,
      select: {
        version: true,
        note: true,
        status: true,
        createdBy: true,
        createdAt: true,
        content: true,
      },
    })
    return rows
  }

  // 播种以「写入结果」为准而不是写后回读：回读依赖同一次调用的读己之写一致性，
  // 一旦主从/连接池错位就会把刚建的 v1 读成不存在，从而长期跑在无版本态（personaVersion=0），
  // 那正是版本化要消灭的状态。只有创建失败（多实例并发撞唯一约束）时才回查。
  private async seed(content: string, note: string): Promise<ActivePersona> {
    try {
      await this.prisma.agentPersona.create({
        data: { version: 1, content, note, status: 'active' },
      })
      return { version: 1, content }
    } catch (err) {
      this.logger.warn(
        '提示词播种未写入（可能已被另一实例播种），回查当前生效版本：' +
          (err instanceof Error ? err.message : String(err)),
      )
    }
    const row = await this.prisma.agentPersona.findFirst({
      where: { status: 'active' },
      orderBy: { version: 'desc' },
      select: { version: true, content: true },
    })
    return row ?? { version: BUILTIN_PERSONA_VERSION, content }
  }

  // 人设是系统提示词本身：能改写就等于能改写助手的行为，因此限管理员。
  // 与仓内既有做法一致（角色判定放在 service，不额外造 RolesGuard）。
  private assertAdmin(actor: { id: string; role: string }) {
    if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可管理 Agent 提示词')
  }
}
