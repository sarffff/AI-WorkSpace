import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/prisma/prisma.service'
import { SettingsService } from '@/modules/settings/settings.service'
import { KnowledgeService, RagHit } from '@/modules/knowledge/knowledge.service'
import { TicketsService } from '@/modules/tickets/tickets.service'
import { MemoryService } from '@/modules/memory/memory.service'
import OpenAI from 'openai'
import type { Prisma } from '@prisma/client'

// ===== Agent 流式事件协议（SSE 透传给前端） =====

export interface ToolTraceStep {
  tool: 'search_knowledge' | 'create_ticket' | string
  status: 'start' | 'done'
  summary?: string
}

export interface TicketRef {
  id: string
  title: string
}

// 建单确认事件：Agent 决定建单 → 推草稿给用户 → 暂停等待确认/取消
export interface TicketDraft {
  requestId: string
  title: string
  content: string
  priority: string
}

export type AgentStreamEvent =
  | { type: 'tool'; step: ToolTraceStep }
  | { type: 'ticket'; ticket: TicketRef }
  | { type: 'sources'; sources: RagHit[] }
  | { type: 'content'; text: string }
  | { type: 'confirm_required'; draft: TicketDraft }

// HITL 待确认请求注册表：requestId → resolve(approved)
// （内存态即可：确认窗口与 SSE 连接同生命周期，断连即清理）
type ConfirmResolver = (approved: boolean) => void

// Agent 模式人设：说明工具使用策略（检索优先、超范围升级工单）与引用输出格式
const AGENT_PERSONA = `你是 ServiceDeck 智能服务台的 IT 支持助手，可以调用工具完成任务，请遵守以下策略：
1. 遇到 IT、企业制度、流程类问题，先调用 search_knowledge 检索知识库，依据检索到的内容回答；
2. 检索后仍无法解答，或问题需要人工处理（如账号重置、权限变更、硬件更换），调用 create_ticket 为用户创建工单，并告知工单标题；
3. 通用编程、写作等与企业管理无关的问题可直接回答；
4. 用户问题描述模糊、缺少关键信息（如具体设备、报错信息、账号、时间范围）时，先向用户提出 1-2 个针对性澄清问题，获得补充信息后再检索或建单，不要在信息不足时直接创建工单。
引用格式：依据知识库内容回答时，在依据处用 [n] 脚注标注（n 为片段序号），回答末尾列出引用列表：
[1] 来源: 文档名 · 章节路径
[2] 来源: 文档名 · 章节路径
知识库中没有相关内容时，如实说明"未在知识库中找到相关内容"，不要编造引用或捏造出处。
回答使用中文，条理清晰、简洁分点。`

