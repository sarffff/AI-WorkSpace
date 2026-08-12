import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import OpenAI from 'openai'
import { ConfigService } from '@nestjs/config'
import { KnowledgeService, RagHit } from '@/modules/knowledge/knowledge.service'
import { SettingsService } from '@/modules/settings/settings.service'
import { AgentToolsService, ToolCallRecord } from '@/modules/agent/agent-tools.service'

export interface SourceRef {
  documentId: string
  documentName: string
}

export interface ChatStreamEvent {
  content?: string
  sources?: SourceRef[]
  toolCall?: { id: string; name: string; args: Record<string, unknown> }
  toolResult?: { id: string; name: string; status: 'ok' | 'error' | 'denied' }
  approval?: { toolCallId: string; name: string; args: Record<string, unknown> }
}

// HITL 审批队列项
interface PendingApproval {
  userId: string
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

// 每轮 agent 输出中的工具调用
// interface ParsedToolCall {
//   id: string
//   name: string
//   args: Record<string, unknown>
// }

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)
  private readonly pendingApprovals = new Map<string, PendingApproval>()

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private knowledgeService: KnowledgeService,
    private settingsService: SettingsService,
    private agentTools: AgentToolsService,
  ) {}

  // 每次请求构建 OpenAI 客户端（支持运行时改配置而无需重启）
  private async createClient(): Promise<OpenAI> {
    const [apiUrl, apiKey] = await Promise.all([
      this.settingsService.get('LLM_API_URL'),
      this.settingsService.get('LLM_API_KEY'),
    ])
    return new OpenAI({
      baseURL:
        apiUrl ||
        this.configService.get<string>('LLM_API_URL') ||
        'https://open.bigmodel.cn/api/paas/v4/',
      apiKey: apiKey || this.configService.get<string>('LLM_API_KEY'),
    })
  }

  // ===== 会话 CRUD =====

  async getRecentChats(userId: string) {
    const chats = await this.prisma.chat.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    })
    return chats.map((c) => ({
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      date: this.formatDate(c.updatedAt),
      preview: c.messages[0]?.content?.slice(0, 60) || '',
    }))
  }

  async createChat(userId: string, title = '新对话') {
    return this.prisma.chat.create({ data: { title, userId } })
  }

  async renameChat(userId: string, chatId: string, title: string) {
    await this.assertOwned(userId, chatId)
    return this.prisma.chat.update({ where: { id: chatId }, data: { title } })
  }

  async togglePinChat(userId: string, chatId: string) {
    const chat = await this.assertOwned(userId, chatId)
    return this.prisma.chat.update({ where: { id: chatId }, data: { pinned: !chat.pinned } })
  }

  async deleteChat(userId: string, chatId: string) {
    await this.assertOwned(userId, chatId)
    await this.prisma.chat.delete({ where: { id: chatId } })
  }

  async getMessages(userId: string, chatId: string) {
    await this.assertOwned(userId, chatId)
    return this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    })
  }

  async assertOwned(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat || chat.userId !== userId) throw new NotFoundException('会话不存在')
    return chat
  }

  // ===== AI 对话（Agent Loop）=====

  // 模型名：请求指定 > 运行时设置 > 环境配置 > 默认
  private async resolveModel(model?: string): Promise<string> {
    if (model) return model
    const configured = await this.settingsService.get('LLM_API_MODEL')
    return configured || this.configService.get<string>('LLM_API_MODEL') || 'glm-4.5-air'
  }

  // 自动 RAG：检索知识库 → 拼装 system 上下文（无命中返回空）
  private async buildRagContext(
    userId: string,
    prompt: string,
  ): Promise<{
    sources: SourceRef[]
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  }> {
    const hits = await this.knowledgeService.searchRelevant(userId, prompt, 4)
    if (hits.length === 0) return { sources: [], messages: [] }

    const context = hits
      .map((h, i) => `[片段 ${i + 1}｜来源：${h.documentName}]\n${h.content}`)
      .join('\n\n')
    this.logger.log(`RAG: ${hits.length} hits, scores=${hits.map((h) => h.score).join(',')}`)

    const sources = Array.from(
      new Map(hits.map((h) => [h.documentId, h.documentName])),
      ([documentId, documentName]) => ({ documentId, documentName }),
    )

    return {
      sources,
      messages: [
        {
          role: 'system',
          content: `—— 知识库上下文（自动检索，仅作参考）——
${context}`,
        },
      ],
    }
  }

  // 汇总引用来源（自动 RAG + 工具检索结果 去重）
  private mergeSources(...lists: (SourceRef[] | undefined)[]): SourceRef[] {
    const map = new Map<string, SourceRef>()
    for (const list of lists) {
      for (const s of list ?? []) map.set(s.documentId, s)
    }
    return Array.from(map.values())
  }

  // ===== 会话记忆（自动压缩）=====

  // 消息超过阈值后，将最旧一轮的上下文压缩为一条 system 记忆消息
  private async compressMemory(chatId: string, messages) {
    const threshold = await this.settingsService.getNumber('MEMORY_THRESHOLD', 12)
    let cursor = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'system') {
        cursor = i + 1
        break
      }
    }
    // 上游模型返回格式不可预期，超出阈值直接把旧消息送回模型压缩
    const segment = messages.slice(cursor)
    if (segment.length <= threshold) return

    const block = segment.slice(0, segment.length - threshold)
    if (block.length < 2) return

    const client = await this.createClient()
    const model = await this.resolveModel()
    try {
      const res = await client.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              '你负责把一段对话压缩成一条会话记忆，保留用户的目标、已确认的结论、关键事实，' +
              '去掉寒暄与过程细节，语言简洁（中文，不超过 300 字），只输出压缩结果。',
          },
          {
            role: 'user',
            content: block
              .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
              .join('\n'),
          },
        ],
      })
      const summary = (res.choices[0]?.message?.content || '').trim()
      if (!summary) return

      const delIds = block.map((m) => m.id)
      await this.prisma.message.deleteMany({ where: { id: { in: delIds } } })
      await this.prisma.message.create({
        data: {
          chatId,
          role: 'system',
          content: `【记忆】${summary}`,
          createdAt: new Date(block[0].createdAt.getTime() - 1000),
        },
      })
      this.logger.log(`[memory] compressed ${delIds.length} messages for chat ${chatId}`)
    } catch (err) {
      this.logger.warn(`[memory] compress failed: ${err.message}`)
    }
  }

  // 构建历史上下文参数（含记忆消息；排除刚写入的当前用户消息）
  private async buildHistoryMessages(
    chatId: string,
    prompt: string,
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    })
    await this.compressMemory(chatId, messages)

    const params: OpenAI.Chat.ChatCompletionMessageParam[] = []
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].content === prompt) {
        lastUserIdx = i
        break
      }
    }
    for (let i = 0; i < messages.length; i++) {
      if (i === lastUserIdx) continue
      const m = messages[i]
      if (m.role === 'system') {
        params.push({ role: 'system', content: m.content })
      } else if (m.role === 'user') {
        params.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {
        params.push({ role: 'assistant', content: m.content })
      }
    }
    return params
  }

  // ===== HITL 工具审批 =====

  // 流式对话中需要用户确认才执行的外部工具（逗号分隔）
  private async approvalTools(): Promise<string[]> {
    const raw = await this.settingsService.get('AGENT_APPROVAL_TOOLS')
    const list = (raw || 'web_fetch')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return list
  }

  // 挂起一个审批请求，等待前端 approve/deny（120s 超时自动拒绝）
  private requestApproval(userId: string, toolCallId: string): Promise<boolean> {
    const key = `${userId}:${toolCallId}`
    const existing = this.pendingApprovals.get(key)
    if (existing) {
      clearTimeout(existing.timer)
      this.pendingApprovals.delete(key)
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(key)
        resolve(false)
        this.logger.warn(`[approval] ${toolCallId} timed out, auto-rejected`)
      }, 120_000)
      this.pendingApprovals.set(key, { userId, resolve, timer })
    })
  }

  // 用户通过 API 决定是否放行某次工具调用
  resolveApproval(userId: string, toolCallId: string, approved: boolean) {
    const entry = this.pendingApprovals.get(`${userId}:${toolCallId}`)
    if (!entry) throw new NotFoundException('该工具调用不在等待确认中（可能已超时）')
    clearTimeout(entry.timer)
    this.pendingApprovals.delete(`${userId}:${toolCallId}`)
    entry.resolve(approved)
    return { success: true }
  }

  // 非流式：Agent Loop → 完整回复 + 来源 + 工具活动
  async generateAiResponse(
    chatId: string,
    userId: string,
    prompt: string,
    model?: string,
    useRag = true,
  ) {
    await this.saveUserMessage(chatId, prompt)

    const client = await this.createClient()
    const resolvedModel = await this.resolveModel(model)
    const maxIterations = await this.settingsService.getNumber('AGENT_MAX_ITERATIONS', 5)

    const autoRag = useRag
      ? await this.buildRagContext(userId, prompt)
      : { sources: [], messages: [] }
    const history = await this.buildHistoryMessages(chatId, prompt)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          '你是 AI Workspace 的智能助手，可以调用工具完成任务。' +
          '需要知识库信息时调用 search_knowledge；需要实时/外部信息时调用 web_fetch；需要计算时调用 calculate。' +
          '调用工具后结合结果组织最终回答。',
      },
      ...autoRag.messages,
      ...history,
      { role: 'user', content: prompt },
    ]

    const toolRecords: ToolCallRecord[] = []
    let reply = ''
    let sources = [...autoRag.sources]
    const tools = this.agentTools.getApiTools()

    for (let iter = 0; iter < maxIterations; iter++) {
      const completion = await client.chat.completions.create({
        model: resolvedModel,
        messages,
        tools,
      })
      const choice = completion.choices[0]?.message
      if (!choice) throw new Error('模型无返回内容')

      messages.push(choice as OpenAI.Chat.ChatCompletionMessageParam)

      if (choice.tool_calls?.length) {
        for (const tc of choice.tool_calls) {
          let args: Record<string, unknown> = {}
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
          } catch {
            args = { raw: tc.function.arguments }
          }
          const record = await this.agentTools.execute(
            {
              id: tc.id,
              name: tc.function.name,
              args,
            },
            userId,
          )
          toolRecords.push(record)
          if (record.sources?.length) {
            sources = this.mergeSources(
              sources,
              record.sources.map((h: RagHit) => ({
                documentId: h.documentId,
                documentName: h.documentName,
              })),
            )
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: record.output })
          this.logger.log(
            `[agent] iter=${iter + 1} tool ${record.name} -> ${record.status} (${record.output.slice(0, 60)}…)`,
          )
        }
        // 下一轮可能已到上限 → 强制不带工具，让模型直接总结
        if (iter === maxIterations - 1) {
          messages.push({
            role: 'user',
            content: '工具调用次数已达上限，请直接基于已有信息给出最终回答。',
          })
          const final = await client.chat.completions.create({
            model: resolvedModel,
            messages,
          })
          reply = final.choices[0]?.message?.content || ''
          break
        }
        continue // 还有工具调用 → 继续循环
      }

      // 模型给出最终文本
      reply = choice.content || ''
      break
    }

    if (!reply) reply = '抱歉，我未能生成有效回答（工具调用可能已超出上限）。'

    await this.saveAiMessage(chatId, reply, model, sources, toolRecords)
    return {
      data: reply,
      sources,
      tools: toolRecords.map((r) => ({
        id: r.id,
        name: r.name,
        args: r.args,
        output: r.output.slice(0, 200),
        status: r.status,
      })),
    }
  }

  // 流式：Agent Loop，中间事件（工具调用/结果/内容分片/来源）经 SSE 推送；
  // 需要确认的工具（见 AGENT_APPROVAL_TOOLS）会先推送 approval 事件，等待用户审批后再执行
  async *streamAiResponse(
    chatId: string,
    userId: string,
    prompt: string,
    model?: string,
    useRag = true,
  ): AsyncGenerator<ChatStreamEvent> {
    await this.saveUserMessage(chatId, prompt)

    const client = await this.createClient()
    const resolvedModel = await this.resolveModel(model)
    const maxIterations = await this.settingsService.getNumber('AGENT_MAX_ITERATIONS', 5)
    const gatedTools = await this.approvalTools()

    const autoRag = useRag
      ? await this.buildRagContext(userId, prompt)
      : { sources: [], messages: [] }
    const history = await this.buildHistoryMessages(chatId, prompt)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          '你是 AI Workspace 的智能助手，可以带工具完成任务。' +
          '需要知识库信息时调用 search_knowledge；需要实时/外部信息时调用 web_fetch；需要计算时调用 calculate。' +
          '按工具调用结果组织最终回答。',
      },
      ...autoRag.messages,
      ...history,
      { role: 'user', content: prompt },
    ]

    const toolRecords: ToolCallRecord[] = []
    let fullReply = ''
    let sources = [...autoRag.sources]
    const tools = this.agentTools.getApiTools()

    for (let iter = 0; iter < maxIterations; iter++) {
      const completion = await client.chat.completions.create({
        model: resolvedModel,
        messages,
        tools,
      })
      const choice = completion.choices[0]?.message
      if (!choice) throw new Error('模型无响应内容')

      messages.push(choice.content ? { role: 'assistant', content: choice.content } : choice)

      if (choice.tool_calls?.length) {
        for (const tc of choice.tool_calls) {
          let args: Record<string, unknown> = {}
          try {
            args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
          } catch {
            args = { raw: tc.function.arguments }
          }
          yield { toolCall: { id: tc.id, name: tc.function.name, args } }

          // 需确认的工具（如 web_fetch）：推送审批事件并等待用户决定
          if (gatedTools.includes(tc.function.name)) {
            yield {
              approval: { toolCallId: tc.id, name: tc.function.name, args },
            }
            const approved = await this.requestApproval(userId, tc.id)
            if (!approved) {
              const denied: ToolCallRecord = {
                id: tc.id,
                name: tc.function.name,
                args,
                output: '用户拒绝了该工具调用',
                status: 'denied',
              }
              toolRecords.push(denied)
              messages.push({ role: 'tool', tool_call_id: tc.id, content: denied.output })
              yield { toolResult: { id: tc.id, name: tc.function.name, status: 'denied' } }
              continue
            }
          }

          const record = await this.agentTools.execute(
            {
              id: tc.id,
              name: tc.function.name,
              args,
            },
            userId,
          )
          toolRecords.push(record)
          if (record.sources?.length) {
            sources = this.mergeSources(
              sources,
              record.sources.map((h: RagHit) => ({
                documentId: h.documentId,
                documentName: h.documentName,
              })),
            )
          }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: record.output })
          yield { toolResult: { id: tc.id, name: tc.function.name, status: record.status } }
          this.logger.log(
            `[agent] iter=${iter + 1} tool ${record.name}(${record.status}) len=${record.output.length}`,
          )
        }
        if (iter === maxIterations - 1) {
          const finalMsg = await client.chat.completions.create({
            model: resolvedModel,
            messages: [
              ...messages,
              { role: 'user', content: '工具调用已达上限，请直接基于已有信息给出最终回答。' },
            ],
          })
          const finalText = finalMsg.choices[0]?.message?.content || ''
          if (finalText) {
            fullReply += finalText
            yield { content: finalText }
          }
          break
        }
        continue
      }

      // 流式输出最终回答
      const stream = await client.chat.completions.create({
        model: resolvedModel,
        messages,
        stream: true,
      })
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          fullReply += content
          yield { content }
        }
      }
      break
    }

    if (fullReply) {
      await this.saveAiMessage(chatId, fullReply, model, sources, toolRecords)
    }
    yield { sources }
  }

  // ===== 消息持久化 =====

  async saveUserMessage(chatId: string, content: string) {
    const message = await this.prisma.message.create({
      data: { chatId, role: 'user', content },
    })
    await this.touchChat(chatId)
    return message
  }

  async saveAiMessage(
    chatId: string,
    content: string,
    model?: string,
    sources?: SourceRef[],
    tools?: ToolCallRecord[],
  ) {
    const message = await this.prisma.message.create({
      data: {
        chatId,
        role: 'assistant',
        content,
        model,
        sources: sources && sources.length > 0 ? (sources as object[]) : undefined,
        tools: tools && tools.length > 0 ? (tools as object[]) : undefined,
      },
    })
    await this.touchChat(chatId)
    return message
  }

  private async touchChat(chatId: string) {
    await this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } })
  }

  // ===== 工具方法 =====

  private formatDate(date: Date): string {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
}
