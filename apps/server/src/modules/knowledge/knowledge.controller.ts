import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  // Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { KnowledgeService } from './knowledge.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  // 分页文档列表：?page=1&pageSize=20
  @Get('documents')
  async getDocuments(
    @UserId() userId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1)
    const ps = Math.min(100, Math.max(1, parseInt(pageSize || '20', 10) || 20))
    return await this.knowledgeService.getDocuments(userId, p, ps)
  }

  // 语义检索预览：?q=关键词&topK=4
  @Get('search')
  async search(@UserId() userId: string, @Query('q') q: string, @Query('topK') topK?: string) {
    if (!q?.trim()) throw new BadRequestException('缺少查询参数 q')
    const hits = await this.knowledgeService.searchRelevant(
      userId,
      q,
      Math.min(20, parseInt(topK || '4', 10) || 4),
    )
    return { success: true, data: hits }
  }

  // 上传文档（multipart/form-data，字段名 file；≤30MB）→ 同步抽取/切块/向量化
  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        const ext = file.originalname.split('.').pop()?.toLowerCase() || ''
        if (ext === 'pdf' || ext === 'docx') return cb(null, true)
        cb(new BadRequestException(`不支持的文件类型: .${ext || 'unknown'}`), false)
      },
    }),
  )
  async uploadDocument(@UserId() userId: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('未收到文件（文件可能超过 30MB）')
    return await this.knowledgeService.uploadDocument(userId, file)
  }

  // 重新索引（用存储的原始文件重新切块/向量化）
  @Post('documents/:id/reindex')
  async reindexDocument(@UserId() userId: string, @Param('id') id: string) {
    return await this.knowledgeService.reindexDocument(userId, id)
  }

  // 查看文档切块预览
  @Get('documents/:id/chunks')
  async getDocumentChunks(@UserId() userId: string, @Param('id') id: string) {
    return await this.knowledgeService.getDocumentChunks(userId, id)
  }

  @Delete('documents/:id')
  async deleteDocument(@UserId() userId: string, @Param('id') id: string) {
    return await this.knowledgeService.deleteDocument(userId, id)
  }
}
