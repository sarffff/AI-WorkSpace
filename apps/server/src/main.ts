import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'
import { LoggingInterceptor } from './common/logging.interceptor'
import * as bcrypt from 'bcrypt'

const DEFAULT_USER_ID = '000000'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors()
  app.useGlobalPipes(new ValidationPipe({ transform: true }))
  app.useGlobalInterceptors(new LoggingInterceptor())

  // 确保默认管理员存在（演示用；密码哈希需与 AuthService 的 bcrypt 校验一致）
  const prisma = app.get(PrismaService)
  const hashed = await bcrypt.hash('123456', 10)
  await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: { password: hashed, role: 'admin' },
    create: {
      id: DEFAULT_USER_ID,
      email: 'default@example.com',
      name: 'Default User',
      password: hashed,
      role: 'admin',
    },
  })

  const port = process.env.PORT || 4000
  await app.listen(port)
  console.log(`ServiceDeck Server is running on: http://localhost:${port}`)
}
bootstrap()
