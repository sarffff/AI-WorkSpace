import { Injectable, Logger } from '@nestjs/common'
import { TicketsService } from '@/modules/tickets/tickets.service'
import type { InferArgs } from './schema'
import type { AgentTool, ToolContext, ToolResult } from './types'

// ===== 工单写回工具：对「已存在的工单」动手（追加留言 / 关闭）=====
//
// create_ticket 之外的两个写工具。二者的副作用都作用在用户自己已有的工单上，
// 可见性/归属由 TicketsService 的行级校验兜底（detail/addComment 内部走 getVisibleTicket）。
//
// 为什么不挂 HITL 确认门：
// - add_ticket_comment：往自己工单的时间线上补一句话，坐席可见、可回退，属低风险；
// - close_my_ticket：只关本人创建的工单，坐席仍可重新打开，等于自助结单。
// create_ticket 之所以要确认，是因为它凭空造出一条进坐席队列、不可撤销的新工单，
// 且模型有过度升级的倾向；对「用户点名要动自己某张单」这类明确诉求，确认门只是徒增摩擦。
// 两者都做了严格的前置校验（存在性、归属、状态）并写入时间线留痕，判错也追得回来。
//
// evalMode：与 create_ticket 一致，只记录意图、不产生任何外部副作用。

@Injectable()
export class AddTicketCommentTool implements AgentTool<typeof AddTicketCommentTool.schema> {
  private readonly logger = new Logger(AddTicketCommentTool.name)

  readonly name = 'add_ticket_comment'
  readonly description =
    '在用户已有工单的时间线上追加一条留言（补充信息、追问进度、说明情况）。仅在用户明确要对某张已存在的工单留言时调用；需先用 lookup_my_tickets 或 get_ticket 拿到工单编号并确认是哪一张。不要用它创建新工单（那用 create_ticket），也不要用它查询工单状态。'
  readonly readOnly = false

  static readonly schema = {
    id: {
      type: 'string',
      description: '目标工单编号（来自 lookup_my_tickets / get_ticket 的返回）',
      required: true,
      nonEmpty: true,
      message: '参数错误: id 必须为工单编号字符串，请修正参数后重试',
    },
    content: {
      type: 'string',
      description: '要追加到时间线的留言内容，转述用户要补充的信息',
      required: true,
      nonEmpty: true,
      maxLength: 1000,
      message: '参数错误: content 必须为非空字符串，请修正参数后重试',
    },
  } as const

  readonly schema = AddTicketCommentTool.schema

  constructor(private readonly ticketsService: TicketsService) {}

  async execute(
    args: InferArgs<typeof AddTicketCommentTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (ctx.evalMode) {
      return {
        result: { evaluation: 'add_ticket_comment intent recorded' },
        summary: '评测：记录追加评论意图（不写库）',
      }
    }
    // 可见性/归属交由 addComment 内部的 getVisibleTicket 兜底：
    // 员工只能给自己的工单留言，越权/不存在抛 NotFound，由 registry 转结构化错误回传模型
    await this.ticketsService.addComment(ctx.owner, args.id, { content: args.content })
    this.logger.log(`agent added comment to ticket ${args.id} for user ${ctx.owner.id}`)
    return {
      result: { ticketId: args.id, status: '已在工单时间线追加留言' },
      summary: `已追加留言到工单 ${args.id.slice(0, 8)}`,
    }
  }
}

@Injectable()
export class CloseMyTicketTool implements AgentTool<typeof CloseMyTicketTool.schema> {
  private readonly logger = new Logger(CloseMyTicketTool.name)

  readonly name = 'close_my_ticket'
  readonly description =
    '关闭用户本人创建的工单。仅在用户明确表示某张工单的问题已解决、要求关闭时调用；需先用 lookup_my_tickets / get_ticket 拿到工单编号并与用户确认是哪一张。只能关闭用户本人创建的工单，不能处理他人工单，也不能改成其他状态。'
  readonly readOnly = false

  static readonly schema = {
    id: {
      type: 'string',
      description: '要关闭的工单编号（来自 lookup_my_tickets / get_ticket 的返回）',
      required: true,
      nonEmpty: true,
      message: '参数错误: id 必须为工单编号字符串，请修正参数后重试',
    },
  } as const

  readonly schema = CloseMyTicketTool.schema

  constructor(private readonly ticketsService: TicketsService) {}

  async execute(
    args: InferArgs<typeof CloseMyTicketTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (ctx.evalMode) {
      return {
        result: { evaluation: 'close_my_ticket intent recorded' },
        summary: '评测：记录关单意图（不写库）',
      }
    }
    // detail 内部的可见性校验：员工仅本人、坐席/管理员全部；不存在/越权抛 NotFound
    const ticket = await this.ticketsService.detail(ctx.owner, args.id)
    // 「my」的硬边界：即便坐席能看到全部工单，助手也只替本人关自己的单，
    // 避免坐席顺口一句让助手误关了别人的工单（坐席要关他人工单走工单页的正规操作）
    if (ticket.creator.id !== ctx.owner.id) {
      return {
        result: { error: '该工单不是您本人创建的，助手不能替您关闭他人的工单。' },
        summary: '非本人工单，拒绝关闭',
      }
    }
    // 幂等：已关闭直接告知，不重复写库/写时间线
    if (ticket.status === 'closed') {
      return {
        result: {
          ticketId: ticket.id,
          status: 'closed',
          message: '工单已是关闭状态，无需重复关闭',
        },
        summary: `工单「${ticket.title}」已关闭`,
      }
    }
    // 复用 update 的关单路径：写入「状态变更为『已关闭』」系统事件，坐席仍可重新打开
    await this.ticketsService.update(ctx.owner, args.id, { status: 'closed' })
    this.logger.log(`agent closed ticket ${args.id} for user ${ctx.owner.id}`)
    return {
      result: { ticketId: ticket.id, status: 'closed', message: '工单已关闭' },
      summary: `已关闭工单「${ticket.title}」`,
    }
  }
}
