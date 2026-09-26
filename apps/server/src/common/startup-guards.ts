import { Logger } from '@nestjs/common'

// ===== 启动期安全配置校验 =====
//
// JWT 密钥在 auth.module / jwt.strategy 里都有 'dev-secret' 兜底 —— 那对本地开发是便利，
// 但一旦被带上生产就是「任何人可自签 token 冒充任意用户（含 admin）」。
// 这里在真正 listen 之前拦一道：生产环境缺密钥直接拒绝启动，而不是默默用兜底值跑起来。

const INSECURE_DEV_SECRET = 'dev-secret'

export function assertRuntimeSecrets(env: string | undefined, jwtSecret: string | undefined): void {
  const secret = jwtSecret?.trim()
  const isProduction = ['production', 'prod'].includes((env ?? '').trim().toLowerCase())

  if (isProduction) {
    if (!secret || secret === INSECURE_DEV_SECRET) {
      throw new Error(
        '拒绝启动：NODE_ENV=production 时必须设置足够强的 JWT_SECRET（不允许使用开发兜底值）',
      )
    }
    return
  }

  if (!secret || secret === INSECURE_DEV_SECRET) {
    new Logger('Security').warn(
      'JWT_SECRET 未设置，正在使用开发兜底值 —— 切勿带到生产：' +
        '该值可被用来自签任意用户（含 admin）的 token',
    )
  }
}

// CORS 默认放行所有来源，是桌面形态决定的：打包后的渲染层以 file:// 运行，
// 浏览器发出的 Origin 是 null，收紧成白名单会直接把客户端打断。
// 鉴权走 Authorization: Bearer 而非 cookie，跨站页面拿不到令牌，因此放行带来的
// 实际暴露有限。需要收紧时（例如接入网页端）用 CORS_ORIGIN 配逗号分隔的白名单。
export function resolveCorsOrigin(raw: string | undefined): true | string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length === 0 || list.includes('*')) return true
  return list
}
