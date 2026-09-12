import { NotFoundException } from '@nestjs/common'
import { AgentToolRegistry } from './registry.service'
import type { AgentTool, ToolContext, ToolResult } from './types'

// 行为依据（与实现一致）：
// - definitions() 由 schema 生成，顺序即注册顺序
// - 未知工具 / 参数不合 schema / 工具抛异常 → 一律返回 { result: { error } }，绝不抛出
// - arguments 解析失败按空参数走校验（缺必填即报参数错误）
// - isReadOnly 未知工具按写处理（保守：不并发未知副作用）

const ctx: ToolContext = { owner: { id: 'u1', role: 'employee', department: 'IT' } }

// 可控替身工具：记录收到的参数，可配置抛错
class FakeTool implements AgentTool<typeof FakeTool.schema> {
  readonly name = 'fake_tool'
  readonly description = 'fake'
  readonly readOnly = true
  static readonly schema = {
    query: { type: 'string', description: 'q', required: true, nonEmpty: true },
    limit: { type: 'number', description: 'n', min: 1, max: 5, int: true },
  } as const
  readonly schema = FakeTool.schema

  received: unknown = null
  throwErr: Error | null = null

  async execute(args: { query: string; limit?: number }): Promise<ToolResult> {
    this.received = args
    if (this.throwErr) throw this.throwErr
    return { result: { echo: args.query }, summary: `echo ${args.query}` }
  }
}

class FakeWriteTool implements AgentTool<typeof FakeWriteTool.schema> {
  readonly name = 'fake_write'
  readonly description = 'write'
  readonly readOnly = false
  static readonly schema = {
    title: { type: 'string', description: 't', required: true, nonEmpty: true },
  } as const
  readonly schema = FakeWriteTool.schema

  async execute(): Promise<ToolResult> {
    return { result: { done: true }, summary: 'done' }
  }
}

describe('AgentToolRegistry', () => {
  let tool: FakeTool
  let registry: AgentToolRegistry

  beforeEach(() => {
    tool = new FakeTool()
    registry = new AgentToolRegistry([tool, new FakeWriteTool()])
  })

  describe('definitions', () => {
    it('按注册顺序生成 function calling 定义，parameters 由 schema 推导', () => {
      const defs = registry.definitions()
      expect(defs.map((d) => d.function.name)).toEqual(['fake_tool', 'fake_write'])
      expect(defs[0].function.parameters).toEqual({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'q' },
          limit: { type: 'number', description: 'n' },
        },
        required: ['query'],
      })
    })
  })

  describe('isReadOnly', () => {
    it.each([
      ['纯读工具', 'fake_tool', true],
      ['写工具', 'fake_write', false],
      ['未知工具按写处理', 'nope', false],
    ])('%s', (_label, name, expected) => {
      expect(registry.isReadOnly(name)).toBe(expected)
    })
  })

  describe('execute 正常路径', () => {
    it('把校验后的参数（trim/夹紧/取整）交给工具', async () => {
      const res = await registry.execute('fake_tool', '{"query":"  hi  ","limit":9.7}', ctx)
      expect(tool.received).toEqual({ query: 'hi', limit: 5 })
      expect(res.result).toEqual({ echo: 'hi' })
      expect(res.summary).toBe('echo hi')
    })
  })

  describe('execute 边界处理', () => {
    it('未知工具返回结构化错误而不抛出', async () => {
      const res = await registry.execute('no_such_tool', '{}', ctx)
      expect(res.result).toEqual({ error: '未知工具: no_such_tool' })
      expect(res.summary).toBe('未知工具 no_such_tool')
    })

    it.each([
      ['非法 JSON', 'not json at all'],
      ['截断的 JSON', '{"query":'],
      ['空字符串', ''],
      ['undefined', undefined],
    ])('arguments 为 %s 时按空参数走校验，报缺必填而非解析错误', async (_label, raw) => {
      const res = await registry.execute('fake_tool', raw, ctx)
      expect(res.summary).toBe('参数错误')
      expect((res.result as { error: string }).error).toContain('query')
      expect(tool.received).toBeNull() // 未进入工具实现
    })

    it.each([
      ['JSON 数组', '["query"]'],
      ['JSON null', 'null'],
      ['JSON 字符串', '"query=x"'],
    ])('arguments 为 %s 时报「必须是 JSON 对象」', async (_label, raw) => {
      const res = await registry.execute('fake_tool', raw, ctx)
      expect((res.result as { error: string }).error).toContain('必须是 JSON 对象')
      expect(tool.received).toBeNull()
    })

    it('工具抛异常时转结构化错误回传（不中断工具循环）', async () => {
      tool.throwErr = new Error('下游超时')
      const res = await registry.execute('fake_tool', '{"query":"x"}', ctx)
      expect(res.result).toEqual({ error: '下游超时' })
      expect(res.summary).toBe('执行失败')
    })

    it('工具抛 NotFoundException（越权/不存在）时按错误回传消息', async () => {
      tool.throwErr = new NotFoundException('工单不存在')
      const res = await registry.execute('fake_tool', '{"query":"x"}', ctx)
      expect((res.result as { error: string }).error).toBe('工单不存在')
    })

    it('工具抛非 Error 时给出兜底文案', async () => {
      tool.throwErr = 'boom' as unknown as Error
      const res = await registry.execute('fake_tool', '{"query":"x"}', ctx)
      expect(res.result).toEqual({ error: '工具执行失败' })
    })
  })
})
