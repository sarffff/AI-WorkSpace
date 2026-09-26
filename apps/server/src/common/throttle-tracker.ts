import { createHash } from 'crypto'
import type { ExecutionContext } from '@nestjs/common'

// ThrottlerGuard 注册为全局守卫，早于路由级 JwtAuthGuard 执行 —— 那时 req.user 还没注入，
// 所以身份只能从 Authorization 头取，取不到才退回 IP。
//
// 按用户分桶是必须的：桌面客户端场景下整个办公室通常共用一个出口 IP，
// 若按 IP 限流，全公司加起来会共享同一个配额，第 10 个人提问就把前面的人全限掉。
// 这里对令牌做单向哈希而不是明文拼接：日志与内存键里都不该留下可用的凭证。
export function throttleTracker(req: Record<string, unknown>, _context?: ExecutionContext): string {
  const headers = req?.headers as Record<string, unknown> | undefined
  const auth = (headers?.authorization ?? req?.authorization) as string | undefined
  if (typeof auth === 'string' && auth.trim()) {
    return `u:${createHash('sha1').update(auth).digest('hex').slice(0, 16)}`
  }
  const socket = req?.socket as { remoteAddress?: string } | undefined
  return `ip:${String(req?.ip ?? socket?.remoteAddress ?? 'unknown')}`
}
