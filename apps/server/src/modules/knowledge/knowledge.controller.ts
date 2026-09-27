import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UseFilters,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { KnowledgeService, MAX_UPLOAD_BYTES } from './knowledge.service'
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

  @Delete('documents/:id')
  async deleteDocument(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return await this.knowledgeService.deleteDocument(user, id)
  }
}
