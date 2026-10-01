import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { TicketsService } from './tickets.service'
import { SlaSchedulerService } from './sla-scheduler.service'

// 行为依据（与实现一致）：
// - 间隔取 SLA_SCAN_INTERVAL_MS，低于 60s 视为配错，回落到 300s（防把库打满）
// - 扫描失败只告警：定时任务冒出的异常不该演变成未处理拒绝
// - onModuleDestroy 清掉 timer，否则测试进程与热重载都会留着一条心跳

function make(intervalEnv?: string) {
  const scans: number[] = []
  let fail = false
  const tickets = {
    scanSlaStages: async () => {
      scans.push(Date.now())
      if (fail) throw new Error('scan blew up')
      return { atRisk: 0, breached: 1 }
    },
  }
  const config = {
    get: (key: string) => (key === 'SLA_SCAN_INTERVAL_MS' ? intervalEnv : undefined),
  } as unknown as ConfigService
  const svc = new SlaSchedulerService(tickets as unknown as TicketsService, config)
  return { svc, scans, failScan: () => (fail = true) }
}

describe('SlaSchedulerService', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('默认每 5 分钟扫一次', async () => {
    const { svc, scans } = make()
    svc.onModuleInit()
    try {
      expect(scans).toHaveLength(0) // 启动时不立刻扫，只挂心跳
      await jest.advanceTimersByTimeAsync(300_000)
      expect(scans).toHaveLength(1)
      await jest.advanceTimersByTimeAsync(300_000)
      expect(scans).toHaveLength(2)
    } finally {
      svc.onModuleDestroy()
    }
  })

  it('间隔配得比 1 分钟还短按配错处理，回落到默认值', async () => {
    const { svc, scans } = make('1000')
    svc.onModuleInit()
    try {
      await jest.advanceTimersByTimeAsync(60_000)
      expect(scans).toHaveLength(0)
      await jest.advanceTimersByTimeAsync(240_000)
      expect(scans).toHaveLength(1)
    } finally {
      svc.onModuleDestroy()
    }
  })

  it('合法间隔照用', async () => {
    const { svc, scans } = make('60000')
    svc.onModuleInit()
    try {
      await jest.advanceTimersByTimeAsync(60_000)
      expect(scans).toHaveLength(1)
    } finally {
      svc.onModuleDestroy()
    }
  })

  it('扫描抛错只告警，不冒泡成未处理拒绝', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { svc, failScan } = make()
    failScan()
    svc.onModuleInit()
    const unhandled: unknown[] = []
    const onHide = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', onHide)
    try {
      await jest.advanceTimersByTimeAsync(300_000)
      await jest.advanceTimersByTimeAsync(0)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sla scan failed'))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onHide)
      svc.onModuleDestroy()
    }
  })

  it('停机后不再扫', async () => {
    const { svc, scans } = make()
    svc.onModuleInit()
    svc.onModuleDestroy()
    await jest.advanceTimersByTimeAsync(900_000)
    expect(scans).toHaveLength(0)
    svc.onModuleDestroy() // 重复调用不该炸
  })
})
