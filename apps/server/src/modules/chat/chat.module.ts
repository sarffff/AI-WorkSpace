import { Module } from '@nestjs/common'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { TicketsModule } from '../tickets/tickets.module'
import { MemoryModule } from '../memory/memory.module'
import { LlmClient } from '@/common/llm-client'

@Module({
  imports: [KnowledgeModule, TicketsModule, MemoryModule],
  controllers: [ChatController],
  providers: [ChatService, LlmClient],
  exports: [ChatService],
})
export class ChatModule {}
