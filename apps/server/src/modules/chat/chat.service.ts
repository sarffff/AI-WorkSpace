import { Injectable, NotFoundException, Logger } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import OpenAI from 'openai'
import { ConfigService } from '@nestjs/config'
import { KnowledgeService, RagHit } from '@/modules/knowledge/knowledge.service'

@Injectable()
export class ChatService {
  private openai: OpenAI
  private readonly logger = new Logger(ChatService.name)

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private knowledgeService: KnowledgeService,
  ) {
    this.openai = new OpenAI({
      baseURL:
        this.configService.get<string>('LLM_API_URL') || 'https://open.bigmodel.cn/api/paas/v4/',
      apiKey: this.configService.get<string>('LLM_API_KEY'),
    })
  }

  // ===== 会话 CRUD =====

  // 获取所有会话，固定在前，按更新时间倒序，附带最后一条消息预览
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

  // 模型名：请求指定 > 环境配置 > 默认
  private resolveModel(model?: string): string {
    return model || this.configService.get<string>('LLM_API_MODEL') || 'glm-4.5-air'
  }

  // RAG：检索知识库 → 拼装 system context（无命中则返回空数组）
  private async buildRagContext(prompt: string): Promise<{
    hits: RagHit[]
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  }> {
    const hits = await this.knowledgeService.searchRelevant(prompt, 4)
    if (hits.length === 0) return { hits, messages: [] }

    const context = hits.map((h, i) => `[片段 ${i + 1}]\n${h.content}`).join('\n\n')
    this.logger.log(`RAG: ${hits.length} hits, scores=${hits.map((h) => h.score).join(',')}`)

    return {
      hits,
      messages: [
        {
          role: 'system',
          content: `你是 AI Workspace 的智能助手。请优先依据下面提供的「知识库上下文」回答用户问题，若其中没有相关信息，再结合自身知识作答，并如实说明。

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

  // 保存 AI 回复（顺带刷新会话时间）
  async saveAiMessage(chatId: string, content: string, model?: string) {
    const message = await this.prisma.message.create({
      data: { chatId, role: 'assistant', content, model },
    })
    await this.touchChat(chatId)
    return message
  }

  // 手动刷新会话 updatedAt（@updatedAt 只在直接 update Chat 时生效）
  private async touchChat(chatId: string) {
    await this.prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } })
  }

  // 非流式：保存消息 → RAG 检索 → 调 AI → 保存回复 → 返回
  async generateAiResponse(chatId: string, prompt: string, model?: string, useRag = true) {
    await this.saveUserMessage(chatId, prompt)
    const rag = useRag ? await this.buildRagContext(prompt) : { hits: [], messages: [] }
    const completion = await this.openai.chat.completions.create({
      model: this.resolveModel(model),
      messages: [...rag.messages, { role: 'user', content: prompt }],
    })
    const reply = completion.choices[0]?.message?.content || ''
    await this.saveAiMessage(chatId, reply, model)
    return reply
  }

  // 流式：保存消息 → RAG 检索 → 流式调 AI → 逐 token 返回 → 结束后保存完整回复
  async *streamAiResponse(
    chatId: string,
    prompt: string,
    model?: string,
    useRag = true,
  ): AsyncGenerator<string> {
    await this.saveUserMessage(chatId, prompt)
    const rag = useRag ? await this.buildRagContext(prompt) : { hits: [], messages: [] }
    const stream = await this.openai.chat.completions.create({
      model: this.resolveModel(model),
      messages: [...rag.messages, { role: 'user', content: prompt }],
      stream: true,
    })
    let fullReply = ''
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || ''
      if (content) {
        fullReply += content
        yield content
      }
    }
    if (fullReply) {
      await this.saveAiMessage(chatId, fullReply, model)
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
