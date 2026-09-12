import type { Provider } from '@nestjs/common'
import { AgentToolRegistry } from './registry.service'
import { CreateTicketTool } from './create-ticket.tool'
import { GetTicketTool, LookupMyTicketsTool, SearchKnowledgeTool } from './read-tools'
import { AGENT_TOOLS, type AgentTool } from './types'

export { AgentToolRegistry } from './registry.service'
export { CreateTicketTool } from './create-ticket.tool'
export { GetTicketTool, LookupMyTicketsTool, SearchKnowledgeTool } from './read-tools'
export { AGENT_TOOLS } from './types'
export type { AgentTool, TicketDraft, TicketRef, ToolContext, ToolOwner, ToolResult } from './types'
export type { Field, ToolSchema } from './schema'
export { toJsonSchema, validateArgs } from './schema'

// 工具实现清单：新增工具在此登记即可被注册表发现（模型可见 + 可调用）。
// 顺序即 definitions() 中呈现给模型的顺序。
const TOOL_CLASSES = [
  SearchKnowledgeTool,
  LookupMyTicketsTool,
  GetTicketTool,
  CreateTicketTool,
] as const

// DI 装配：各工具类 + 多提供者聚合 + 注册表
export const AGENT_TOOL_PROVIDERS: Provider[] = [
  ...TOOL_CLASSES,
  {
    provide: AGENT_TOOLS,
    useFactory: (...tools: AgentTool[]) => tools,
    inject: [...TOOL_CLASSES],
  },
  AgentToolRegistry,
]
