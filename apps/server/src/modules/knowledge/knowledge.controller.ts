import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { KnowledgeService } from './knowledge.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('documents')
  async getDocuments() {
    return await this.knowledgeService.getDocuments()
  }

  // 上传文档（multipart/form-data，字段名 file）→ 同步抽取/切块/向量化
  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(@UploadedFile() file: Express.Multer.File) {
    return await this.knowledgeService.uploadDocument(file)
  }

  @Delete('documents/:id')
  async deleteDocument(@Param('id') id: string) {
    return await this.knowledgeService.deleteDocument(id)
  }
}
