import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'
import { PrismaService } from './prisma/prisma.service'

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors()
  app.useGlobalPipes(new ValidationPipe({ transform: true }))

  // 确保默认用户存在
  const prisma = app.get(PrismaService)
  await prisma.user.upsert({
    where: { id: DEFAULT_USER_ID },
    update: {},
    create: { id: DEFAULT_USER_ID, email: 'default@ai-workspace.local', name: 'Default User' },
  })

  const port = process.env.PORT || 4000
  await app.listen(port)
  console.log(`AI Workspace Server is running on: http://localhost:${port}`)
}
bootstrap()
