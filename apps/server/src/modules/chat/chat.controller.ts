import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Res,
  Header,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { ChatService } from './chat.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ===== 会话管理 =====

  // 获取最近对话列表
  @Get()
  async getChats(@UserId() userId: string) {
    return this.chatService.getRecentChats(userId)
  }

  // 创建新会话
  @Post()
  async createChat(@UserId() userId: string, @Body() body: { title?: string }) {
    return this.chatService.createChat(userId, body.title)
  }

  // 重命名会话（仅限本人会话）
  @Patch(':id')
  async renameChat(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { title: string },
  ) {
    return this.chatService.renameChat(userId, id, body.title)
  }

  // 切换固定状态（仅限本人会话）
  @Patch(':id/pin')
  async togglePinChat(@UserId() userId: string, @Param('id') id: string) {
    return this.chatService.togglePinChat(userId, id)
  }

  // 删除会话（仅限本人会话）
  @Delete(':id')
  async deleteChat(@UserId() userId: string, @Param('id') id: string) {
    await this.chatService.deleteChat(userId, id)
    return { success: true }
  }

  // 获取会话消息列表（仅限本人会话）
  @Get(':id/messages')
  async getMessages(@UserId() userId: string, @Param('id') id: string) {
    return this.chatService.getMessages(userId, id)
  }

  // ===== AI 对话 =====

  // 非流式对话（一次返回完整响应）
  @Post(':id/completions')
  async completions(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { prompt: string; model?: string; useRag?: boolean },
  ) {
    await this.chatService.assertOwned(userId, id)
    const data = await this.chatService.generateAiResponse(id, body.prompt, body.model, body.useRag)
    return { success: true, data }
  }

  // 流式对话（SSE），逐 token 推送
  @Post(':id/completions/stream')
  @Header('Cache-Control', 'no-cache')
  async streamCompletions(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { prompt: string; model?: string; useRag?: boolean },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    try {
      await this.chatService.assertOwned(userId, id)
      for await (const chunk of this.chatService.streamAiResponse(
        id,
        body.prompt,
        body.model,
        body.useRag,
      )) {
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
