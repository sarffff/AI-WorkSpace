import type { ConfigService } from '@nestjs/config'
import { DEFAULT_MAX_CONCURRENT_STREAMS, StreamSlotService } from './stream-slot.service'

// 行为依据（与实现一致）：
// - 每用户在途 SSE 上限，默认 DEFAULT_MAX_CONCURRENT_STREAMS，env 可覆盖
// - 达上限时 tryAcquire 返回 false 且不改动计数
// - release 幂等：多释放不会把计数压成负数（否则异常路径几次就把上限作废）
// - 不同用户互不影响

function make(env?: string) {
  const config = {
    get: (key: string) => (key === 'MAX_CONCURRENT_STREAMS_PER_USER' ? env : undefined),
  }
  return new StreamSlotService(config as unknown as ConfigService)
}

describe('StreamSlotService', () => {
  it('缺省上限为 DEFAULT_MAX_CONCURRENT_STREAMS，取满即拒', () => {
    const slots = make()
    expect(slots.maxPerUser()).toBe(DEFAULT_MAX_CONCURRENT_STREAMS)

    for (let i = 0; i < DEFAULT_MAX_CONCURRENT_STREAMS; i++) {
      expect(slots.tryAcquire('u1')).toBe(true)
    }
    expect(slots.tryAcquire('u1')).toBe(false)
    expect(slots.activeCount('u1')).toBe(DEFAULT_MAX_CONCURRENT_STREAMS)
  })

  it('释放后可再次占用', () => {
    const slots = make('1')
    expect(slots.tryAcquire('u1')).toBe(true)
    expect(slots.tryAcquire('u1')).toBe(false)
    slots.release('u1')
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.tryAcquire('u1')).toBe(true)
  })

  it('超额释放不会把计数压成负数', () => {
    const slots = make('1')
    slots.release('never-acquired')
    expect(slots.activeCount('never-acquired')).toBe(0)

    slots.tryAcquire('u1')
    slots.release('u1')
    slots.release('u1') // 多余的一次
    expect(slots.activeCount('u1')).toBe(0)

    // 上限仍然有效：没被负数撑开
    expect(slots.tryAcquire('u1')).toBe(true)
    expect(slots.tryAcquire('u1')).toBe(false)
  })

  it('用户之间互不影响', () => {
    const slots = make('1')
    expect(slots.tryAcquire('u1')).toBe(true)
    expect(slots.tryAcquire('u2')).toBe(true)
    expect(slots.tryAcquire('u1')).toBe(false)
    expect(slots.activeCount('u2')).toBe(1)
  })

  it('非法 env 值回退默认（0/负数/非数字都不等于放开限制）', () => {
    for (const bad of ['0', '-3', 'abc', '']) {
      expect(make(bad).maxPerUser()).toBe(DEFAULT_MAX_CONCURRENT_STREAMS)
    }
  })
})

describe('StreamSlotService 同会话互斥', () => {
  it('同一会话只能被一条流占用，释放后可再占', () => {
    const slots = make()
    expect(slots.tryClaimChat('c1', 'u1')).toBe(true)
    expect(slots.tryClaimChat('c1', 'u2')).toBe(false)
    expect(slots.chatHolder('c1')).toBe('u1')

    slots.releaseChat('c1')
    expect(slots.chatHolder('c1')).toBeUndefined()
    expect(slots.tryClaimChat('c1', 'u2')).toBe(true)
  })

  it('占用失败不改动既有持有者', () => {
    const slots = make()
    slots.tryClaimChat('c1', 'u1')
    slots.tryClaimChat('c1', 'u2')
    expect(slots.chatHolder('c1')).toBe('u1')
  })

  it('不同会话互不影响；会话占用与用户并发计数各自独立', () => {
    const slots = make('1')
    expect(slots.tryClaimChat('c1', 'u1')).toBe(true)
    expect(slots.tryClaimChat('c2', 'u1')).toBe(true)
    expect(slots.activeCount('u1')).toBe(0)
  })
})
