import { Module } from '@nestjs/common'
import { KnowledgeController } from './knowledge.controller'
import { KnowledgeService } from './knowledge.service'
import { IndexingQueueService } from './indexing-queue.service'
import { UploadPayloadStore } from './upload-payload.store'
import { LlmClient } from '@/common/llm-client'
import { EmbeddingsClient } from '@/common/embeddings'

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    IndexingQueueService,
    UploadPayloadStore,
    LlmClient,
    EmbeddingsClient,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
