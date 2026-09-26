import { Logger } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import type { PrismaService } from '@/prisma/prisma.service'

// ===== 首启管理员引导 =====
//
// 旧实现是每次启动无条件 upsert 一个 admin：default@example.com / 密码 123456。
// 两个后果都很糟：企业系统的管理员口令长期是公开的 123456；而且 upsert 的 update
// 分支会在每次重启把管理员改过的密码重置回 123456 —— 改了也没用。
//
// 现在只在「库里一个用户都没有」且「运维显式给了密码」时创建一次。
// 判据与创建分离成纯函数 + 执行器，前者可直接单测。

// 保持与既有评测脚本一致：eval:retrieval / eval:agent 默认以该邮箱视角跑
export const DEFAULT_ADMIN_EMAIL = 'default@example.com'

// 引导口令的最低长度：低于此值直接拒绝，避免有人把 BOOTSTRAP_ADMIN_PASSWORD 设成 123456
// 从而原地复活老问题
export const MIN_BOOTSTRAP_PASSWORD = 8

export type BootstrapDecision =
  | { action: 'create'; email: string }
  | { action: 'skip'; reason: 'users-exist' | 'no-password' | 'weak-password' }

export function decideAdminBootstrap(input: {
  userCount: number
  password?: string | null
  email?: string | null
}): BootstrapDecision {
  if (input.userCount > 0) return { action: 'skip', reason: 'users-exist' }
  const password = input.password?.trim()
  if (!password) return { action: 'skip', reason: 'no-password' }
  if (password.length < MIN_BOOTSTRAP_PASSWORD) return { action: 'skip', reason: 'weak-password' }
  return { action: 'create', email: input.email?.trim() || DEFAULT_ADMIN_EMAIL }
}

export async function bootstrapAdmin(prisma: PrismaService): Promise<void> {
  const logger = new Logger('Bootstrap')
  const [userCount, adminCount] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
  ])

  const decision = decideAdminBootstrap({
    userCount,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  })

  if (decision.action === 'create') {
    await prisma.user.create({
      data: {
        email: decision.email,
        // id 交由 @default(uuid())：旧实现钉死 '000000'，等于给管理员一个可预测的主键
        password: await bcrypt.hash((process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '').trim(), 10),
        name: process.env.BOOTSTRAP_ADMIN_NAME || '系统管理员',
        role: 'admin',
      },
    })
    logger.log(
      `已创建初始管理员 ${decision.email}（仅因用户表为空，且取自 BOOTSTRAP_ADMIN_PASSWORD）`,
    )
    return
  }

  // 已有用户：正常情况，静默。空库但没给口令/口令太弱则是死路 —— 注册出来的第一个账号
  // 只是 employee（role 默认值），没人能进坐席与管理视图，必须明确提示。
  if (decision.reason === 'users-exist') {
    if (adminCount === 0) {
      logger.warn(
        '当前没有任何 admin 角色用户：知识库的「管理员可见全部」与坐席看板将不可用。' +
          '可将某用户的 User.role 改为 admin，或清空用户表后用 BOOTSTRAP_ADMIN_PASSWORD 重启引导。',
      )
    }
    return
  }
  logger.warn(
    decision.reason === 'weak-password'
      ? `拒绝创建初始管理员：BOOTSTRAP_ADMIN_PASSWORD 少于 ${MIN_BOOTSTRAP_PASSWORD} 位`
      : '用户表为空且未设置 BOOTSTRAP_ADMIN_PASSWORD：不会创建任何账号。' +
          '请设置该环境变量后重启以引导初始管理员（注册的首个账号只是普通员工）。',
  )
}