// 粗略 token 估算（API 未返回 usage 时的兜底）：CJK 每字 ≈ 1 token，ASCII ≈ 4 字符/token，其余 ≈ 2 字符/token
function estimateTokens(text: string): number {
  let tokens = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x4e00 && code <= 0x9fff) tokens += 1
    else if (code < 128) tokens += 0.25
    else tokens += 0.5
  }
  return Math.ceil(tokens)
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  // HITL 建单确认：pending 请求表（requestId → resolver）
  // 与 SSE 连接同生命周期：断连清理，无需持久化
  private readonly pendingConfirms = new Map<string, ConfirmResolver>()

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private settingsService: SettingsService,
    private knowledgeService: KnowledgeService,
    private ticketsService: TicketsService,
    private memoryService: MemoryService,
  ) {}

  // 根据当前 DB 配置动态创建 OpenAI 兼容客户端（设置页可实时修改）
  // 优先级：DB 设置 > 环境变量 > 默认值
  private async getOpenAIClient(userId: string): Promise<OpenAI> {
    const baseURL =
      (await this.settingsService.get(userId, 'llmBaseUrl')) ||
      this.configService.get<string>('LLM_API_URL') ||
      'https://open.bigmodel.cn/api/paas/v4/'
    const apiKey =
      (await this.settingsService.get(userId, 'llmApiKey')) ||
      this.configService.get<string>('LLM_API_KEY') ||
      ''
    return new OpenAI({ baseURL, apiKey })
  }

  // ===== 会话 CRUD =====

  // 获取所有会话，固定在前，按更新时间倒序，附带最后一条消息预览 + 累计 token 用量
  async getRecentChats(userId: string) {
    const chats = await this.prisma.chat.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
    })
    // 单次聚合查询统计每个会话的 token 消耗
    const usageRows = await this.prisma.message.groupBy({
      by: ['chatId'],
      where: { chatId: { in: chats.map((c) => c.id) } },
      _sum: { promptTokens: true, completionTokens: true },
    })
    const usageMap = new Map(
      usageRows.map((r) => [
        r.chatId,
        { promptTokens: r._sum.promptTokens ?? 0, completionTokens: r._sum.completionTokens ?? 0 },
      ]),
    )
    return chats.map((c) => ({
      id: c.id,
      title: c.title,
      pinned: c.pinned,
      date: this.formatDate(c.updatedAt),
      preview: c.messages[0]?.content?.slice(0, 60) || '',
      tokens: usageMap.get(c.id) ?? { promptTokens: 0, completionTokens: 0 },
    }))
  }

  // 创建新会话
  async createChat(userId: string, title = '新对话') {
    return this.prisma.chat.create({
      data: { title, userId },
    })
  }

  // 重命名会话（仅限本人）
  async renameChat(userId: string, chatId: string, title: string) {
    await this.assertOwned(userId, chatId)
    return this.prisma.chat.update({ where: { id: chatId }, data: { title } })
  }

  // 切换固定状态（仅限本人）
  async togglePinChat(userId: string, chatId: string) {
    const chat = await this.assertOwned(userId, chatId)
    return this.prisma.chat.update({ where: { id: chatId }, data: { pinned: !chat.pinned } })
  }

  // 删除会话（仅限本人）
  async deleteChat(userId: string, chatId: string) {
    await this.assertOwned(userId, chatId)
    await this.prisma.chat.delete({ where: { id: chatId } })
  }

  // 获取会话消息列表（仅限本人）
  async getMessages(userId: string, chatId: string) {
    await this.assertOwned(userId, chatId)
    return this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    })
  }

  // 校验会话归属，返回会话（非本人会话一律 404，避免越权枚举）
  async assertOwned(userId: string, chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat || chat.userId !== userId) throw new NotFoundException('会话不存在')
    return chat
  }

  // ===== AI 对话 =====

  // 模型名：请求指定 > DB 设置 > 环境变量 > 默认
  private async resolveModel(userId: string, model?: string): Promise<string> {
    return (
      model ||
      (await this.settingsService.get(userId, 'llmModel')) ||
      this.configService.get<string>('LLM_API_MODEL') ||
      'GLM-4-Flash'
    )
  }

  // 取会话归属用户（配置/RAG 检索范围都按会话主人计算）
  private async getChatOwner(chatId: string): Promise<{
    id: string
    role: string
    department: string | null
  }> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { user: { select: { id: true, role: true, department: true } } },
    })
    if (!chat) throw new NotFoundException('会话不存在')
    return chat.user
  }

  // RAG：按行级权限检索知识库 → 拼装 system context + 引用溯源数据
  private async buildRagContext(
    user: { id: string; role: string; department: string | null },
    prompt: string,
  ): Promise<{
    sources: RagHit[]
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  }> {
    // topK 不传：由 Setting 表 ragTopK（可配置）决定，避免硬编码
    const hits = await this.knowledgeService.searchRelevant(user, prompt)
    if (hits.length === 0) return { sources: [], messages: [] }

    const context = hits
      .map(
        (h, i) =>
          `[片段 ${i + 1} · 来源: ${h.documentName}${h.sectionPath ? ` · ${h.sectionPath}` : ''}]\n${h.content}`,
      )
      .join('\n\n')
    this.logger.log(
      `RAG: ${hits.length} hits, docs=${hits.map((h) => h.documentName).join(',')}, scores=${hits
        .map((h) => h.score)
        .join(',')}`,
    )

    return {
      sources: hits,
      messages: [
        {
          role: 'system',
          content: `你是 ServiceDeck 智能服务台的 IT 支持助手。请优先依据下面提供的「知识库上下文」回答用户问题；依据知识库内容回答时，在依据处用 [n] 脚注标注（n 对应下方片段编号），回答末尾列出引用列表，格式如：
[1] 来源: 文档名 · 章节路径
[2] 来源: 文档名 · 章节路径
若知识库中没有相关信息，如实说明"未在知识库中找到相关内容"，再结合自身知识作答，不要编造引用；若问题超出你的处理范围（如需要人工操作、账号权限变更等），建议用户创建工单转人工处理。

—— 知识库上下文 ——
${context}`,
        },
      ],
    }
  }

  // 保存用户消息（顺带刷新会话时间，保持列表排序正确）
  async saveUserMessage(chatId: string, content: string) {
    const message = await this.prisma.message.create({
      data: { chatId, role: 'user', content },
    })
    await this.touchChat(chatId)
    return message
  }

  // 保存 AI 回复（顺带刷新会话时间，sources 为 RAG 引用溯源，tokens 为该次回答的 LLM 用量）
  async saveAiMessage(
    chatId: string,
    content: string,
    model?: string,
    sources?: RagHit[],
    tokens?: { promptTokens: number; completionTokens: number },
  ) {
    const message = await this.prisma.message.create({
      data: {
        chatId,
        role: 'assistant',
        content,
        model,
        sources:
          sources && sources.length > 0 ? (sources as unknown as Prisma.JsonValue) : undefined,
        promptTokens: tokens?.promptTokens,
        completionTokens: tokens?.completionTokens,
      },
    })
    await this.touchChat(chatId)
    return message
  }

  // 手动刷新会话 updatedAt（@updatedAt 只在直接 update Chat 时生效）
  private async touchChat(chatId: string) {
    await this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } })
  }

  // 客户端中断流后保存半成品回答（标记中止，前端续接"已停止"状态）
  private async savePartialMessage(chatId: string, partial: string) {
    try {
      // 幂等：run 生成器正常完成路径已保存完整回答，此处仅在 abort 后补充
      await this.prisma.message.create({
        data: { chatId, role: 'assistant', content: partial + '\n\n_[已中断]_ ' },
      })
      await this.touchChat(chatId)
    } catch (err) {
      this.logger.warn(
        `save partial message failed: chat=${chatId}, ${err instanceof Error ? err.message : 'unknown'}`,
      )
    }
  }

  // 上下文工程：跨会话长期记忆 → 会话摘要 → token 预算内最近的对话历史
  // 预算由 Setting 表 ragHistoryTokens 控制（env RAG_HISTORY_TOKENS 为全局默认）
  private async buildHistory(
    owner: { id: string; role: string; department: string | null },
    chatId: string,
    openai: OpenAI,
    model: string,
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const budget = Math.min(
      Math.max(
        parseInt(await this.settingsService.get(owner.id, 'ragHistoryTokens'), 10) || 6000,
        1000,
      ),
      16000,
    )
    const latest = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    // 从最新往回装历史，直到预算用尽（每条预留 16 token 的角色/结构开销）
    const kept: typeof latest = []
    let used = 0
    for (const m of latest) {
      const cost = estimateTokens(m.content) + 16
      if (kept.length > 0 && used + cost > budget) break
      used += cost
      kept.push(m)
    }
    kept.reverse() // 恢复时间正序

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // 跨会话长期记忆注入（偏好/事实/工单记录）
    const facts = await this.memoryService.getUserMemory(owner.id)
    if (facts.length > 0) {
      messages.push({ role: 'system', content: `[用户长期记忆]\n- ${facts.join('\n- ')}` })
    }

    // 会话摘要：历史溢出时后台异步生成，本次请求先用旧摘要（若有）
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      select: { summary: true, summaryAnchorId: true },
    })
    const dropped = latest.slice(kept.length) // 未装进预算的更早消息（倒序）
    if (dropped.length > 0) {
      let anchorAt: Date | null = null
      if (chat?.summaryAnchorId) {
        const anchorMsg = await this.prisma.message.findUnique({
          where: { id: chat.summaryAnchorId },
          select: { createdAt: true },
        })
        anchorAt = anchorMsg?.createdAt ?? null
      }
      // 锚点之后、预算之外的消息才是需要新纳入摘要的（最多 40 条控制成本）
      const region = dropped.filter((m) => !anchorAt || m.createdAt > anchorAt).slice(0, 40)
      if (region.length > 0) {
        // 后台执行，不阻塞当前回复；失败仅告警
        void this.ensureChatSummary(
          owner.id,
          chatId,
          chat?.summary ?? undefined,
          region,
          kept[0]?.id,
          openai,
          model,
        )
      }
    }
    if (chat?.summary) {
      messages.push({ role: 'system', content: `[早期对话摘要]\n${chat.summary.slice(0, 800)}` })
    }

    messages.push(
      ...kept.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    )
    return messages
  }

  // 后台生成/合并会话摘要（历史超预算时把最旧部分压缩，防止信息完全丢失）
  private async ensureChatSummary(
    userId: string,
    chatId: string,
    existingSummary: string | undefined,
    region: { id: string; role: string; content: string; createdAt: Date }[],
    anchorId: string | undefined,
    openai: OpenAI,
    model: string,
  ) {
    try {
      const regionText = region
        .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 150)}`)
        .join('\n')
        .slice(0, 6000)
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是对话摘要助手。把早期对话压缩为要点中文摘要，保留：用户身份信息与偏好、工单编号与状态、未完成事项、关键结论与决策；丢弃寒暄与无关内容。',
          },
          {
            role: 'user',
            content: `[已有摘要]\n${existingSummary ?? '无'}\n\n[新增对话]\n${regionText}\n\n请输出与已有摘要合并后的完整要点摘要，不超过 300 字。`,
          },
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 400,
      })
      const summary = (completion.choices[0]?.message?.content || '').trim().slice(0, 1000)
      if (summary && anchorId) {
        await this.prisma.chat.update({
          where: { id: chatId },
          data: { summary, summaryAnchorId: anchorId },
        })
        this.logger.log(`chat summary updated: ${chatId}, chars=${summary.length}`)
      }
    } catch (err) {
      this.logger.warn(`chat summary failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 拼装完整消息序列：注入的 system 角色 → RAG 上下文 → 多轮历史 → 当前提问
  private assembleMessages(
    systemPrompt: string | undefined,
    ragMessages: OpenAI.Chat.ChatCompletionMessageParam[],
    history: OpenAI.Chat.ChatCompletionMessageParam[],
    prompt: string,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    if (systemPrompt?.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() })
    }
    messages.push(...ragMessages, ...history, { role: 'user', content: prompt })
    return messages
  }

  // 非流式：RAG 检索 → 保存消息 → 调 AI（含历史与注入角色）→ 保存回复与引用 → 返回
  async generateAiResponse(
    chatId: string,
    prompt: string,
    model?: string,
    useRag = true,
    systemPrompt?: string,
  ) {
    const owner = await this.getChatOwner(chatId)
    const rag = useRag ? await this.buildRagContext(owner, prompt) : { sources: [], messages: [] }
    const openai = await this.getOpenAIClient(owner.id)
    const resolvedModel = await this.resolveModel(owner.id, model)
    const history = await this.buildHistory(owner, chatId, openai, resolvedModel)
    await this.saveUserMessage(chatId, prompt)
    const completion = await openai.chat.completions.create({
      model: resolvedModel,
      messages: this.assembleMessages(systemPrompt, rag.messages, history, prompt),
    })
    const reply = completion.choices[0]?.message?.content || ''
    await this.saveAiMessage(chatId, reply, resolvedModel, rag.sources, {
      promptTokens:
        completion.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(history) + prompt),
      completionTokens: completion.usage?.completion_tokens ?? estimateTokens(reply),
    })
    return reply
  }

  // ===== Agent 工具循环（P2 核心路径） =====

  // 工具注册表：知识库检索 + 工单升级（OpenAI function calling 格式）
  private agentTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description:
            '检索当前用户权限可见的企业知识库，返回最相关的文档片段（含文档名与相似度）。回答 IT/制度/流程类问题前应先调用。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '检索关键词或完整问题' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'create_ticket',
          description:
            '为用户创建人工处理工单。仅当知识库检索后仍无法解答、或问题需要人工操作（账号/权限/硬件等）时调用一次，不要重复调用。',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '工单标题，一句话概括问题（60 字内）' },
              content: { type: 'string', description: '问题描述，含影响范围与期望结果' },
              priority: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'urgent'],
                description: '优先级，默认 normal',
              },
            },
            required: ['title', 'content'],
          },
        },
      },
    ]
  }

  // 执行单个工具调用，返回给模型的结果 + 前端轨迹摘要 + 溯源/工单副产物
  // 防御幻觉参数：白名单只取 schema 定义的字段；类型不符 → 返回结构化错误让模型
  // 下一轮修正（重试闭环），而非静默兜底产生 "[object Object]" 之类的脏数据
  // registerConfirm：HITL 确认门 —— create_ticket 校验通过后调用，注册 pending
  // 并返回 needsConfirm=true；实际建单由调用方（生成器层）在用户确认后执行
  private async execTool(
    owner: { id: string; role: string; department: string | null },
    name: string,
    args: Record<string, unknown>,
    opts: {
      createdTicket?: TicketRef
      chatId?: string
      registerConfirm?: (draft: { title: string; content: string; priority: string }) => void
    } = {},
  ): Promise<{
    result: unknown
    summary: string
    sources?: RagHit[]
    ticket?: TicketRef
    needsConfirm?: boolean
  }> {
    try {
      // 整体守卫：参数可能是 null/字符串/数组等非对象（模型幻觉），统一按参数错误处理
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return {
          result: { error: `参数错误: ${name} 的参数必须是 JSON 对象，请修正后重试` },
          summary: '参数错误',
        }
      }
      if (name === 'search_knowledge') {
        // 参数错误：返回错误文本回传给模型，让其修正后重试
        if (typeof args.query !== 'string' || !args.query.trim()) {
          return {
            result: { error: '参数错误: query 必须是非空字符串，请修正参数后重试' },
            summary: '参数错误',
          }
        }
        const query = args.query.trim().slice(0, 200)
        // topK 不传：由 Setting 表 ragTopK 决定
        const hits = await this.knowledgeService.searchRelevant(owner, query)
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
          summary: `"${query}" · 命中 ${hits.length} 片段`,
          sources: hits,
        }
      }
      if (name === 'create_ticket') {
        // 幂等：本会话已建单则不再重复创建，直接告知已有工单
        if (opts.createdTicket) {
          return {
            result: {
              ticketId: opts.createdTicket.id,
              title: opts.createdTicket.title,
              status: '已创建，请勿重复建单，直接告知用户工单编号',
            },
            summary: `已存在工单「${opts.createdTicket.title}」，跳过`,
          }
        }
        if (typeof args.title !== 'string' || !args.title.trim()) {
          return {
            result: { error: '参数错误: title 必须为非空字符串，请修正参数后重试' },
            summary: '参数错误',
          }
        }
        if (typeof args.content !== 'string' || !args.content.trim()) {
          return {
            result: { error: '参数错误: content 必须为非空字符串，请修正参数后重试' },
            summary: '参数错误',
          }
        }
        const title = args.title.trim().slice(0, 80)
        const content = args.content.trim().slice(0, 2000)
        // 枚举外取值（幻觉参数）回退默认，低风险不必报错
        const priority = ['low', 'normal', 'high', 'urgent'].includes(args.priority as string)
          ? (args.priority as string)
          : 'normal'
        // HITL 确认门：参数校验通过后交由生成器层确认（yield 事件只能在生成器内发生）
        if (opts.registerConfirm) {
          opts.registerConfirm({ title, content, priority })
          return {
            result: null, // 占位：确认后由生成器层直接建单，不走本分支的建单逻辑
            summary: '等待用户确认',
            needsConfirm: true,
          }
        }
        const ticket = await this.ticketsService.create(owner.id, {
          title,
          content,
          priority,
          source: 'agent',
        })
        this.logger.log(`agent created ticket "${title}" for user ${owner.id}`)
        // 长期记忆：工单记录跨会话可回溯（"上次的工单怎么样了"）
        await this.memoryService.remember(
          owner.id,
          'ticket',
          `于 ${new Date().toLocaleDateString('zh-CN')} 创建工单「${title}」，单号 ${ticket.id.slice(0, 8)}`,
          opts.chatId,
        )
        return {
          result: { ticketId: ticket.id, title, status: '已创建，等待坐席受理' },
          summary: `"${title}"`,
          ticket: { id: ticket.id, title },
        }
      }
      return { result: { error: `未知工具: ${name}` }, summary: `未知工具 ${name}` }
    } catch (err) {
      const message = err instanceof Error ? err.message : '工具执行失败'
      this.logger.error(`tool ${name} failed: ${message}`)
      return { result: { error: message }, summary: `执行失败` }
    }
  }

  // ===== HITL 建单确认 =====

  // 用户对建单请求做出决定（前端确认卡调用）；未知/已处理请求返回 false
  resolveConfirm(requestId: string, approved: boolean): boolean {
    const resolver = this.pendingConfirms.get(requestId)
    if (!resolver) return false
    this.pendingConfirms.delete(requestId)
    resolver(approved)
    return true
  }

  // 撤销 pending 确认（SSE 断连时调用，按 canceled 处理）
  private cancelConfirm(requestId: string) {
    const resolver = this.pendingConfirms.get(requestId)
    if (resolver) {
      this.pendingConfirms.delete(requestId)
      resolver(false)
    }
  }

  // 流式对话入口（Agent 模式）：
  // 工具循环（非流式，模型决定是否检索/建单）→ 轨迹与溯源事件 → 基于工具结果流式生成最终回答
  async startStream(
    chatId: string,
    prompt: string,
    model?: string,
    _useRag?: boolean, // 兼容旧参数：检索时机已由 Agent 自主决策
    systemPrompt?: string,
  ): Promise<{ stream: AsyncGenerator<AgentStreamEvent> }> {
    const owner = await this.getChatOwner(chatId)
    const openai = await this.getOpenAIClient(owner.id)
    const resolvedModel = await this.resolveModel(owner.id, model)
    const history = await this.buildHistory(owner, chatId, openai, resolvedModel)
    await this.saveUserMessage(chatId, prompt)

    // 消息序列：Agent 人设 →（可选）注入的提示词角色 → 长期记忆/摘要/历史 → 当前提问
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: AGENT_PERSONA },
    ]
    if (systemPrompt?.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() })
    }
    messages.push(...history, { role: 'user', content: prompt })

    // 工具决策循环轮数上限：Setting 表 ragAgentMaxRounds 按用户覆盖，env 为全局默认
    const rawRounds = await this.settingsService.get(owner.id, 'ragAgentMaxRounds')
    const maxRounds = Math.min(Math.max(parseInt(rawRounds, 10) || 4, 1), 10)
    const streamStartedAt = Date.now()

    // bind 保留外层 this（生成器无法用箭头函数捕获 this）
    const run = async function* (): AsyncGenerator<AgentStreamEvent> {
      const collectedSources: RagHit[] = []
      let createdTicket: TicketRef | undefined
      let toolCallsTotal = 0
      // 本次回答的全部 LLM 调用用量（决策循环 + 生成；usage 缺失时逐处回退估算）
      let promptTokensTotal = 0
      let completionTokensTotal = 0

      // —— 阶段一：工具决策循环 ——
      let directAnswer = ''
      for (let round = 0; round < maxRounds; round++) {
        const completion = await openai.chat.completions.create({
          model: resolvedModel,
          messages,
          tools: this.agentTools(),
          stream: false,
          temperature: 0, // 工具决策调用：确定性优先，降低随机选错工具
        })
        promptTokensTotal +=
          completion.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))
        completionTokensTotal += completion.usage?.completion_tokens ?? 0
        const msg = completion.choices[0]?.message

        const toolCalls = msg?.tool_calls?.filter((c) => c.type === 'function') || []
        if (toolCalls.length === 0) {
          directAnswer = msg?.content || ''
          break
        }

        // 记录 assistant 的工具调用意图，随后逐个执行并回填结果
        messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam)
        let roundFailed = false
        let roundEmptySearch = false
        for (const call of toolCalls) {
          const fname = call.function.name
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(call.function.arguments || '{}')
          } catch {
            // 参数解析失败按空参数执行，由 execTool 兜底
          }
          yield { type: 'tool', step: { tool: fname, status: 'start' } }
          const toolStartedAt = Date.now()
          // createdTicket 传入实现建单幂等（同一会话不重复建单）；chatId 用于工单记忆溯源
          // HITL 确认门：execTool 返回 needsConfirm + 草稿 → 生成器推 confirm_required 事件
          // （yield 只能发生在生成器内，故确认事件由本层发射，execTool 仅回传草稿）
          let pendingDraft: TicketDraft | null = null
          let confirmDecision: Promise<boolean> | null = null
          const { result, summary, sources, ticket, needsConfirm } = await this.execTool(
            owner,
            fname,
            args,
            {
              createdTicket,
              chatId,
              // 确认门：注册 pending → 由生成器先推事件再 await 用户决定
              registerConfirm: (draft) => {
                const requestId = `${chatId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
                const decision = new Promise<boolean>((resolve) => {
                  this.pendingConfirms.set(requestId, resolve)
                })
                confirmDecision = decision
                pendingDraft = { requestId, ...draft }
              },
            },
          )
          // 生成器内推确认事件并阻塞（普通 async 无法 yield，事件必须在此发射）
          if (needsConfirm && pendingDraft && confirmDecision) {
            yield { type: 'confirm_required', draft: pendingDraft }
            const approved = await confirmDecision
            this.logger.log(
              JSON.stringify({
                chatId,
                userId: owner.id,
                requestId: pendingDraft.requestId,
                event: 'ticket-confirm',
                approved,
              }),
            )
            if (!approved) {
              // 用户拒绝：不建单，结构化结果回传模型（转述原因，勿重复建单）
              toolCallsTotal++
              yield {
                type: 'tool',
                step: { tool: fname, status: 'done', summary: '用户已拒绝建单' },
              }
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({
                  message:
                    '用户拒绝了本次工单创建，请勿再次调用 create_ticket。请向用户说明未建单，并询问是否需要补充信息或改用其他方式解决。',
                }),
              })
              continue
            }
            // 用户确认：实际建单（草稿已在 execTool 校验/裁剪）
            const created = await this.ticketsService.create(owner.id, {
              title: pendingDraft.title,
              content: pendingDraft.content,
              priority: pendingDraft.priority,
              source: 'agent',
            })
            await this.memoryService.remember(
              owner.id,
              'ticket',
              `于 ${new Date().toLocaleDateString('zh-CN')} 创建工单「${created.title}」，单号 ${created.id.slice(0, 8)}`,
              chatId,
            )
            createdTicket = { id: created.id, title: created.title }
            toolCallsTotal++
            this.logger.log(
              JSON.stringify({
                chatId,
                userId: owner.id,
                tool: fname,
                ms: Date.now() - toolStartedAt,
                summary: `"${created.title}"`,
              }),
            )
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({
                ticketId: created.id,
                title: created.title,
                status: '已创建，等待坐席受理',
              }),
            })
            yield {
              type: 'tool',
              step: { tool: fname, status: 'done', summary: `"${created.title}"` },
            }
            continue
          }
          this.logger.log(
            JSON.stringify({
              chatId,
              userId: owner.id,
              tool: fname,
              ms: Date.now() - toolStartedAt,
              summary,
            }),
          )
          toolCallsTotal++
          if (sources?.length) collectedSources.push(...sources)
          if (ticket) createdTicket = ticket
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          })
          yield { type: 'tool', step: { tool: fname, status: 'done', summary } }
          // 反思信号采集：执行失败（error）或空检索
          if (isToolResultError(result)) roundFailed = true
          if (isEmptySearch(result)) roundEmptySearch = true
        }

        // —— 反思轮：定向干预，强制模型处理失败/空检索，避免含糊带过或重复检索 ——
        if (roundFailed) {
          messages.push({
            role: 'user',
            content:
              '注意：上一步工具执行未成功。请检查参数修正后重新调用，或放弃调用工具直接回答用户。',
          })
        } else if (roundEmptySearch) {
          messages.push({
            role: 'user',
            content:
              '注意：知识库未检索到相关内容。若用户问题缺少关键信息（设备、报错、账号等），请直接向用户提出澄清问题；信息充分且确需人工处理时再创建工单，不要重复检索。',
          })
        }
      }

      // 死循环哨兵：触顶退出说明模型反复调工具未收敛，告警便于观察
      if (toolCallsTotal >= maxRounds) {
        this.logger.warn(
          JSON.stringify({
            chatId,
            userId: owner.id,
            toolCalls: toolCallsTotal,
            maxRounds,
            reason: 'hit-round-cap',
          }),
        )
      }

      // —— 阶段二：产出回答 ——
      // 引用溯源与工单事件先于正文（前端用于挂载到消息上）
      if (createdTicket) {
        yield { type: 'ticket', ticket: createdTicket }
      }
      if (collectedSources.length > 0) {
        yield { type: 'sources', sources: collectedSources }
      }

      let fullReply = ''
      if (directAnswer) {
        // 模型在工具循环中直接给出回答（未调用工具）：整段输出
        fullReply = directAnswer
        completionTokensTotal += estimateTokens(directAnswer)
        yield { type: 'content', text: directAnswer }
      } else {
        // 基于工具结果流式生成最终回答（不再带工具，纯文本输出）
        // stream_options 用于取精确 usage；部分兼容层不支持则降级重试 + 估算
        let upstream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
        try {
          upstream = await openai.chat.completions.create({
            model: resolvedModel,
            messages,
            stream: true,
            stream_options: { include_usage: true },
          })
        } catch {
          this.logger.warn(`stream_options 不被兼容层支持，token 用量回退估算: chat=${chatId}`)
          upstream = await openai.chat.completions.create({
            model: resolvedModel,
            messages,
            stream: true,
          })
        }
        for await (const chunk of upstream) {
          // 末块携带 usage（include_usage 开启时）
          if (chunk.usage) {
            promptTokensTotal += chunk.usage.prompt_tokens ?? 0
            completionTokensTotal += chunk.usage.completion_tokens ?? 0
          }
          const text = chunk.choices[0]?.delta?.content || ''
          if (text) {
            fullReply += text
            yield { type: 'content', text }
          }
        }
        // 降级路径（无 usage 块）：估算补齐
        if (completionTokensTotal === 0) {
          completionTokensTotal += estimateTokens(fullReply)
          promptTokensTotal += estimateTokens(JSON.stringify(messages))
        }
      }

      if (fullReply) {
        await this.saveAiMessage(chatId, fullReply, resolvedModel, collectedSources, {
          promptTokens: promptTokensTotal,
          completionTokens: completionTokensTotal,
        })
        // 周期性（每 10 条消息）后台提取用户长期偏好记忆
        void this.maybeExtractPreferences(owner, chatId, openai, resolvedModel)
      }

      // Agent 会话级结构化摘要：轮次/工具数/引用数/耗时/token
      this.logger.log(
        JSON.stringify({
          chatId,
          userId: owner.id,
          model: resolvedModel,
          toolCalls: toolCallsTotal,
          sources: collectedSources.length,
          ticket: createdTicket?.title || null,
          replyChars: fullReply.length,
          promptTokens: promptTokensTotal,
          completionTokens: completionTokensTotal,
          totalMs: Date.now() - streamStartedAt,
        }),
      )
    }.bind(this)

    // 外层守卫：客户端断连（controller 触发 generator.return()）时保存半成品回答，
    // 避免已生成的正文/引用/工单引用丢失（工具副作用如建单已发生，不可回滚）
    const guarded = async function* (this: ChatService): AsyncGenerator<AgentStreamEvent> {
      let partialReply = ''
      let completed = false
      try {
        for await (const evt of run) {
          if (evt.type === 'content') partialReply += evt.text
          yield evt
        }
        // run 正常耗尽 = 完整回答已在生成器内部保存，无需补存
        completed = true
      } finally {
        // 仅中断路径（generator.return()）：保存半截内容供续看
        if (!completed && partialReply.trim()) {
          await this.savePartialMessage(chatId, partialReply)
        }
      }
    }.bind(this)

    return { stream: guarded() }
  }

  // 周期性后台提取用户长期偏好记忆（每 10 条消息触发一次，失败仅告警）
  private async maybeExtractPreferences(
    owner: { id: string; role: string; department: string | null },
    chatId: string,
    openai: OpenAI,
    model: string,
  ) {
    try {
      const total = await this.prisma.message.count({ where: { chatId } })
      if (total % 10 !== 0) return
      const recent = await this.prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { role: true, content: true },
      })
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你是用户记忆整理助手。从对话中提取值得长期记住的用户信息（偏好、工作环境、设备信息、未完成事项等），输出 JSON 字符串数组，每项不超过 100 字；没有则输出 []。只输出 JSON。',
          },
          {
            role: 'user',
            content: recent
              .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, 300)}`)
              .join('\n')
              .slice(0, 4000),
          },
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 300,
      })
      const raw = (completion.choices[0]?.message?.content || '[]')
        .replace(/```json|```/g, '')
        .trim()
      const facts: unknown = JSON.parse(raw)
      if (Array.isArray(facts)) {
        for (const f of facts.slice(0, 10)) {
          if (typeof f === 'string' && f.trim()) {
            await this.memoryService.remember(owner.id, 'preference', f, chatId)
          }
        }
        this.logger.log(`extracted ${facts.length} preference facts for user ${owner.id}`)
      }
    } catch (err) {
      this.logger.warn(
        `preference extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
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

// 工具结果是否含 error（执行失败/参数错误/未知工具）→ 触发反思轮
function isToolResultError(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'error' in result
}

// 工具结果是否为"知识库空检索"（{ message: ... }）→ 触发反思轮
function isEmptySearch(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    typeof (result as { message?: unknown }).message === 'string'
  )
}
