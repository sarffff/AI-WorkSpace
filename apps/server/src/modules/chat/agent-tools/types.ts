import type { RagHit } from '@/modules/knowledge/knowledge.service'
import type { InferArgs, ToolSchema } from './schema'

// ===== Agent 工具契约 =====
//
// 新增一个工具 = 新增一个实现 AgentTool 的 @Injectable 类并登记进 AGENT_TOOLS
// （原先需要改三处：agentTools() 注册表、execTool() 的 if 链、READ_TOOLS 集合）。

export interface TicketRef {
  id: string
  title: string
}

// 建单草稿内容（不含 requestId）：工具产出 → 确认门 → 落库重建工单的载荷
export interface TicketDraftInput {
  title: string
  content: string
  priority: string
  category: string
}

// 建单确认事件：Agent 决定建单 → 推草稿给用户 → 暂停等待确认/取消
export interface TicketDraft extends TicketDraftInput {
  requestId: string
}

export interface ToolOwner {
  id: string
  role: string
  department: string | null
}

export interface ToolContext {
  owner: ToolOwner
  chatId?: string
  /** 本会话已建工单：建单幂等守卫（存在则 create_ticket 直接短路） */
  createdTicket?: TicketRef
  /**
   * HITL 确认门：create_ticket 校验通过后调用，注册待确认草稿。
   * 实际建单由生成器层在用户确认后执行（yield 只能发生在生成器内）。
   */
  registerConfirm?: (draft: TicketDraftInput) => void
  /** 评测模式：写工具仅记录意图，不产生任何外部副作用 */
  evalMode?: boolean
}

export interface ToolResult {
  /** 回传给模型的结果（JSON 序列化后作为 tool 消息内容） */
  result: unknown
  /** 前端轨迹摘要 */
  summary: string
  /** 引用溯源副产物 */
  sources?: RagHit[]
  /** 建单副产物 */
  ticket?: TicketRef
  /** 需要用户确认（HITL）：由生成器层推 confirm_required 事件并阻塞 */
  needsConfirm?: boolean
}

export interface AgentTool<S extends ToolSchema = ToolSchema> {
  readonly name: string
  readonly description: string
  readonly schema: S
  /**
   * 纯读工具（无副作用、不触发 HITL）：同一轮内可并行执行。
   * 写工具串行且排在读工具之后 —— 确认门的 yield 会阻塞。
   */
  readonly readOnly: boolean
  execute(args: InferArgs<S>, ctx: ToolContext): Promise<ToolResult>
}

/** DI 多提供者令牌：所有工具实现由此注入注册表 */
export const AGENT_TOOLS = Symbol('AGENT_TOOLS')
