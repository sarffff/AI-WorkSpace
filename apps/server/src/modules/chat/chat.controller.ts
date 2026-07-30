import { Controller, Get, Post, Patch, Delete, Body, Param, Res, Header } from '@nestjs/common'
import { Response } from 'express'
import { ChatService } from './chat.service'

// 临时默认用户 ID（后续接入鉴权后替换）
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'

@Controller('chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ===== 会话管理 =====

  // 获取最近对话列表
  @Get()
  async getChats() {
    return this.chatService.getRecentChats(DEFAULT_USER_ID)
  }

  // 创建新会话
  @Post()
  async createChat(@Body() body: { title?: string }) {
    return this.chatService.createChat(DEFAULT_USER_ID, body.title)
  }

  // 重命名会话
  @Patch(':id')
  async renameChat(@Param('id') id: string, @Body() body: { title: string }) {
    return this.chatService.renameChat(id, body.title)
  }

  // 切换固定状态
  @Patch(':id/pin')
  async togglePinChat(@Param('id') id: string) {
    return this.chatService.togglePinChat(id)
  }

  // 删除会话
  @Delete(':id')
  async deleteChat(@Param('id') id: string) {
    await this.chatService.deleteChat(id)
    return { success: true }
  }

  // 获取会话消息列表
  @Get(':id/messages')
  async getMessages(@Param('id') id: string) {
    return this.chatService.getMessages(id)
  }

  // ===== AI 对话 =====

  // 非流式对话（一次返回完整响应）
  @Post(':id/completions')
  async completions(@Param('id') id: string, @Body() body: { prompt: string; model?: string }) {
    const data = await this.chatService.generateAiResponse(id, body.prompt, body.model)
    return { success: true, data }
  }

  // 流式对话（SSE），逐 token 推送
  @Post(':id/completions/stream')
  @Header('Cache-Control', 'no-cache')
  async streamCompletions(
    @Param('id') id: string,
    @Body() body: { prompt: string; model?: string },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    try {
      for await (const chunk of this.chatService.streamAiResponse(id, body.prompt, body.model)) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    } finally {
      res.end()
    }
  }
}
