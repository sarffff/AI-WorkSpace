import { Module } from '@nestjs/common'
import { MemoryService } from './memory.service'
import { EmbeddingsClient } from '@/common/embeddings'

@Module({
  providers: [MemoryService, EmbeddingsClient],
  exports: [MemoryService],
})
export class MemoryModule {}
