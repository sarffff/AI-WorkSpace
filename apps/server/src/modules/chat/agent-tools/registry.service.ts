import { Inject, Injectable, Logger } from '@nestjs/common'
import type OpenAI from 'openai'
import { toJsonSchema, validateArgs } from './schema'
import { AGENT_TOOLS, type AgentTool, type ToolContext, type ToolResult } from './types'

// ===== 工具注册表：模型可见的工具清单 + 统一调用入口 =====
//
// 集中承担原先散落在 execTool 里的边界处理：
// - 参数 JSON 解析失败 → 按空参数走 schema 校验（缺必填即回传参数错误）
// - 参数不合 schema → 结构化错误回传，模型下一轮自我修正
// - 未知工具 / 执行抛异常 → 结构化错误回传，绝不让异常打断工具循环
//
// 工具实现只处理「干净参数 + 正常路径」。

@Injectable()
export class AgentToolRegistry {
  private readonly logger = new Logger(AgentToolRegistry.name)
  private readonly tools: Map<string, AgentTool>

  constructor(@Inject(AGENT_TOOLS) tools: AgentTool[]) {
    this.tools = new Map(tools.map((t) => [t.name, t]))
  }

  /** 模型可见的工具定义（OpenAI function calling 格式，由 schema 生成） */
  definitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [...this.tools.values()].map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toJsonSchema(tool.schema),
      },
    }))
  }

  /**
   * 纯读工具判定（并行执行的依据）。
   * 未知工具按「写」处理：串行执行更保守，避免未知副作用被并发放大。
   */
  isReadOnly(name: string): boolean {
    return this.tools.get(name)?.readOnly ?? false
  }

  names(): string[] {
    return [...this.tools.keys()]
  }

  /**
   * 执行一次工具调用。rawArgs 为模型给出的原始 arguments 字符串。
   * 任何失败都以 { result: { error } } 返回而不抛出 —— 工具循环需要靠
   * 结构化错误驱动模型自我修正，一个工具失败不该中断整轮对话。
   */
  async execute(name: string, rawArgs: string | undefined, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { result: { error: `未知工具: ${name}` }, summary: `未知工具 ${name}` }
    }

    // 参数解析失败按空对象处理：由 schema 校验给出「缺少必填字段」的明确回执，
    // 比直接报 "invalid JSON" 更利于模型修正
    let parsed: unknown = {}
    if (rawArgs && rawArgs.trim()) {
      try {
        parsed = JSON.parse(rawArgs)
      } catch {
        parsed = {}
      }
    }

    const validated = validateArgs(name, tool.schema, parsed)
    if (!validated.ok) {
      return { result: { error: validated.error }, summary: '参数错误' }
    }

    try {
      return await tool.execute(validated.args, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : '工具执行失败'
      this.logger.error(`tool ${name} failed: ${message}`)
      return { result: { error: message }, summary: `执行失败` }
    }
  }
}
