import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { TicketsService } from './tickets.service'

// ===== SLA 预警定时扫描器 =====
//
// 周期扫未完结工单，把「濒临违约 / 已违约」两个阶段推成站内通知（口径与看板一致：
// 剩余 <= 该优先级窗口 25%）。看板是"坐席想起来才看"，预警是"到点自己找坐席"——
// dueAt 字段的设计目标（违约之前预警）靠这里闭环。
//
// 不引入 @nestjs/schedule：全仓只有这一个周期任务，setInterval 足够，
// 不为单任务增加依赖与模块注册面。间隔 env SLA_SCAN_INTERVAL_MS，下限 1 分钟，
// 防止配错把 DB 打满；扫描本身只查未完结存量（有界），单轮代价可控。
@Injectable()
export class SlaSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaSchedulerService.name)
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly tickets: TicketsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const raw = parseInt(this.config.get<string>('SLA_SCAN_INTERVAL_MS') ?? '', 10)
    const ms = Number.isFinite(raw) && raw >= 60_000 ? raw : 300_000
    this.timer = setInterval(() => {
      void this.tickets.scanSlaStages().catch((err) => {
        this.logger.warn(`sla scan failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }, ms)
    this.logger.log(`sla scheduler started (interval=${ms}ms)`)
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
