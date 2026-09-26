import { assertRuntimeSecrets, resolveCorsOrigin } from './startup-guards'

// 行为依据（与实现一致）：
// - NODE_ENV=production|prod 且 JWT_SECRET 缺失或等于开发兜底值 → 抛错拒绝启动
// - 非生产环境只 warn 不抛，保留本地零配置可跑
// - CORS 缺省放行（桌面端 file:// 的 Origin 是 null，白名单会打断打包客户端）
// - CORS_ORIGIN 给了逗号分隔列表 → 只放行列表内来源；列表含 * 视为全放行

describe('assertRuntimeSecrets', () => {
  it('生产环境缺 JWT_SECRET → 拒绝启动', () => {
    expect(() => assertRuntimeSecrets('production', undefined)).toThrow(/拒绝启动/)
    expect(() => assertRuntimeSecrets('PROD', '   ')).toThrow(/拒绝启动/)
  })

  it('生产环境沿用开发兜底密钥 → 同样拒绝', () => {
    expect(() => assertRuntimeSecrets('production', 'dev-secret')).toThrow(/拒绝启动/)
  })

  it('生产环境给了自定密钥 → 通过', () => {
    expect(() => assertRuntimeSecrets('production', 'a-real-secret')).not.toThrow()
  })

  it('开发环境缺密钥 → 不抛（仅告警），零配置仍可启动', () => {
    expect(() => assertRuntimeSecrets('development', undefined)).not.toThrow()
    expect(() => assertRuntimeSecrets(undefined, undefined)).not.toThrow()
  })
})

describe('resolveCorsOrigin', () => {
  it('未配置 / 空串 / 含 * → 放行所有来源', () => {
    expect(resolveCorsOrigin(undefined)).toBe(true)
    expect(resolveCorsOrigin('  ')).toBe(true)
    expect(resolveCorsOrigin('https://a.cn, *')).toBe(true)
  })

  it('逗号分隔列表 → 精确白名单，去空去空白', () => {
    expect(resolveCorsOrigin('https://a.cn, https://b.cn ,')).toEqual([
      'https://a.cn',
      'https://b.cn',
    ])
  })

  it('单一来源 → 长度为 1 的白名单而不是全放行', () => {
    expect(resolveCorsOrigin('https://only.cn')).toEqual(['https://only.cn'])
  })
})
