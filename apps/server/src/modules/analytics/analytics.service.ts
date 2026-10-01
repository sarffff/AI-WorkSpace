import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { SafeUser } from '../auth/auth.service'
import { computeDeflection, rankKnowledgeGaps, type SessionFact } from './deflection'

// Agent 运行运营看板（仅坐席/管理员）：
// - overview 在 JS 内聚合最近 N 天运行数据（上限 1000 条防内存失控），
//   统计总量/均轮次/检索命中率/建单转化率/工具与模型分布/每日 token 趋势
// - steps 为 Json 轨迹明细（decision/tool/generate），工具分布直接从 steps 统计
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private static readonly DAY_MS = 86400_000
  // 单次聚合最多取的行数（按 createdAt 倒序取最近）
  private static readonly MAX_OVERVIEW_ROWS = 1000

  // 看板仅坐席/管理员可见（与 tickets.stats 一致）
  private assertStaff(user: SafeUser) {
    if (user.role !== 'agent' && user.role !== 'admin') {
      throw new ForbiddenException('仅坐席/管理员可查看运营看板')
    }
  }

  // 本地时区 YYYY-MM-DD（每日聚合键）
  private static dayKey(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }

  async overview(user: SafeUser, days = 30) {
    this.assertStaff(user)
    const since = new Date(Date.now() - days * AnalyticsService.DAY_MS)
    const [runs, feedbackRows] = await Promise.all([
      this.prisma.agentRun.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: AnalyticsService.MAX_OVERVIEW_ROWS,
      }),
      // 满意度：期内被评价过的 assistant 消息（未评价的不进分母）
      this.prisma.message.groupBy({
        by: ['feedback', 'feedbackReason'],
        where: { feedback: { not: null }, feedbackAt: { gte: since } },
        _count: { _all: true },
      }),
    ])

    const totalRuns = runs.length
    let totalToolCalls = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalRounds = 0
    let totalMs = 0
    let hits = 0
    let conversions = 0
    const toolCounts: Record<string, number> = {}
    const modelCounts: Record<string, number> = {}
    const dailyMap = new Map<
      string,
      { runs: number; promptTokens: number; completionTokens: number }
    >()

    for (const run of runs) {
      totalToolCalls += run.toolCalls
      totalPromptTokens += run.promptTokens
      totalCompletionTokens += run.completionTokens
      totalRounds += run.rounds
      totalMs += run.totalMs
      if (run.sources > 0) hits++
      if (run.ticketId) conversions++

      const modelKey = run.model ?? 'unknown'
      modelCounts[modelKey] = (modelCounts[modelKey] || 0) + 1

      // 工具分布：只统计 steps 里 kind === 'tool' 的元素，其余（decision/generate/异常值）忽略
      const steps = run.steps as unknown
      if (Array.isArray(steps)) {
        for (const step of steps) {
          if (!step || typeof step !== 'object') continue
          const s = step as { kind?: unknown; tool?: unknown }
          if (s.kind === 'tool' && typeof s.tool === 'string') {
            toolCounts[s.tool] = (toolCounts[s.tool] || 0) + 1
          }
        }
      }

      const date = AnalyticsService.dayKey(run.createdAt)
      const daily = dailyMap.get(date) ?? { runs: 0, promptTokens: 0, completionTokens: 0 }
      daily.runs++
      daily.promptTokens += run.promptTokens
      daily.completionTokens += run.completionTokens
      dailyMap.set(date, daily)
    }

    const round1 = (n: number) => Math.round(n * 10) / 10
    const round3 = (n: number) => Math.round(n * 1000) / 1000

    // 满意度聚合：分母只含已评价消息 —— 未评价占绝大多数，计入会把率稀释成噪声。
    // 原因分布只统计 down（up 不携带原因）。
    let up = 0
    let down = 0
    const reasonCounts: Record<string, number> = {}
    for (const row of feedbackRows) {
      const n = row._count._all
      if (row.feedback === 'up') up += n
      else if (row.feedback === 'down') {
        down += n
        // 未选原因的 👎 归入 unspecified，避免这部分在分布里凭空消失
        const key = row.feedbackReason ?? 'unspecified'
        reasonCounts[key] = (reasonCounts[key] || 0) + n
      }
    }
    const rated = up + down

    return {
      periodDays: days,
      totalRuns,
      totalToolCalls,
      totalPromptTokens,
      totalCompletionTokens,
      avgRounds: totalRuns ? round1(totalRounds / totalRuns) : null,
      avgTotalMs: totalRuns ? Math.round(totalMs / totalRuns) : null,
      searchHitRate: totalRuns ? round3(hits / totalRuns) : null,
      ticketConversionRate: totalRuns ? round3(conversions / totalRuns) : null,
      toolDistribution: Object.entries(toolCounts)
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count),
      modelDistribution: Object.entries(modelCounts)
        .map(([model, count]) => ({ model, runs: count }))
        .sort((a, b) => b.runs - a.runs),
      daily: [...dailyMap.entries()]
        .map(([date, d]) => ({ date, ...d }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      feedback: {
        up,
        down,
        rated,
        // 满意度率 = 👍 / 已评价数；无人评价时为 null（不是 0）
        satisfactionRate: rated ? round3(up / rated) : null,
        reasonDistribution: Object.entries(reasonCounts)
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
      },
    }
  }

  /**
   * 偏转率：期内「AI 接住的会话」里有多少没落成人工工单。
   *
   * 全部走 DB 侧 groupBy（不像 overview 那样拉 1000 行回 JS）：这里要的是
   * 每个会话的计数，行数由活跃会话数决定而不是消息数决定，拉明细会立刻失控。
   * 口径与边界都在 computeDeflection 里，见 deflection.ts。
   */
  async deflection(user: SafeUser, days = 30) {
    this.assertStaff(user)
    const since = new Date(Date.now() - days * AnalyticsService.DAY_MS)

    const [roleRows, citedRows, downRows, ticketRows, unattributed, categoryRows] =
      await Promise.all([
        // 提问数与回答数：role 分桶后按会话计数（同会话同期只有一行 per role）
        this.prisma.message.groupBy({
          by: ['chatId', 'role'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        // 带引用的回答：sources 为空时落的是 NULL，所以 not null 就是"这条查过资料"
        this.prisma.message.groupBy({
          by: ['chatId'],
          where: {
            role: 'assistant',
            sources: { not: null },
            createdAt: { gte: since },
          },
          _count: { _all: true },
        }),
        this.prisma.message.groupBy({
          by: ['chatId'],
          where: { role: 'assistant', feedback: 'down', feedbackAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.ticket.groupBy({
          by: ['chatId'],
          where: { source: 'agent', createdAt: { gte: since }, chatId: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.ticket.count({
          where: { source: 'agent', createdAt: { gte: since }, chatId: null },
        }),
        this.prisma.ticket.groupBy({
          by: ['category'],
          where: { source: 'agent', createdAt: { gte: since } },
          _count: { _all: true },
        }),
      ])

    const facts = new Map<string, SessionFact>()
    const touch = (chatId: string): SessionFact => {
      let f = facts.get(chatId)
      if (!f) {
        f = { chatId, answers: 0, citedAnswers: 0, agentTickets: 0, downs: 0, questions: 0 }
        facts.set(chatId, f)
      }
      return f
    }
    for (const row of roleRows) {
      const f = touch(row.chatId)
      if (row.role === 'assistant') f.answers += row._count._all
      else if (row.role === 'user') f.questions += row._count._all
    }
    for (const row of downRows) touch(row.chatId).downs += row._count._all
    for (const row of citedRows) touch(row.chatId).citedAnswers += row._count._all
    for (const row of ticketRows) {
      if (row.chatId) touch(row.chatId).agentTickets += row._count._all
    }

    return {
      days,
      since: since.toISOString(),
      ...computeDeflection({
        sessions: [...facts.values()],
        unattributedAgentTickets: unattributed,
      }),
      // 知识缺口：AI 升级掉的那些工单按分类排，排第一的就是"最该补文档"的地方
      knowledgeGaps: rankKnowledgeGaps(
        categoryRows.map((r) => ({ category: r.category, escalated: r._count._all })),
      ),
    }
  }

  // 轻量列表（不含 steps，避免大 JSON 撑爆列表接口）
  async listRuns(user: SafeUser, limit = 50, offset = 0) {
    this.assertStaff(user)
    return this.prisma.agentRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        chatId: true,
        userId: true,
        model: true,
        status: true,
        rounds: true,
        toolCalls: true,
        sources: true,
        ticketId: true,
        ticketTitle: true,
        promptTokens: true,
        completionTokens: true,
        totalMs: true,
        createdAt: true,
      },
    })
  }

  // 完整详情（含 steps 轨迹时间线）
  async runDetail(user: SafeUser, id: string) {
    this.assertStaff(user)
    const run = await this.prisma.agentRun.findUnique({ where: { id } })
    if (!run) throw new NotFoundException('运行记录不存在')
    return run
  }
}
