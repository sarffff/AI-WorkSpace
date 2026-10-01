import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { ChatModule } from './modules/chat/chat.module'
import { KnowledgeModule } from './modules/knowledge/knowledge.module'
import { PromptsModule } from './modules/prompts/prompts.module'
import { TicketsModule } from './modules/tickets/tickets.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { SettingsModule } from './modules/settings/settings.module'
import { HealthController } from './common/health.controller'
import { throttleTracker } from './common/throttle-tracker'

const DEFAULT_THROTTLE_TTL_MS = 60_000
// 全局默认按 600/min/用户：客户端有多处轮询（会话列表、索引进度、服务在线探测），
// 卡太紧会把正常轮询打成 429。这里拦的是失控循环，Agent 流的专门约束在
// ChatController（@Throttle 收紧 + StreamSlotService 管在途并发）
const DEFAULT_THROTTLE_LIMIT = 600

function intConfig(value: string | undefined, def: number): number {
  const n = value ? parseInt(value, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : def
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: intConfig(config.get<string>('THROTTLE_TTL_MS'), DEFAULT_THROTTLE_TTL_MS),
            limit: intConfig(config.get<string>('THROTTLE_LIMIT'), DEFAULT_THROTTLE_LIMIT),
            getTracker: throttleTracker,
          },
        ],
      }),
    }),
    PrismaModule,
    AuthModule,
    SettingsModule,
    ChatModule,
    KnowledgeModule,
    PromptsModule,
    TicketsModule,
    NotificationsModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
