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
  UseInterceptors,
  UseFilters,
  UploadedFile,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Throttle } from '@nestjs/throttler'
import { Response } from 'express'
import { ChatService, AgentStreamEvent } from './chat.service'
import { StreamSlotService } from './stream-slot.service'
import { StreamSessionService } from './stream-session.service'
import { MAX_CHAT_ATTACHMENT_BYTES } from './chat-attachment.store'
import { UploadErrorFilter } from '../knowledge/upload-error.filter'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

// 一条 Agent 流最少值 5 次上游调用（决策循环 + 生成），按次数限流而不只是按并发：
// 单用户在 STREAM_RATE_LIMIT/min 之内反复开流仍然会烧掉可观的模型配额
const streamRateLimit = parseInt(process.env.STREAM_RATE_LIMIT_PER_MIN ?? '', 10)
const STREAM_RATE_LIMIT =
  Number.isFinite(streamRateLimit) && streamRateLimit > 0 ? streamRateLimit : 20

// AgentStreamEvent → SSE data 帧载荷（与前端解析形状一致）
function serializeEvent(evt: AgentStreamEvent): Record<string, unknown> {
  if (evt.type === 'content') return { content: evt.text }
  if (evt.type === 'sources') return { sources: evt.sources }
  if (evt.type === 'tool') return { tool: evt.step }
  if (evt.type === 'ticket') return { ticket: evt.ticket }
  if (evt.type === 'confirm_required') return { confirm: evt.draft }
  return {}
}

