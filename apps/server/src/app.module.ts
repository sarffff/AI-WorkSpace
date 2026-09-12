import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { ChatModule } from './modules/chat/chat.module'
import { KnowledgeModule } from './modules/knowledge/knowledge.module'
import { PromptsModule } from './modules/prompts/prompts.module'
import { TicketsModule } from './modules/tickets/tickets.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { SettingsModule } from './modules/settings/settings.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    SettingsModule,
    ChatModule,
    KnowledgeModule,
    PromptsModule,
    TicketsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
