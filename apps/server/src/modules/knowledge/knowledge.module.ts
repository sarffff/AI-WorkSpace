import { Module } from '@nestjs/common'
import { KnowledgeService } from './knowledge.service'
import { KnowledgeController } from './knowledge.controller'
import { SettingsModule } from '@/modules/settings/settings.module'

@Module({
  imports: [SettingsModule],
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