@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly slots: StreamSlotService,
    private readonly sessions: StreamSessionService,
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
    // 旁路也要过闸门：客户端流式失败时会回退到这里，只守 SSE 等于没守
    await this.chatService.assertTokenBudget(userId)
    const { reply, sources } = await this.chatService.generateAiResponse(
      id,
      body.prompt,
      body.model,
      body.useRag,
      body.systemPrompt,
    )
    return { success: true, data: reply, sources }
  }

  // 流式对话（SSE）：生成与连接解耦 —— pump 后台消费 Agent 生成器写入会话缓冲，
  // 本端点只是订阅者：断连不退订泵，重连带 afterSeq 回放错过的事件（SSE resume）；
  // 显式中断走 POST :id/stop
  @Post(':id/completions/stream')
  @Header('Cache-Control', 'no-cache')
  @Throttle({ default: { limit: STREAM_RATE_LIMIT, ttl: 60_000 } })
  async streamCompletions(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body()
    body: {
      prompt?: string
      model?: string
      useRag?: boolean
      systemPrompt?: string
      attachments?: string[]
      resume?: boolean
      afterSeq?: number
    },
    @Res() res: Response,
  ) {
    await this.chatService.assertOwned(userId, id)

    let session = this.sessions.get(id)

    if (body.resume) {
      // 续订：只订阅既有会话，不占槽位不跑预检（生成早已在跑）
      if (!session) {
        res.status(404).json({
          statusCode: 404,
          message: '无可续订的流：该生成已结束或服务已重启，请重载会话消息',
        })
        return
      }
    } else {
      // 新提问：同会话上一条未结束直接拒（两条流会交错写消息、双份轨迹、各走一次确认门）
      if (session && !session.done) {
        res.status(409).json({
          statusCode: 409,
          message: '这个会话已有一条回答在进行中，请等它结束后再继续提问',
        })
        return
      }
      // 用量闸门必须在切 SSE 之前（且放在占槽之前）：客户端要能分清「预算用尽」和「回答出错」
      await this.chatService.assertTokenBudget(userId)
      if (!this.slots.tryAcquire(userId)) {
        const max = this.slots.maxPerUser()
        res.status(429).json({
          statusCode: 429,
          message: `已有 ${max} 条对话在进行中，请等当前回答结束后再试`,
          maxConcurrentStreams: max,
        })
        return
      }
      if (!this.slots.tryClaimChat(id, userId)) {
        this.slots.release(userId)
        res.status(409).json({
          statusCode: 409,
          message: '这个会话已有一条回答在进行中，请等它结束后再继续提问',
        })
        return
      }

      const abort = new AbortController()
      let stream: AsyncGenerator<AgentStreamEvent> | null = null
      session = this.sessions.create(id, userId, () => {
        abort.abort()
        // 光靠 generator.return() 收不回已发出的 HTTP 请求，signal 才是掐请求的
        void stream?.return(undefined as never).catch(() => {})
      })
      const owned = session
      // 停机排空走这条路：与 stop 端点同语义（done 帧带 stopped 标记）
      this.slots.registerCancel(id, () => {
        owned.stopped = true
        owned.cancel()
      })

      // 后台泵：生命周期独立于任何 HTTP 连接。断连只是退订，生成继续、回答照常落库；
      // 槽位/会话占用在泵收尾时归还，而不是请求结束时
      const requestId = String(res.getHeader('X-Request-Id') ?? '') || undefined
      void (async () => {
        try {
          const started = await this.chatService.startStream(
            id,
            body.prompt ?? '',
            body.model,
            body.useRag,
            body.systemPrompt,
            { requestId, signal: abort.signal, attachments: body.attachments },
          )
          stream = started.stream
          for await (const evt of stream) {
            this.sessions.push(id, serializeEvent(evt))
          }
          this.sessions.push(id, { done: true, stopped: owned.stopped === true })
        } catch (err) {
          // stop/停机取消是正常收尾（done+stopped）；其余抛错走 error 帧
          if (abort.signal.aborted) this.sessions.push(id, { done: true, stopped: true })
          else this.sessions.push(id, { error: err instanceof Error ? err.message : String(err) })
        } finally {
          this.sessions.finish(id)
          this.slots.unregisterCancel(id)
          this.slots.release(userId)
          this.slots.releaseChat(id)
        }
      })()
    }

    // SSE 写端：从 afterSeq 回放后 live-tail 至会话结束；连接关闭只退订不影响泵
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    const afterSeq = Math.max(0, Math.floor(Number(body.afterSeq) || 0))
    let closed = false
    let wakeClose!: () => void
    // close 唤醒必须即时生效：预检期断连时订阅会一直挂着等新事件，
    // 不 race 这个 promise 写循环就永远收不到「客户端走了」
    const closedPromise = new Promise<'closed'>((resolve) => {
      wakeClose = () => resolve('closed')
    })
    res.on('close', () => {
      closed = true
      wakeClose()
    })
    const sub = this.sessions.subscribe(id, afterSeq)
    try {
      for (;;) {
        if (closed) break
        const next = await Promise.race([sub.next(), closedPromise])
        if (next === 'closed' || next.done) break
        res.write(`id: ${next.value.seq}\ndata: ${JSON.stringify(next.value.payload)}\n\n`)
      }
    } catch {
      // 写端异常（客户端已走）：退订即可，泵继续
    } finally {
      void sub.return(undefined)
      // 无条件 end：连接已关时 express 内部 noop，但收尾语义必须完整（与旧实现一致）
      res.end()
    }
  }

  // 显式停止生成：流与连接解耦后，取消后台泵的唯一入口
  @Post(':id/stop')
  async stopStream(@UserId() userId: string, @Param('id') id: string) {
    await this.chatService.assertOwned(userId, id)
    const session = this.sessions.get(id)
    if (!session || session.done) return { success: false, message: '没有进行中的流' }
    session.stopped = true
    session.cancel()
    return { success: true }
  }

  // ===== 对话附件 =====

  // 上传（composer 纸夹）：字节落盘 + 元数据行，返回芯片信息
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CHAT_ATTACHMENT_BYTES } }))
  @UseFilters(new UploadErrorFilter(MAX_CHAT_ATTACHMENT_BYTES))
  async uploadAttachment(
    @UserId() userId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.chatService.addAttachment(userId, id, file)
  }

  @Get(':id/attachments')
  async listAttachments(@UserId() userId: string, @Param('id') id: string) {
    return this.chatService.listAttachments(userId, id)
  }

  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(
    @UserId() userId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const { row, buffer } = await this.chatService.downloadAttachment(userId, id, attachmentId)
    res.setHeader('Content-Type', row.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.name)}"`)
    res.end(buffer)
  }

  // 删除（仅上传者）：composer 里移除未发送的芯片时调用
  @Delete(':id/attachments/:attachmentId')
  async removeAttachment(
    @UserId() userId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.chatService.removeAttachment(userId, id, attachmentId)
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
