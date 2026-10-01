import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UseFilters,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { KnowledgeService, MAX_UPLOAD_BYTES } from './knowledge.service'
import { CreateTextDocumentDto, SetGapStatusDto } from './knowledge.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'
import type { SafeUser } from '../auth/auth.service'
import { UploadErrorFilter } from './upload-error.filter'

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // 可见文档列表：本人 + 本部门共享（管理员全部）
  @Get('documents')
  async getDocuments(@CurrentUser() user: SafeUser) {
    return await this.knowledgeService.getDocuments(user)
  }

  // 知识缺口候选：AI 升级掉、人工解决了的问题 → 待补文档草稿（仅坐席/管理员）
  @Get('gap-candidates')
  async getGapCandidates(
    @CurrentUser() user: SafeUser,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    const d = Math.min(Math.max(parseInt(days || '30', 10) || 30, 1), 90)
    const l = Math.min(Math.max(parseInt(limit || '50', 10) || 50, 1), 200)
    return this.knowledgeService.getGapCandidates(user, d, l)
  }

  // 缺口处置（成文/不补/重开）。键用工单号而不是缺口行主键：
  // 清单本来就是从工单推导的，坐席手里拿到的也只有工单号
  @Patch('gap-candidates/:ticketId/status')
  setGapStatus(
    @CurrentUser() user: SafeUser,
    @Param('ticketId') ticketId: string,
    @Body() dto: SetGapStatusDto,
  ) {
    return this.knowledgeService.setGapStatus(user, ticketId, dto)
  }

  // 上传文档（multipart：file + 可选 department 共享标记）→ 落库 + 入队后台索引
  // 体积上限在此拦截：buffer 全程在内存并要进索引队列，无上限时单个大文件即可打爆内存。
  // 超限由 multer 抛 LIMIT_FILE_SIZE，UploadErrorFilter 归一成 413 + 明确文案。
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @UseFilters(new UploadErrorFilter(MAX_UPLOAD_BYTES))
  async uploadDocument(
    @CurrentUser() user: SafeUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('department') department?: string,
  ) {
    return await this.knowledgeService.uploadDocument(user, file, department)
  }

  // 文本建文档：与上传同一条索引流水线；缺口候选草稿一键晋升走这里
  @Post('documents/text')
  async createTextDocument(@CurrentUser() user: SafeUser, @Body() dto: CreateTextDocumentDto) {
    return await this.knowledgeService.createDocumentFromText(user, dto)
  }

  @Delete('documents/:id')
  async deleteDocument(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return await this.knowledgeService.deleteDocument(user, id)
  }
}
