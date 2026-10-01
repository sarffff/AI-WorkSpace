import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { TicketsService } from './tickets.service'
import { TicketAttachmentsService, MAX_ATTACHMENT_BYTES } from './ticket-attachments.service'
import { CreateTicketDto, CreateTicketCommentDto, UpdateTicketDto } from './tickets.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'
import type { SafeUser } from '../auth/auth.service'
import { UploadErrorFilter } from '../knowledge/upload-error.filter'

/** 查询参数取整：缺省或非法一律 undefined，交给服务端的默认值与钳制处理 */
function intOpt(raw: string | undefined): number | undefined {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? n : undefined
}

/** 下载响应头 Content-Disposition：ASCII 兜底 + UTF-8 编码文件名，兼容中文名 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly attachments: TicketAttachmentsService,
  ) {}

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

  // 实时 SLA 违约看板（仅坐席/管理员）：扫未完结存量，分 已违约 / 濒临违约 / 尚在时限。
  // 需在 :id 路由之前注册，避免 sla 被当作工单编号
  @Get('sla/breaches')
  slaBreaches(@CurrentUser() user: SafeUser) {
    return this.ticketsService.slaBreaches(user)
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

  // 派单落库（仅坐席/管理员）：把预演里"够硬"的那条真正写进 assigneeId。
  // 显式一张一张点，不做建单即自动派；弱信号（证据不足/无信号/不可路由）一律拒绝并说明原因。
  @Post(':id/dispatch')
  applyDispatch(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Query('minEvidence') minEvidence?: string,
    @Query('maxLoad') maxLoad?: string,
  ) {
    return this.ticketsService.applyDispatch(user, id, {
      minEvidence: intOpt(minEvidence),
      maxLoad: intOpt(maxLoad),
    })
  }

  // ===== 工单附件（截图/日志/配置等第一现场证据） =====
  // 可见性沿用工单本身：员工只能看/传自己工单的附件，坐席/管理员全部。

  @Get(':id/attachments')
  listAttachments(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.attachments.list(user, id)
  }

  // 上传：体积上限在此拦截（buffer 全程在内存 + 落盘，无上限单文件即可打爆内存）。
  // 超限由 multer 抛 LIMIT_FILE_SIZE，UploadErrorFilter 归一成 413 + 明确文案。
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  @UseFilters(new UploadErrorFilter(MAX_ATTACHMENT_BYTES))
  addAttachment(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.attachments.add(user, id, file)
  }

  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const { filename, mimeType, bytes } = await this.attachments.getForDownload(
      user,
      id,
      attachmentId,
    )
    return new StreamableFile(bytes, {
      type: mimeType,
      disposition: contentDisposition(filename),
      length: bytes.length,
    })
  }

  @Delete(':id/attachments/:attachmentId')
  removeAttachment(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachments.remove(user, id, attachmentId)
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
