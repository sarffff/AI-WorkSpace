import { throttleTracker } from './throttle-tracker'

// 行为依据（与实现一致）：
// - ThrottlerGuard 早于路由级 JwtAuthGuard 执行，那时 req.user 尚未注入 → 身份取自 Authorization
// - 有 Bearer 令牌：按令牌哈希分桶（同一用户稳定同桶，不同用户互不影响）
// - 无令牌（登录前/健康探针）：退回 IP
// - 键里不得出现明文凭证：哈希截取，避免日志与内存留下可用 token

describe('throttleTracker', () => {
  const reqWith = (headers: Record<string, unknown>) =>
    ({ headers, ip: '10.0.0.1' }) as unknown as Record<string, unknown>

  it('同一令牌稳定落同一桶', () => {
    const a = throttleTracker(reqWith({ authorization: 'Bearer tok-1' }))
    const b = throttleTracker(reqWith({ authorization: 'Bearer tok-1' }))
    expect(a).toBe(b)
    expect(a.startsWith('u:')).toBe(true)
  })

  it('不同用户即使在同一个出口 IP 也分桶（办公室共享 IP 不能被互相拖累）', () => {
    const a = throttleTracker(reqWith({ authorization: 'Bearer tok-1' }))
    const b = throttleTracker(reqWith({ authorization: 'Bearer tok-2' }))
    expect(a).not.toBe(b)
  })

  it('键中不含明文令牌', () => {
    const key = throttleTracker(reqWith({ authorization: 'Bearer super-secret-token' }))
    expect(key).not.toContain('super-secret-token')
  })

  it('无 Authorization 头 → 按 IP 分桶', () => {
    expect(throttleTracker(reqWith({}))).toBe('ip:10.0.0.1')
  })

  it('空 Authorization 不算身份，仍回退 IP', () => {
    expect(throttleTracker(reqWith({ authorization: '   ' }))).toBe('ip:10.0.0.1')
  })

  it('既无令牌也无 IP → 落到 unknown 而不是崩溃', () => {
    expect(throttleTracker({} as Record<string, unknown>)).toBe('ip:unknown')
  })
})
