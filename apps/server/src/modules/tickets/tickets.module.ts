import { Module } from '@nestjs/common'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'
import { KnowledgeModule } from '@/modules/knowledge/knowledge.module'
import { SettingsModule } from '@/modules/settings/settings.module'

@Module({
  imports: [KnowledgeModule, SettingsModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
