import { Injectable } from '@nestjs/common'
import { KnowledgeService } from '@/modules/knowledge/knowledge.service'
import { TicketsService } from '@/modules/tickets/tickets.service'
import type { InferArgs } from './schema'
import type { AgentTool, ToolContext, ToolResult } from './types'

// ===== 纯读工具：无副作用、不触发 HITL，同一轮内可并行执行 =====
//
// 校验交由 schema（registry 统一执行），异常交由 registry 统一转结构化错误 ——
// 工具实现只负责「拿到干净参数后做正事」。

const TICKET_STATUSES = ['open', 'processing', 'resolved', 'closed'] as const

@Injectable()
export class SearchKnowledgeTool implements AgentTool<typeof SearchKnowledgeTool.schema> {
  readonly name = 'search_knowledge'
  readonly description =
    '检索当前用户权限可见的企业知识库，返回最相关的文档片段（含文档名与相似度）。回答 IT/制度/流程类问题前应先调用。'
  readonly readOnly = true

  static readonly schema = {
    query: {
      type: 'string',
      description: '检索关键词或完整问题',
      required: true,
      nonEmpty: true,
      maxLength: 200,
      message: '参数错误: query 必须是非空字符串，请修正参数后重试',
    },
  } as const

  readonly schema = SearchKnowledgeTool.schema

  constructor(private readonly knowledgeService: KnowledgeService) {}

  async execute(
    args: InferArgs<typeof SearchKnowledgeTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // topK 不传：由 Setting 表 ragTopK 决定
    const hits = await this.knowledgeService.searchRelevant(ctx.owner, args.query)
    return {
      result:
        hits.length > 0
          ? hits.map((h) => ({
              documentName: h.documentName,
              sectionPath: h.sectionPath ?? null,
              score: h.score,
              content: h.content.slice(0, 500),
            }))
          : { message: '知识库中未检索到相关内容' },
      summary: `"${args.query}" · 命中 ${hits.length} 片段`,
      sources: hits,
    }
  }
}

@Injectable()
export class LookupMyTicketsTool implements AgentTool<typeof LookupMyTicketsTool.schema> {
  readonly name = 'lookup_my_tickets'
  readonly description =
    '查询当前用户自己创建的工单列表（含状态、优先级、受理坐席、最近动态，按更新时间倒序）。用户询问自己工单状态/进度/处理结果时调用，不要凭空回答。'
  readonly readOnly = true

  static readonly schema = {
    status: {
      type: 'string',
      description: '可选：按工单状态过滤；不传返回全部工单',
      enum: TICKET_STATUSES,
      nonEmpty: true,
      message: '参数错误: status 必须是 open/processing/resolved/closed 之一，请修正参数后重试',
    },
  } as const

  readonly schema = LookupMyTicketsTool.schema

  constructor(private readonly ticketsService: TicketsService) {}

  async execute(
    args: InferArgs<typeof LookupMyTicketsTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // 复用 TicketsService.list 的行级可见性，再收窄到当前用户自己创建的工单
    const all = await this.ticketsService.list(ctx.owner)
    const tickets = all
      .filter((t) => t.creatorId === ctx.owner.id)
      .filter((t) => !args.status || t.status === args.status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    return {
      result: {
        total: tickets.length,
        tickets: tickets.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee?.name ?? null,
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
          latestComment: t.comments[0]
            ? {
                kind: t.comments[0].kind,
                content: t.comments[0].content.slice(0, 200),
                createdAt: t.comments[0].createdAt.toISOString(),
              }
            : null,
        })),
      },
      summary: `我的工单 ${tickets.length} 条`,
    }
  }
}

@Injectable()
export class GetTicketTool implements AgentTool<typeof GetTicketTool.schema> {
  readonly name = 'get_ticket'
  readonly description =
    '按工单编号查询单条工单详情（状态、优先级、受理坐席、最近评论）。用户询问某个具体工单的情况时调用，不要凭空回答。'
  readonly readOnly = true

  static readonly schema = {
    id: {
      type: 'string',
      description: '工单编号',
      required: true,
      nonEmpty: true,
      message: '参数错误: id 必须为工单编号字符串，请修正参数后重试',
    },
  } as const

  readonly schema = GetTicketTool.schema

  constructor(private readonly ticketsService: TicketsService) {}

  async execute(
    args: InferArgs<typeof GetTicketTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // 复用 TicketsService.detail 的可见性校验（员工仅本人，坐席/管理员全部）；
    // 不存在/越权时抛 NotFoundException，由 registry 统一转结构化错误回传模型
    const ticket = await this.ticketsService.detail(ctx.owner, args.id)
    return {
      result: {
        id: ticket.id,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        content: ticket.content.slice(0, 500),
        assignee: ticket.assignee?.name ?? null,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
        recentComments: ticket.comments.slice(-2).map((c) => ({
          kind: c.kind,
          author: c.author?.name ?? null,
          content: c.content.slice(0, 200),
          createdAt: c.createdAt.toISOString(),
        })),
      },
      summary: `工单「${ticket.title}」(${ticket.status})`,
    }
  }
}
