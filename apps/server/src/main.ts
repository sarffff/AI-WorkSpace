import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'
import * as bcrypt from 'bcrypt'

const DEFAULT_USER_ID = '000000'

async function bootstrap() {
  // 生产环境强制安全配置
  if (process.env.NODE_ENV === 'production') {
    const secret = process.env.JWT_SECRET || ''
    if (secret.length < 32) {
      throw new Error('生产环境必须配置至少 32 字符的 JWT_SECRET')
    }
  }

  const app = await NestFactory.create(AppModule)

  // CORS 白名单：显式配置 + 默认放行本地开发来源；无 Origin 的原生客户端（curl/桌面端）放行
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'null',
  ]
  app.enableCors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      if (allowedOrigins.includes(origin) || defaults.includes(origin)) {
        return callback(null, true)
      }
      return callback(null, false)
    },
  })
  app.useGlobalPipes(new ValidationPipe({ transform: true }))

  // 确保默认用户存在（密码哈希需与 AuthService 的 bcrypt 校验一致）
  const prisma = app.get(PrismaService)
  const hashed = await bcrypt.hash('123456', 10)
  await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: { password: hashed },
    create: {
      id: DEFAULT_USER_ID,
      email: 'default@example.com',
      name: 'Default User',
      password: hashed,
    },
  })

  const port = process.env.PORT || 4000
  await app.listen(port)
  console.log(`AI Workspace Server is running on: http://localhost:${port}`)
}

bootstrap()
