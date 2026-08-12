import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { KnowledgeModule } from '@/modules/knowledge/knowledge.module'
import { SettingsModule } from '@/modules/settings/settings.module'
import { AgentModule } from '@/modules/agent/agent.module'

@Module({
  imports: [KnowledgeModule, SettingsModule, AgentModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
