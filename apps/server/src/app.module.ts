import { Module, Controller, Get } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { RedisModule } from './redis/redis.module'
import { ChatModule } from './modules/chat/chat.module'
import { KnowledgeModule } from './modules/knowledge/knowledge.module'
import { AuthModule } from './modules/auth/auth.module'
import { SettingsModule } from './modules/settings/settings.module'
import { PromptsModule } from './modules/prompts/prompts.module'
import { TasksModule } from './modules/tasks/tasks.module'
import { TicketsModule } from './modules/tickets/tickets.module'

// 免鉴权健康检查，供前端探活（GET /health）
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok', ts: Date.now() }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    AuthModule,
    ChatModule,
    KnowledgeModule,
    SettingsModule,
    PromptsModule,
    TasksModule,
    TicketsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
