import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

// ===== 工单附件字节落盘 =====
//
// 与知识库上传（upload-payload.store.ts）同一思路：字节落本地磁盘，DB 只存元数据。
// 选磁盘而非对象存储与仓内既有立场一致 —— 不为附件这点吞吐引入外部依赖。
// 附件 id 是 Prisma 生成的 uuid，但它直接拼进文件路径，仍显式校验防目录穿越。

const DEFAULT_DIR = 'data/ticket-attachments'
const SAFE_ID = /^[0-9a-f-]{1,64}$/i

export function isSafeAttachmentId(id: string): boolean {
  return SAFE_ID.test(id)
}

@Injectable()
export class TicketAttachmentStore {
  private readonly logger = new Logger(TicketAttachmentStore.name)
  private readonly dir: string
  private ready = false

  constructor(config: ConfigService) {
    const raw = config.get<string>('TICKET_ATTACHMENT_DIR') || DEFAULT_DIR
    this.dir = resolve(process.cwd(), raw)
  }

  private pathFor(id: string): string | null {
    if (!isSafeAttachmentId(id)) {
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

  /** 写入字节；失败抛出 —— 附件的字节是唯一副本，落盘失败必须让建行也失败（调用方先写盘再落库） */
  async write(id: string, buffer: Buffer): Promise<void> {
    const file = this.pathFor(id)
    if (!file) throw new Error('非法附件 id')
    await this.ensureDir()
    await writeFile(file, buffer)
  }

  /** 读回字节；不存在或 id 非法返回 null（下载端据此回 404） */
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

  /** 删除副本（附件删除 / 工单级联删除时调用）；不存在即已达成目的，失败仅告警 */
  async remove(id: string): Promise<void> {
    const file = this.pathFor(id)
    if (!file) return
    try {
      await unlink(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.logger.warn(
          `附件副本删除失败（磁盘可能残留）: ${id}, ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  /** 批量删除（工单删除时清理其所有附件文件） */
  async removeMany(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.remove(id)))
  }
}
