import { Module } from '@nestjs/common'
import { MemoryController } from './memory.controller'
import { MemoryService } from './memory.service'
import { EmbeddingsClient } from '@/common/embeddings'

@Module({
  controllers: [MemoryController],
  providers: [MemoryService, EmbeddingsClient],
  exports: [MemoryService],
})
export class MemoryModule {}
