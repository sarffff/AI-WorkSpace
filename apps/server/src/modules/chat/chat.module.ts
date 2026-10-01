import { Module } from '@nestjs/common'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { StreamSlotService } from './stream-slot.service'
import { StreamSessionService } from './stream-session.service'
import { ChatAttachmentStore } from './chat-attachment.store'
import { AgentPersonaService } from './agent-persona.service'
import { AgentPersonaController } from './agent-persona.controller'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { TicketsModule } from '../tickets/tickets.module'
import { MemoryModule } from '../memory/memory.module'
import { LlmClient } from '@/common/llm-client'
import { AGENT_TOOL_PROVIDERS } from './agent-tools'

@Module({
  imports: [KnowledgeModule, TicketsModule, MemoryModule],
  controllers: [ChatController, AgentPersonaController],
  // AGENT_TOOL_PROVIDERS：各工具实现 + 多提供者聚合 + 注册表（详见 agent-tools/index.ts）
  // StreamSlotService：每用户在途 SSE 上限，保护上游模型配额与进程内存
  // AgentPersonaService：Agent 人设提示词的版本存储（回答可归因的前提）
  providers: [
    ChatService,
    StreamSlotService,
    StreamSessionService,
    ChatAttachmentStore,
    AgentPersonaService,
    LlmClient,
    ...AGENT_TOOL_PROVIDERS,
  ],
  exports: [ChatService],
})
export class ChatModule {}
