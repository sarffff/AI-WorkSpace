import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { ChatAttachmentStore } from '../chat-attachment.store'
import type { InferArgs } from './schema'
import type { AgentTool, ToolContext, ToolResult } from './types'

// 可读文本扩展名：与知识库 TEXT_EXTS 口径一致的子集 + 常见日志/配置后缀。
// 二进制（图片/压缩包）不在此列：读出来也是乱码，直接告诉模型读不了比喂噪声好。
export const READABLE_TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'log',
  'json',
  'csv',
  'xml',
  'yml',
  'yaml',
  'html',
  'css',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'java',
  'go',
  'sql',
  'sh',
  'bat',
  'ini',
  'toml',
])

/** 注入上下文时的单附件截断上限（字符）：超长内容靠 read_attachment 取全文 */
export const ATTACHMENT_INJECT_CHARS = 8000
/** 工具读取的全文上限（字符）：决策循环的 token 大头防护 */
export const ATTACHMENT_READ_CHARS = 32000

// ===== 对话附件读取工具 =====
//
// 用户在会话里提交的附件，正文默认截断注入当前轮上下文；截断过、或模型需要回看
// 原文细节时用本工具取全文。只读、无副作用，同轮可并行。
@Injectable()
export class ReadAttachmentTool implements AgentTool<typeof ReadAttachmentTool.schema> {
  readonly name = 'read_attachment'
  readonly description =
    '读取本轮对话附件的全文文本（用户随提问提交的日志/配置/文档）。附件内容在上下文里被截断、或需要回看原文细节时调用；图片等二进制附件不可读。'
  readonly readOnly = true

  static readonly schema = {
    attachment_id: {
      type: 'string',
      description: '附件 id：取自本轮上下文附件清单或用户消息中的附件标记',
      required: true,
      nonEmpty: true,
      message: '参数错误: attachment_id 必须是非空字符串，请修正参数后重试',
    },
  } as const

  readonly schema = ReadAttachmentTool.schema

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ChatAttachmentStore,
  ) {}

  async execute(
    args: InferArgs<typeof ReadAttachmentTool.schema>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.chatId) {
      return { result: { message: '缺少会话上下文，无法读取附件' }, summary: '无会话上下文' }
    }
    // 限定本会话：别会话的附件 id 一律查无（不暴露存在性）
    const row = await this.prisma.chatAttachment.findFirst({
      where: { id: args.attachment_id, chatId: ctx.chatId },
    })
    if (!row) {
      return { result: { message: '附件不存在或不属于本会话' }, summary: '附件不存在' }
    }
    const ext = row.name.split('.').pop()?.toLowerCase() || ''
    if (!READABLE_TEXT_EXTS.has(ext)) {
      return {
        result: { message: `二进制附件 .${ext || 'unknown'} 不可读，仅文本类附件支持读取` },
        summary: `二进制附件不可读: ${row.name}`,
      }
    }
    const buffer = await this.store.read(row.id)
    if (!buffer) {
      return { result: { message: '附件字节已丢失' }, summary: '附件字节丢失' }
    }
    const full = buffer.toString('utf8')
    const content = full.slice(0, ATTACHMENT_READ_CHARS)
    return {
      result: {
        name: row.name,
        chars: content.length,
        truncated: full.length > content.length,
        content,
      },
      summary: `读取附件 ${row.name}（${content.length} 字符）`,
    }
  }
}
