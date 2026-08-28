import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { KnowledgeService } from './knowledge.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'
import type { SafeUser } from '../auth/auth.service'

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // 可见文档列表：本人 + 本部门共享（管理员全部）
  @Get('documents')
  async getDocuments(@CurrentUser() user: SafeUser) {
    return await this.knowledgeService.getDocuments(user)
  }

  // 上传文档（multipart：file + 可选 department 共享标记）→ 同步抽取/切块/向量化
  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
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
