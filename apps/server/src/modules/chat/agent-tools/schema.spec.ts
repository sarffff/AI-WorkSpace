import { toJsonSchema, validateArgs, type ToolSchema } from './schema'

// 行为依据（与实现一致）：
// - 非对象参数（null/数组/字符串）→ 整体守卫报错，文案含工具名
// - 必填缺失/类型不符 → 参数错误（字段自带 message 优先）
// - 可选字段缺失或类型不符且无 fallback → 按未传处理（不报错）
// - fallback 存在时非法取值回退默认，不报错
// - maxLength 截断、min/max 夹紧、int 取整均不报错

const schema = {
  query: {
    type: 'string',
    description: 'q',
    required: true,
    nonEmpty: true,
    maxLength: 5,
    message: '参数错误: query 必须是非空字符串，请修正参数后重试',
  },
  status: {
    type: 'string',
    description: 's',
    enum: ['open', 'closed'],
    nonEmpty: true,
    message: '参数错误: status 必须是 open/closed 之一，请修正参数后重试',
  },
  priority: {
    type: 'string',
    description: 'p',
    enum: ['low', 'normal'],
    fallback: 'normal',
  },
  topK: { type: 'number', description: 'k', min: 1, max: 10, int: true },
  verbose: { type: 'boolean', description: 'v' },
} as const satisfies ToolSchema

describe('validateArgs 整体守卫', () => {
  it.each([
    ['null', null],
    ['数组', ['a']],
    ['字符串', 'query=x'],
    ['数字', 42],
  ])('参数为 %s 时报「必须是 JSON 对象」并带上工具名', (_label, raw) => {
    const res = validateArgs('search_knowledge', schema, raw)
    expect(res.ok).toBe(false)
    expect(res.error).toBe('参数错误: search_knowledge 的参数必须是 JSON 对象，请修正后重试')
  })
})

describe('validateArgs 必填字段', () => {
  it('缺失必填字段时回传该字段的错误文案', () => {
    const res = validateArgs('search_knowledge', schema, {})
    expect(res.ok).toBe(false)
    expect(res.error).toBe('参数错误: query 必须是非空字符串，请修正参数后重试')
  })

  it.each([
    ['数字', 123],
    ['对象', { a: 1 }],
    ['空字符串', ''],
    ['纯空白', '   '],
  ])('必填字段为 %s 时报参数错误', (_label, value) => {
    const res = validateArgs('search_knowledge', schema, { query: value })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('query')
  })

  it('通过后 trim 并按 maxLength 截断（不报错）', () => {
    const res = validateArgs('search_knowledge', schema, { query: '  abcdefgh  ' })
    expect(res.ok).toBe(true)
    expect(res.args?.query).toBe('abcde')
  })
})

describe('validateArgs 可选字段', () => {
  it('缺失时不报错且不出现在结果里', () => {
    const res = validateArgs('t', schema, { query: 'x' })
    expect(res.ok).toBe(true)
    expect(res.args).not.toHaveProperty('status')
  })

  it('类型不符且无 fallback 时按未传处理（不报错）', () => {
    const res = validateArgs('t', schema, { query: 'x', status: 123 })
    expect(res.ok).toBe(true)
    expect(res.args).not.toHaveProperty('status')
  })

  it('枚举外取值且无 fallback 时报参数错误（幻觉参数需模型修正）', () => {
    const res = validateArgs('t', schema, { query: 'x', status: 'pending' })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('参数错误: status 必须是 open/closed 之一，请修正参数后重试')
  })

  it('枚举内取值正常通过', () => {
    const res = validateArgs('t', schema, { query: 'x', status: 'open' })
    expect(res.ok).toBe(true)
    expect(res.args?.status).toBe('open')
  })
})

describe('validateArgs fallback 字段', () => {
  it.each([
    ['枚举外字符串', 'urgent'],
    ['数字', 5],
    ['缺失', undefined],
  ])('%s 时回退默认值且不报错', (_label, value) => {
    const res = validateArgs('t', schema, { query: 'x', priority: value })
    expect(res.ok).toBe(true)
    expect(res.args?.priority).toBe('normal')
  })

  it('合法取值不被 fallback 覆盖', () => {
    const res = validateArgs('t', schema, { query: 'x', priority: 'low' })
    expect(res.args?.priority).toBe('low')
  })
})

describe('validateArgs 数字与布尔', () => {
  it('越界夹紧到 [min, max] 并取整', () => {
    expect(validateArgs('t', schema, { query: 'x', topK: 99 }).args?.topK).toBe(10)
    expect(validateArgs('t', schema, { query: 'x', topK: -3 }).args?.topK).toBe(1)
    expect(validateArgs('t', schema, { query: 'x', topK: 3.6 }).args?.topK).toBe(4)
  })

  it.each([
    ['NaN', NaN],
    ['字符串', '3'],
    ['Infinity', Infinity],
  ])('非有限数字 %s 按未传处理（可选且无 fallback）', (_label, value) => {
    const res = validateArgs('t', schema, { query: 'x', topK: value })
    expect(res.ok).toBe(true)
    expect(res.args).not.toHaveProperty('topK')
  })

  it('布尔字段仅接受真布尔值', () => {
    expect(validateArgs('t', schema, { query: 'x', verbose: true }).args?.verbose).toBe(true)
    expect(validateArgs('t', schema, { query: 'x', verbose: 'true' }).args).not.toHaveProperty(
      'verbose',
    )
  })
})

describe('toJsonSchema', () => {
  it('生成 OpenAI function calling 的 parameters，required 只含必填项', () => {
    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'q' },
        status: { type: 'string', description: 's', enum: ['open', 'closed'] },
        priority: { type: 'string', description: 'p', enum: ['low', 'normal'] },
        topK: { type: 'number', description: 'k' },
        verbose: { type: 'boolean', description: 'v' },
      },
      required: ['query'],
    })
  })

  it('无必填字段时不带 required 键（空数组会被部分兼容层拒绝）', () => {
    const optionalOnly = { status: { type: 'string', description: 's' } } as const
    expect(toJsonSchema(optionalOnly)).not.toHaveProperty('required')
  })
})
