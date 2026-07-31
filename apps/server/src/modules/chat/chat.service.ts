import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import OpenAI from 'openai'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class ChatService {
  private openai: OpenAI

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.openai = new OpenAI({
      baseURL:
        this.configService.get<string>('LLM_BASE_URL') || 'https://open.bigmodel.cn/api/paas/v4/',
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

  // 重命名会话
  async renameChat(chatId: string, title: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new NotFoundException('会话不存在')
    return this.prisma.chat.update({ where: { id: chatId }, data: { title } })
  }

  // 切换固定状态
  async togglePinChat(chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new NotFoundException('会话不存在')
    return this.prisma.chat.update({ where: { id: chatId }, data: { pinned: !chat.pinned } })
  }

  // 删除会话
  async deleteChat(chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new NotFoundException('会话不存在')
    await this.prisma.chat.delete({ where: { id: chatId } })
  }

  // 获取会话消息列表
  async getMessages(chatId: string) {
    const chat = await this.prisma.chat.findUnique({ where: { id: chatId } })
    if (!chat) throw new NotFoundException('会话不存在')
    return this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
    })
  }

  // ===== AI 对话 =====

  // 保存用户消息
  async saveUserMessage(chatId: string, content: string) {
    return this.prisma.message.create({
      data: { chatId, role: 'user', content },
    })
  }

  // 保存 AI 回复
  async saveAiMessage(chatId: string, content: string, model?: string) {
    return this.prisma.message.create({
      data: { chatId, role: 'assistant', content, model },
    })
  }

  // 获取对话上下文（最近 N 条消息，用于多轮对话）
  private async getChatContext(
    chatId: string,
    maxMessages = 20,
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
    const messages = await this.prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      take: maxMessages,
    })
    // 反转为时间正序，并转换为 OpenAI 格式
    return messages.reverse().map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }))
  }

  // 非流式：保存消息 → 调 AI（带上下文） → 保存回复 → 返回
  async generateAiResponse(chatId: string, prompt: string, model?: string) {
    await this.saveUserMessage(chatId, prompt)
    const context = await this.getChatContext(chatId)
    const completion = await this.openai.chat.completions.create({
      model: model || this.configService.get<string>('LLM_MODEL') || 'GLM-4-Flash',
      messages: context,
    })
    const reply = completion.choices[0]?.message?.content || ''
    await this.saveAiMessage(chatId, reply, model)
    return reply
  }

  // 流式：保存用户消息 → 流式调 AI（带上下文） → 逐 token 返回 → 结束后保存完整回复
  async *streamAiResponse(chatId: string, prompt: string, model?: string): AsyncGenerator<string> {
    await this.saveUserMessage(chatId, prompt)
    const context = await this.getChatContext(chatId)
    const stream = await this.openai.chat.completions.create({
      model: model || this.configService.get<string>('LLM_MODEL') || 'GLM-4-Flash',
      messages: context,
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
