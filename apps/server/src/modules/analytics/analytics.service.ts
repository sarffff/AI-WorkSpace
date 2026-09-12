import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import type { SafeUser } from '../auth/auth.service'

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
    const runs = await this.prisma.agentRun.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: AnalyticsService.MAX_OVERVIEW_ROWS,
    })

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
