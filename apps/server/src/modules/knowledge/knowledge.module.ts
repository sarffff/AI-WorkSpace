import { Module } from '@nestjs/common'
import { KnowledgeController } from './knowledge.controller'
import { KnowledgeService } from './knowledge.service'
import { IndexingQueueService } from './indexing-queue.service'

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, IndexingQueueService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
