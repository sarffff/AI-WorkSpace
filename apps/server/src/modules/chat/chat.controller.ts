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
import { Throttle } from '@nestjs/throttler'
import { Response } from 'express'
import { ChatService, AgentStreamEvent } from './chat.service'
import { StreamSlotService } from './stream-slot.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

// 一条 Agent 流最少值 5 次上游调用（决策循环 + 生成），按次数限流而不只是按并发：
// 单用户在 STREAM_RATE_LIMIT/min 之内反复开流仍然会烧掉可观的模型配额
const streamRateLimit = parseInt(process.env.STREAM_RATE_LIMIT_PER_MIN ?? '', 10)
const STREAM_RATE_LIMIT =
  Number.isFinite(streamRateLimit) && streamRateLimit > 0 ? streamRateLimit : 20

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly slots: StreamSlotService,
  ) {}

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

  // 非流式对话（一次返回完整响应；systemPrompt 为注入的角色提示词）
  @Post(':id/completions')
  async completions(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { prompt: string; model?: string; useRag?: boolean; systemPrompt?: string },
  ) {
    await this.chatService.assertOwned(userId, id)
    const { reply, sources } = await this.chatService.generateAiResponse(
      id,
      body.prompt,
      body.model,
      body.useRag,
      body.systemPrompt,
    )
    return { success: true, data: reply, sources }
  }

  // 流式对话（SSE），逐 token 推送
  @Post(':id/completions/stream')
  @Header('Cache-Control', 'no-cache')
  @Throttle({ default: { limit: STREAM_RATE_LIMIT, ttl: 60_000 } })
  async streamCompletions(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { prompt: string; model?: string; useRag?: boolean; systemPrompt?: string },
    @Res() res: Response,
  ) {
    // 并发上限先行拦截，且必须在切到 SSE 之前：那样客户端拿到的才是真实 HTTP 429，
    // 而不是混在流内 error 帧里的文本 —— 前端把后者当"回答出错"处理，用户看不到是被限流
    if (!this.slots.tryAcquire(userId)) {
      const max = this.slots.maxPerUser()
      res.status(429).json({
        statusCode: 429,
        message: `已有 ${max} 条对话在进行中，请等当前回答结束后再试`,
        maxConcurrentStreams: max,
      })
      return
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    // 客户端断连（用户点停止/关窗口）即终止生成器：
    // 阶段一工具循环期间无事件输出，仅靠事件间检查会继续执行工具调用（含建单副作用）与 token 消耗
    let clientGone = false
    let stream: AsyncGenerator<AgentStreamEvent> | null = null
    res.on('close', () => {
      clientGone = true
      // 立即向生成器注入 return：下一个 await 恢复点即终止，finally 保存半成品回答
      void stream?.return(undefined as never).catch(() => {})
    })

    try {
      await this.chatService.assertOwned(userId, id)
      const started = await this.chatService.startStream(
        id,
        body.prompt,
        body.model,
        body.useRag,
        body.systemPrompt,
      )
      stream = started.stream
      // Agent 事件流：工具轨迹 / 确认请求 / 工单 / 引用溯源 均先于正文 token 推送
      for await (const evt of stream) {
        if (clientGone) break
        if (evt.type === 'content') {
          res.write(`data: ${JSON.stringify({ content: evt.text })}\n\n`)
        } else if (evt.type === 'sources') {
          res.write(`data: ${JSON.stringify({ sources: evt.sources })}\n\n`)
        } else if (evt.type === 'tool') {
          res.write(`data: ${JSON.stringify({ tool: evt.step })}\n\n`)
        } else if (evt.type === 'ticket') {
          res.write(`data: ${JSON.stringify({ ticket: evt.ticket })}\n\n`)
        } else if (evt.type === 'confirm_required') {
          res.write(`data: ${JSON.stringify({ confirm: evt.draft })}\n\n`)
        }
      }
      stream = null
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    } finally {
      res.end()
      // 正常结束、断连、抛错三条路径都经过这里，槽位不会泄漏
      this.slots.release(userId)
    }
  }

  // HITL 建单确认：用户在确认卡上选择后调用，恢复/终止挂起的 Agent 循环；
  // SSE 已断连时（内存注册表未命中）回查持久化草稿补建工单或置为拒绝
  @Post(':id/confirm-ticket')
  async confirmTicket(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { requestId: string; approved: boolean },
  ) {
    // 确认请求属于当前用户会话（requestId 内嵌 chatId，双重校验归属）
    if (!body?.requestId || !body.requestId.startsWith(`${id}:`)) {
      return { success: false, message: '确认请求与当前会话不匹配' }
    }
    await this.chatService.assertOwned(userId, id)
    const resolved = await this.chatService.resolveConfirm(body.requestId, body.approved)
    return { success: resolved }
  }

  // 答案满意度反馈：👍/👎（👎 可带原因标签）；feedback 传 null 撤销评价
  @Post(':id/messages/:messageId/feedback')
  async setMessageFeedback(
    @UserId() userId: string,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: { feedback: 'up' | 'down' | null; reason?: string | null },
  ) {
    const data = await this.chatService.setMessageFeedback(
      userId,
      id,
      messageId,
      body?.feedback ?? null,
      body?.reason,
    )
    return { success: true, data }
  }

  // 待确认建单草稿列表（SSE 断连后前端重载页面据此恢复未决确认卡）
  @Get(':id/ticket-drafts')
  async ticketDrafts(@UserId() userId: string, @Param('id') id: string) {
    await this.chatService.assertOwned(userId, id)
    return this.chatService.listPendingTicketDrafts(id)
  }
}
