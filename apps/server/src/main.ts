import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { PrismaService } from './prisma/prisma.service'
import { LoggingInterceptor } from './common/logging.interceptor'
import { bootstrapAdmin } from './common/bootstrap-admin'
import { assertRuntimeSecrets, resolveCorsOrigin } from './common/startup-guards'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)

  // 先校验再监听：密钥缺失时拒绝启动，而不是带着可自签任意管理员 token 的兜底值跑起来
  assertRuntimeSecrets(config.get<string>('NODE_ENV'), config.get<string>('JWT_SECRET'))

  app.enableCors({ origin: resolveCorsOrigin(config.get<string>('CORS_ORIGIN')) })
  app.useGlobalPipes(new ValidationPipe({ transform: true }))
  app.useGlobalInterceptors(new LoggingInterceptor())
  // 优雅停机：SIGTERM/SIGINT 时触发 OnModuleDestroy（Prisma 断连接）并等在途请求收尾。
  // 没有它，Ctrl+C / 容器停止会在索引流水线与 SSE 生成器中途掐断进程
  app.enableShutdownHooks()

  await bootstrapAdmin(app.get(PrismaService))

  const port = process.env.PORT || 4000
  await app.listen(port)
  console.log(`ServiceDeck Server is running on: http://localhost:${port}`)
}

bootstrap()
