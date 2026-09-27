import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { TicketsService } from './tickets.service'
import { CreateTicketDto, CreateTicketCommentDto, UpdateTicketDto } from './tickets.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'
import type { SafeUser } from '../auth/auth.service'

/** 查询参数取整：缺省或非法一律 undefined，交给服务端的默认值与钳制处理 */
function intOpt(raw: string | undefined): number | undefined {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? n : undefined
}

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  // 工单列表（员工只看自己的，坐席/管理员看全部）
  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.ticketsService.list(user)
  }

  // 可分派坐席列表（需在 :id 路由之前注册，避免被路径参数吞掉）
  @Get('staff')
  listStaff() {
    return this.ticketsService.listStaff()
  }

  // 坐席看板统计（偏转率/SLA/响应时长，仅坐席/管理员）
  @Get('stats')
  stats(@CurrentUser() user: SafeUser, @Query('days') days?: string) {
    const d = Math.min(Math.max(parseInt(days || '30', 10) || 30, 1), 90)
    return this.ticketsService.stats(user, d)
  }

  // ===== 派单预演与回测（只读，绝不写 assigneeId） =====
  //
  // 自动派单要先回答"猜得中吗"：preview 看当下这堆没人接的单该给谁，backtest 看历史
  // 上按同一套判据能命中多少。两个旋钮（minEvidence/maxLoad）走查询参数，
  // 因为"多少证据才敢放手""几个人手算饱和"本来就是运营要试的阈值，不该钉死在代码里。

  @Get('dispatch/preview')
  dispatchPreview(
    @CurrentUser() user: SafeUser,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('minEvidence') minEvidence?: string,
    @Query('maxLoad') maxLoad?: string,
  ) {
    return this.ticketsService.dispatchPreview(user, intOpt(days), intOpt(limit), {
      minEvidence: intOpt(minEvidence),
      maxLoad: intOpt(maxLoad),
    })
  }

  @Get('dispatch/backtest')
  dispatchBacktest(
    @CurrentUser() user: SafeUser,
    @Query('days') days?: string,
    @Query('minEvidence') minEvidence?: string,
    @Query('decisionsLimit') decisionsLimit?: string,
  ) {
    return this.ticketsService.dispatchBacktest(user, intOpt(days), {
      minEvidence: intOpt(minEvidence),
      decisionsLimit: intOpt(decisionsLimit),
    })
  }

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(user.id, dto)
  }

  @Get(':id')
  detail(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.ticketsService.detail(user, id)
  }

  // 工单时间线评论（创建者与坐席/管理员可留言）
  @Post(':id/comments')
  addComment(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: CreateTicketCommentDto,
  ) {
    return this.ticketsService.addComment(user, id, dto)
  }

  @Patch(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketsService.update(user, id, dto)
  }

  @Delete(':id')
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.ticketsService.remove(user, id)
  }
}
