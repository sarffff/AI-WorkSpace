import { confirmWaitWindows, waitForConfirmRequest, type ConfirmOutcome } from './confirm-wait'

// 行为依据（与实现一致）：
// - 本实例 resolver 先出结果 → 直接采信（最快路径，不等轮询）
// - 草稿被别处改成 approved/rejected → 轮询感知到即返回，交给调用方的原子抢占去防重
// - 超时到期 → 'expired'（不是失败也不是拒绝：草稿保持 pending，之后可被恢复确认）
// - 无论哪条路退出，轮询与超时定时器都必须清掉（否则事件循环被拖住、句柄泄漏）

const windows = { timeoutMs: 1000, pollMs: 30 }

function deferred() {
  let resolve!: (v: boolean) => void
  const promise = new Promise<boolean>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('waitForConfirmRequest', () => {
  it('本实例批准 → approved，且不留定时器', async () => {
    const d = deferred()
    const outcome = waitForConfirmRequest(
      { readDraftStatus: async () => 'pending', ...windows },
      'r1',
      d.promise,
    )
    d.resolve(true)
    await expect(outcome).resolves.toBe('approved')
  })

  it('本实例拒绝 → rejected', async () => {
    const d = deferred()
    const outcome = waitForConfirmRequest(
      { readDraftStatus: async () => 'pending', ...windows },
      'r1',
      d.promise,
    )
    d.resolve(false)
    await expect(outcome).resolves.toBe('rejected')
  })

  it('草稿被另一实例批准 → 轮询感知到 approved（本侧靠原子抢占避免重复建单）', async () => {
    let reads = 0
    const outcome = await waitForConfirmRequest(
      {
        timeoutMs: 2000,
        pollMs: 20,
        readDraftStatus: async () => (++reads >= 2 ? 'approved' : 'pending'),
      },
      'r1',
      new Promise<boolean>(() => undefined), // 本实例永远等不到
    )
    expect(outcome).toBe('approved')
    expect(reads).toBeGreaterThanOrEqual(2)
  })

  it('草稿被别处拒绝 → rejected', async () => {
    const outcome = await waitForConfirmRequest(
      { timeoutMs: 2000, pollMs: 20, readDraftStatus: async () => 'rejected' },
      'r1',
      new Promise<boolean>(() => undefined),
    )
    expect(outcome).toBe('rejected')
  })

  it('一直无人决定 → expired', async () => {
    const outcome = await waitForConfirmRequest(
      { timeoutMs: 60, pollMs: 20, readDraftStatus: async () => 'pending' },
      'r1',
      new Promise<boolean>(() => undefined),
    )
    expect(outcome).toBe<ConfirmOutcome>('expired')
  })

  it('读草稿抛错不致命：继续等，最终按超时收敛', async () => {
    const outcome = await waitForConfirmRequest(
      {
        timeoutMs: 80,
        pollMs: 20,
        readDraftStatus: async () => {
          throw new Error('db gone')
        },
      },
      'r1',
      new Promise<boolean>(() => undefined),
    )
    expect(outcome).toBe('expired')
  })

  it('退出后停止轮询：不留一个永远在打库的 interval', async () => {
    let reads = 0
    const d = deferred()
    const pending = waitForConfirmRequest(
      {
        readDraftStatus: async () => {
          reads++
          return 'pending'
        },
        timeoutMs: 5000,
        pollMs: 20,
      },
      'r1',
      d.promise,
    )
    d.resolve(true)
    await pending

    const atExit = reads
    await new Promise((r) => setTimeout(r, 150))
    expect(reads).toBe(atExit)
  })
})

describe('confirmWaitWindows', () => {
  it('缺省：5 分钟窗口、2 秒轮询', () => {
    expect(confirmWaitWindows(undefined, undefined)).toEqual({
      timeoutMs: 300_000,
      pollMs: 2000,
    })
  })

  it('非法值回退默认', () => {
    for (const bad of ['', 'abc', '0', '-5']) {
      expect(confirmWaitWindows(bad, bad).timeoutMs).toBe(300_000)
    }
  })

  it('短窗口时轮询被压到不超过窗口的 1/4，但不低于 100ms', () => {
    expect(confirmWaitWindows('200', undefined).pollMs).toBe(100)
    expect(confirmWaitWindows('4000', undefined).pollMs).toBe(1000)
  })

  it('显式轮询间隔优先', () => {
    expect(confirmWaitWindows('5000', '50')).toEqual({ timeoutMs: 5000, pollMs: 50 })
  })
})
