import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

// ===== 对话附件字节落盘 =====
//
// 与工单附件（ticket-attachment.store.ts）同一思路：字节落本地磁盘，DB 只存元数据。
// 目录独立（data/chat-attachments）：对话附件的生命周期跟会话走，与工单证据分开清理。
// 附件 id 是 Prisma 生成的 uuid，但它直接拼进文件路径，仍显式校验防目录穿越。

const DEFAULT_DIR = 'data/chat-attachments'
const SAFE_ID = /^[0-9a-f-]{1,64}$/i

// 单附件上限：对话附件是证据补充（日志/截图），不是知识库导入，8MB 足够
export const MAX_CHAT_ATTACHMENT_BYTES = 8 * 1024 * 1024

// 允许的附件类型：文本类（Agent 可读）+ 常见图片（人看/下载，Agent 仅知存在）
export const CHAT_ATTACHMENT_EXTS = new Set([
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
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
])

export function isSafeChatAttachmentId(id: string): boolean {
  return SAFE_ID.test(id)
}

@Injectable()
export class ChatAttachmentStore {
  private readonly logger = new Logger(ChatAttachmentStore.name)
  private readonly dir: string
  private ready = false

  constructor(config: ConfigService) {
    const raw = config.get<string>('CHAT_ATTACHMENT_DIR') || DEFAULT_DIR
    this.dir = resolve(process.cwd(), raw)
  }

  private pathFor(id: string): string | null {
    if (!isSafeChatAttachmentId(id)) {
      this.logger.error(`拒绝处理非法附件 id（疑似路径注入）: ${id.slice(0, 64)}`)
      return null
    }
    return join(this.dir, `${id}.bin`)
  }

  private async ensureDir(): Promise<void> {
    if (this.ready) return
    await mkdir(this.dir, { recursive: true })
    this.ready = true
  }

  /** 写入字节；失败抛出 —— 调用方先写盘再落库，落盘失败必须让建行也失败 */
  async write(id: string, buffer: Buffer): Promise<void> {
    const file = this.pathFor(id)
    if (!file) throw new Error('非法附件 id')
    await this.ensureDir()
    await writeFile(file, buffer)
  }

  /** 读回字节；不存在或 id 非法返回 null */
  async read(id: string): Promise<Buffer | null> {
    const file = this.pathFor(id)
    if (!file) return null
    try {
      return await readFile(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
  }

  /** 删除副本；不存在即已达成目的，失败仅告警 */
  async remove(id: string): Promise<void> {
    const file = this.pathFor(id)
    if (!file) return
    try {
      await unlink(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(
          `对话附件副本删除失败（磁盘可能残留）: ${id}, ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  async removeMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.remove(id)))
  }
}
