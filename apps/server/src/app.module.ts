import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from './prisma/prisma.module'
import { RedisModule } from './redis/redis.module'
import { ChatModule } from './modules/chat/chat.module'
import { KnowledgeModule } from './modules/knowledge/knowledge.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    ChatModule,
    KnowledgeModule,
  ],
})
export class AppModule {}
