import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'
import type { SafeUser } from '../auth/auth.service'

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // 运行看板概览（KPI/分布/每日趋势，仅坐席/管理员；days 夹取 1-90）
  @Get('overview')
  overview(@CurrentUser() user: SafeUser, @Query('days') days?: string) {
    const d = Math.min(Math.max(parseInt(days || '30', 10) || 30, 1), 90)
    return this.analyticsService.overview(user, d)
  }

  // 运行明细列表（limit 夹取 1-200 默认 50；offset >= 0）
  @Get('runs')
  listRuns(
    @CurrentUser() user: SafeUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const l = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 200)
    const o = Math.max(parseInt(offset || '0', 10) || 0, 0)
    return this.analyticsService.listRuns(user, l, o)
  }

  // 运行详情（含 steps 轨迹时间线）
  @Get('runs/:id')
  runDetail(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.analyticsService.runDetail(user, id)
  }
}
