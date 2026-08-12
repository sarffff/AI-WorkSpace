import { Module } from '@nestjs/common'
import { AgentToolsService } from './agent-tools.service'
import { KnowledgeModule } from '@/modules/knowledge/knowledge.module'

@Module({
  imports: [KnowledgeModule],
  providers: [AgentToolsService],
  exports: [AgentToolsService],
})
export class AgentModule {}
