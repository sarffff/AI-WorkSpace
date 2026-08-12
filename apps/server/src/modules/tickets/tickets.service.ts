import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import { PrismaService } from '@/prisma/prisma.service'
import { KnowledgeService } from '@/modules/knowledge/knowledge.service'
import { SettingsService } from '@/modules/settings/settings.service'

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent'])
const STATUSES = new Set(['open', 'analyzing', 'pending_approval', 'resolved', 'closed'])

interface GeneratedSuggestion {
  summary: string
  reply: string
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name)

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settings: SettingsService,
    private knowledge: KnowledgeService,
  ) {}

  private async createClient() {
    const [apiUrl, apiKey] = await Promise.all([
      this.settings.get('LLM_API_URL'),
      this.settings.get('LLM_API_KEY'),
    ])
    return new OpenAI({
      baseURL:
        apiUrl || this.config.get<string>('LLM_API_URL') || 'https://open.bigmodel.cn/api/paas/v4/',
      apiKey: apiKey || this.config.get<string>('LLM_API_KEY'),
    })
  }

  private async resolveModel() {
    return (
      (await this.settings.get('LLM_API_MODEL')) ||
      this.config.get<string>('LLM_API_MODEL') ||
      'glm-4.5-air'
    )
  }

  private async assertOwned(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, createdById: userId },
    })
    if (!ticket) throw new NotFoundException('工单不存在')
    return ticket
  }

  async list(userId: string, status?: string) {
    if (status && !STATUSES.has(status)) throw new BadRequestException('工单状态无效')
    return this.prisma.supportTicket.findMany({
      where: { createdById: userId, ...(status ? { status } : {}) },
      include: {
        suggestions: { orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async get(userId: string, ticketId: string) {
    await this.assertOwned(userId, ticketId)
    return this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        suggestions: { orderBy: { version: 'desc' } },
        auditEvents: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    })
  }

  async create(
    userId: string,
    data: {
      externalRef?: string
      title: string
      description: string
      customerName: string
      customerEmail?: string
      priority?: string
    },
  ) {
    if (!data.title?.trim() || !data.description?.trim() || !data.customerName?.trim()) {
      throw new BadRequestException('标题、问题描述和客户名称不能为空')
    }
    const priority = data.priority || 'medium'
    if (!PRIORITIES.has(priority)) throw new BadRequestException('工单优先级无效')

    const ticket = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          externalRef: data.externalRef?.trim() || null,
          title: data.title.trim(),
          description: data.description.trim(),
          customerName: data.customerName.trim(),
          customerEmail: data.customerEmail?.trim() || null,
          priority,
          createdById: userId,
        },
      })
      await tx.ticketAuditEvent.create({
        data: { ticketId: ticket.id, actorId: userId, action: 'ticket.created' },
      })
      return ticket
    })
    return this.get(userId, ticket.id)
  }

  async update(
    userId: string,
    ticketId: string,
    data: { title?: string; description?: string; priority?: string; status?: string },
  ) {
    await this.assertOwned(userId, ticketId)
    if (data.priority && !PRIORITIES.has(data.priority))
      throw new BadRequestException('工单优先级无效')
    if (data.status && !STATUSES.has(data.status)) throw new BadRequestException('工单状态无效')

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        title: data.title?.trim(),
        description: data.description?.trim(),
        priority: data.priority,
        status: data.status,
      },
    })
    await this.audit(ticketId, userId, 'ticket.updated', data)
    return updated
  }

  async generateSuggestion(userId: string, ticketId: string) {
    const ticket = await this.assertOwned(userId, ticketId)
    if (ticket.status === 'closed') throw new BadRequestException('已关闭工单不能生成建议')

    const locked = await this.prisma.supportTicket.updateMany({
      where: { id: ticketId, createdById: userId, status: { not: 'analyzing' } },
      data: { status: 'analyzing' },
    })
    if (locked.count !== 1) throw new BadRequestException('该工单正在生成处理建议，请稍后重试')
    await this.audit(ticketId, userId, 'suggestion.generation_started')

    try {
      const query = `${ticket.title}\n${ticket.description}`
      const hits = await this.knowledge.searchRelevant(userId, query, 6)
      const sources = hits.map((hit) => ({
        documentId: hit.documentId,
        documentName: hit.documentName,
        chunkIndex: hit.index,
        score: hit.score,
      }))
      const context = hits.length
        ? hits
            .map(
              (hit, index) =>
                `[资料 ${index + 1}｜${hit.documentName}｜片段 ${hit.index + 1}]\n${hit.content}`,
            )
            .join('\n\n')
        : '没有检索到相关企业知识，请明确告知需要进一步核实，不要编造公司制度或操作步骤。'

      const client = await this.createClient()
      const model = await this.resolveModel()
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              '你是企业客服工单助手。只根据提供的工单和企业知识生成建议。' +
              '输出 JSON 对象，字段 summary 是给客服看的处理摘要，reply 是可直接发给客户的正式回复。' +
              '回复要准确、礼貌、可执行；资料不足时说明需要核实，不得虚构政策、承诺或时间。',
          },
          {
            role: 'user',
            content: `工单标题：${ticket.title}\n客户：${ticket.customerName}\n优先级：${ticket.priority}\n问题描述：\n${ticket.description}\n\n企业知识：\n${context}`,
          },
        ],
      })
      const raw = completion.choices[0]?.message?.content || '{}'
      const generated = this.parseSuggestion(raw)
      const latest = await this.prisma.ticketSuggestion.aggregate({
        where: { ticketId },
        _max: { version: true },
      })
      const version = (latest._max.version || 0) + 1

      const suggestion = await this.prisma.$transaction(async (tx) => {
        await tx.ticketSuggestion.updateMany({
          where: { ticketId, status: 'pending' },
          data: { status: 'rejected', decisionNote: '已被新版本建议替代', decidedAt: new Date() },
        })
        const created = await tx.ticketSuggestion.create({
          data: {
            ticketId,
            version,
            summary: generated.summary,
            reply: generated.reply,
            sources,
            model,
          },
        })
        await tx.supportTicket.update({
          where: { id: ticketId },
          data: { status: 'pending_approval' },
        })
        await tx.ticketAuditEvent.create({
          data: {
            ticketId,
            actorId: userId,
            action: 'suggestion.generated',
            metadata: { suggestionId: created.id, version, model, sourceCount: sources.length },
          },
        })
        return created
      })
      return suggestion
    } catch (error) {
      await this.prisma.supportTicket.updateMany({
        where: { id: ticketId, status: 'analyzing' },
        data: { status: 'open' },
      })
      await this.audit(ticketId, userId, 'suggestion.generation_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async decideSuggestion(
    userId: string,
    ticketId: string,
    suggestionId: string,
    decision: { approved: boolean; content?: string; note?: string },
  ) {
    await this.assertOwned(userId, ticketId)
    const suggestion = await this.prisma.ticketSuggestion.findFirst({
      where: { id: suggestionId, ticketId },
    })
    if (!suggestion) throw new NotFoundException('处理建议不存在')
    if (suggestion.status !== 'pending') throw new BadRequestException('该建议已经完成审批')

    const finalContent = decision.content?.trim() || suggestion.reply
    if (decision.approved && !finalContent) throw new BadRequestException('正式回复不能为空')

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: decision.approved ? 'approved' : 'rejected',
          reply: finalContent,
          approvedById: userId,
          decisionNote: decision.note?.trim() || null,
          decidedAt: new Date(),
        },
      })
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: decision.approved
          ? { status: 'resolved', finalReply: finalContent, repliedAt: new Date() }
          : { status: 'open' },
      })
      await tx.ticketAuditEvent.create({
        data: {
          ticketId,
          actorId: userId,
          action: decision.approved ? 'suggestion.approved_and_replied' : 'suggestion.rejected',
          metadata: {
            suggestionId,
            note: decision.note || null,
            edited: finalContent !== suggestion.reply,
          },
        },
      })
    })
    return this.get(userId, ticketId)
  }

  private parseSuggestion(raw: string): GeneratedSuggestion {
    try {
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('模型未返回 JSON 对象')
      const parsed = JSON.parse(match[0])
      const summary = String(parsed.summary || '').trim()
      const reply = String(parsed.reply || '').trim()
      if (!summary || !reply) throw new Error('模型返回字段不完整')
      return { summary, reply }
    } catch (error) {
      this.logger.warn(
        `invalid ticket suggestion JSON: ${error instanceof Error ? error.message : error}`,
      )
      throw new BadRequestException('模型未返回有效的工单建议，请重试')
    }
  }

  private async audit(ticketId: string, actorId: string, action: string, metadata?: object) {
    await this.prisma.ticketAuditEvent.create({
      data: { ticketId, actorId, action, ...(metadata ? { metadata } : {}) },
    })
  }
}
