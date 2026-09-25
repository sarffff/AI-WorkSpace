import { Injectable, Logger } from '@nestjs/common'
import { TicketsService } from '@/modules/tickets/tickets.service'
import { MemoryService } from '@/modules/memory/memory.service'
import {
  CATEGORY_DESCRIPTION,
  DEFAULT_TICKET_CATEGORY,
  TICKET_CATEGORIES,
} from '@/modules/tickets/ticket-taxonomy'
import type { InferArgs } from './schema'
import type { AgentTool, TicketDraftInput, TicketRef, ToolContext, ToolResult } from './types'

// ===== 建单工具（唯一的写工具）=====
//
// 副作用边界：工单一旦创建即不可回滚（SSE 断连、后续生成失败均不回滚）。
// 三重保护：
// 1) 幂等 —— ctx.createdTicket 存在则直接短路，本会话绝不重复建单；
// 2) HITL —— registerConfirm 存在时只登记草稿，实际建单由生成器层在用户确认后执行；
// 3) evalMode —— 评测只记录建单意图，不产生任何外部副作用。

@Injectable()
export class CreateTicketTool implements AgentTool<typeof CreateTicketTool.schema> {
  private readonly logger = new Logger(CreateTicketTool.name)

  readonly name = 'create_ticket'
  readonly description =
    '为用户创建人工处理工单，调用一次即可，不要重复调用。用户诉求明确需要人工操作时直接调用本工具、无需先检索或反复澄清确认，典型场景：账号/密码重置、权限开通/变更、硬件报修/更换、设备故障、需后台人工处理等；已有信息基本可推断时直接建单，个别缺失细节（如具体会议室、设备型号）写入 content 由人工跟进。知识库检索后仍无法解答的知识性问题也调用本工具升级人工。用户询问已有工单的状态/进度时不要调用本工具，改用 lookup_my_tickets 或 get_ticket 查询。'
  readonly readOnly = false

  static readonly schema = {
    title: {
      type: 'string',
      description:
        '工单标题，一句话概括用户诉求（60 字内），如「重置企业微信密码」「OA 开通管理员权限」',
      required: true,
      nonEmpty: true,
      maxLength: 80,
      message: '参数错误: title 必须为非空字符串，请修正参数后重试',
    },
    content: {
      type: 'string',
      description: '问题描述，写入用户已有信息（账号、设备、影响范围等）与期望结果',
      required: true,
      nonEmpty: true,
      maxLength: 2000,
      message: '参数错误: content 必须为非空字符串，请修正参数后重试',
    },
    priority: {
      type: 'string',
      description: '优先级，默认 normal',
      enum: ['low', 'normal', 'high', 'urgent'],
      // 枚举外取值（幻觉参数）回退默认，低风险不必报错
      fallback: 'normal',
    },
    category: {
      type: 'string',
      description: CATEGORY_DESCRIPTION,
      enum: TICKET_CATEGORIES,
      // 判错/漏填一律回退 other：分类错误不该打断建单（坐席可事后纠正）
      fallback: DEFAULT_TICKET_CATEGORY,
    },
  } as const

  readonly schema = CreateTicketTool.schema

  constructor(
    private readonly ticketsService: TicketsService,
    private readonly memoryService: MemoryService,
  ) {}

  async execute(
    args: InferArgs<typeof CreateTicketTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // 评测模式：只记录建单意图，避免评测污染线上数据（HITL 确认门同样跳过）
    if (ctx.evalMode) {
      return {
        result: { evaluation: 'create_ticket intent recorded' },
        summary: '评测：记录建单意图（不建单）',
      }
    }
    // 幂等：本会话已建单则不再重复创建，直接告知已有工单
    if (ctx.createdTicket) {
      return {
        result: {
          ticketId: ctx.createdTicket.id,
          title: ctx.createdTicket.title,
          status: '已创建，请勿重复建单，直接告知用户工单编号',
        },
        summary: `已存在工单「${ctx.createdTicket.title}」，跳过`,
      }
    }

    const draft: TicketDraftInput = {
      title: args.title,
      content: args.content,
      priority: args.priority ?? 'normal',
      category: args.category ?? DEFAULT_TICKET_CATEGORY,
    }
    // HITL 确认门：参数校验通过后交由生成器层确认（yield 事件只能在生成器内发生）
    if (ctx.registerConfirm) {
      ctx.registerConfirm(draft)
      return {
        result: null, // 占位：确认后由生成器层直接建单，不走本分支的建单逻辑
        summary: '等待用户确认',
        needsConfirm: true,
      }
    }

    // —— 建单副作用边界（不可回滚）——
    // 无确认门时（非 HITL 配置）在此直接落库建单。
    const ticket = await this.createFromDraft(ctx.owner.id, draft, ctx.chatId)
    this.logger.log(`agent created ticket "${ticket.title}" for user ${ctx.owner.id}`)
    return {
      result: { ticketId: ticket.id, title: ticket.title, status: '已创建，等待坐席受理' },
      summary: `"${ticket.title}"`,
      ticket,
    }
  }

  // 落库建单 + 写长期记忆的唯一入口：
  // 工具直建路径、生成器层确认后建单、断连后异步确认建单三处共用，
  // 避免「建单成功但忘了写记忆」之类的分叉。
  async createFromDraft(
    userId: string,
    draft: TicketDraftInput,
    chatId?: string,
  ): Promise<TicketRef> {
    const ticket = await this.ticketsService.create(userId, {
      title: draft.title,
      content: draft.content,
      priority: draft.priority,
      category: draft.category,
      source: 'agent',
    })
    // 长期记忆：工单记录跨会话可回溯（"上次的工单怎么样了"）
    await this.memoryService.remember(
      userId,
      'ticket',
      `于 ${new Date().toLocaleDateString('zh-CN')} 创建工单「${ticket.title}」，单号 ${ticket.id.slice(0, 8)}`,
      chatId,
    )
    return { id: ticket.id, title: ticket.title }
  }
}
