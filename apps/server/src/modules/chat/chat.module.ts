import { Module } from '@nestjs/common'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { StreamSlotService } from './stream-slot.service'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { TicketsModule } from '../tickets/tickets.module'
import { MemoryModule } from '../memory/memory.module'
import { LlmClient } from '@/common/llm-client'
import { AGENT_TOOL_PROVIDERS } from './agent-tools'

@Module({
  imports: [KnowledgeModule, TicketsModule, MemoryModule],
  controllers: [ChatController],
  // AGENT_TOOL_PROVIDERS：各工具实现 + 多提供者聚合 + 注册表（详见 agent-tools/index.ts）
  // StreamSlotService：每用户在途 SSE 上限，保护上游模型配额与进程内存
  providers: [ChatService, StreamSlotService, LlmClient, ...AGENT_TOOL_PROVIDERS],
  exports: [ChatService],
})
export class ChatModule {}
