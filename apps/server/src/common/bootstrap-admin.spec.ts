import {
  decideAdminBootstrap,
  DEFAULT_ADMIN_EMAIL,
  MIN_BOOTSTRAP_PASSWORD,
} from './bootstrap-admin'

// 行为依据（与实现一致）：
// - 只在「用户表为空」且「显式提供 BOOTSTRAP_ADMIN_PASSWORD」时创建初始管理员
// - 已有用户的库一律不动：旧实现每次启动都 upsert，会把管理员改过的密码重置回 123456
// - 口令短于 MIN_BOOTSTRAP_PASSWORD 直接拒绝，防止原地复活弱口令管理员
// - 邮箱缺省回退 DEFAULT_ADMIN_EMAIL，与 eval:retrieval / eval:agent 的默认视角保持一致

describe('decideAdminBootstrap', () => {
  it('空库 + 合格口令 → 创建，邮箱可指定', () => {
    expect(
      decideAdminBootstrap({ userCount: 0, password: 'str0ng-pass', email: 'ops@corp.cn' }),
    ).toEqual({ action: 'create', email: 'ops@corp.cn' })
  })

  it('空库 + 合格口令但未给邮箱 → 用默认管理员邮箱', () => {
    expect(decideAdminBootstrap({ userCount: 0, password: 'str0ng-pass' })).toEqual({
      action: 'create',
      email: DEFAULT_ADMIN_EMAIL,
    })
  })

  it('已有用户 → 一律跳过（即使给了口令）', () => {
    expect(
      decideAdminBootstrap({ userCount: 4, password: 'str0ng-pass', email: 'ops@corp.cn' }),
    ).toEqual({ action: 'skip', reason: 'users-exist' })
  })

  it('空库但没给口令 → 跳过并说明原因', () => {
    expect(decideAdminBootstrap({ userCount: 0 })).toEqual({
      action: 'skip',
      reason: 'no-password',
    })
    expect(decideAdminBootstrap({ userCount: 0, password: '   ' })).toEqual({
      action: 'skip',
      reason: 'no-password',
    })
  })

  it('口令过短 → 拒绝创建（弱口令门槛正是这次改动要消灭的东西）', () => {
    expect(decideAdminBootstrap({ userCount: 0, password: '123456' })).toEqual({
      action: 'skip',
      reason: 'weak-password',
    })
    expect(
      decideAdminBootstrap({
        userCount: 0,
        password: 'x'.repeat(MIN_BOOTSTRAP_PASSWORD - 1),
      }),
    ).toEqual({ action: 'skip', reason: 'weak-password' })
    expect(
      decideAdminBootstrap({ userCount: 0, password: 'x'.repeat(MIN_BOOTSTRAP_PASSWORD) }),
    ).toEqual({ action: 'create', email: DEFAULT_ADMIN_EMAIL })
  })
})
