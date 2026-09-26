import { Controller, Get, Header, Logger, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

// 存活/就绪探针：进程管理器与反向代理需要区分「在监听」和「能服务」。
// 本项目的数据面只有 MySQL 一个外部依赖，所以 SELECT 1 就是最有意义的就绪判据。
// 刻意不挂 JwtAuthGuard —— 探针不该依赖登录态，也不该被认证故障掩盖成 401。
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Health')

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 只记一条：DB 不可用时探针会被高频调用，避免日志刷爆
      this.logger.warn(`数据库探活失败: ${message}`)
      throw new ServiceUnavailableException({ status: 'error', reason: 'database unavailable' })
    }
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) }
  }
}
