import { Controller, Get } from '@nestjs/common'
import { KnowledgeService } from './knowledge.service'

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('documents')
  async getDocuments() {
    return await this.knowledgeService.getDocuments()
  }
}
