import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'

// ===== 上传字节落盘（让索引任务能跨重启续跑）=====
//
// 原先上传的文件字节只在 IndexingQueueService 的内存 Map 里，进程一重启就没了：
// 索引到一半的文档既取不回任务也读不到原文件，只能永远卡在 processing。
// 上一轮的处理是「启动时把它判成中断并置 failed」—— 那只解决状态不收敛，
// 用户仍然得重新上传。这里补上真正的续跑能力：字节先落盘，重启后按 documentId 取回重排。
//
// 选本地磁盘而不是 Redis/对象存储：本项目的索引吞吐撑不起引入外部依赖，
// 而且文件本来就已经完整进内存（multer 默认 memoryStorage），落盘只是把它多留一份。
// 不引入 Redis 也符合仓内既有立场（见 indexing-queue.service.ts 的设计说明）。

const DEFAULT_DIR = 'data/uploads'

// documentId 来自 Prisma 生成的 uuid；仍要显式校验 —— 它直接拼进文件路径，
// 一旦哪条调用链把它换成了用户可控值，就是目录穿越读写任意文件
const SAFE_ID = /^[0-9a-f-]{1,64}$/i

export function isSafeDocumentId(id: string): boolean {
  return SAFE_ID.test(id)
}

@Injectable()
export class UploadPayloadStore {
  private readonly logger = new Logger(UploadPayloadStore.name)
  private readonly dir: string
  private ready = false

  constructor(config: ConfigService) {
    const raw = config.get<string>('UPLOAD_STORE_DIR') || DEFAULT_DIR
    this.dir = resolve(process.cwd(), raw)
  }

  private pathFor(documentId: string): string | null {
    if (!isSafeDocumentId(documentId)) {
      this.logger.error(`拒绝处理非法 documentId（疑似路径注入）: ${documentId.slice(0, 64)}`)
      return null
    }
    return join(this.dir, `${documentId}.bin`)
  }

  private async ensureDir(): Promise<void> {
    if (this.ready) return
    await mkdir(this.dir, { recursive: true })
    this.ready = true
  }

  /** 写入原始字节；失败不抛出（调用方仍可走内存路径，只是失去续跑能力） */
  async write(documentId: string, buffer: Buffer): Promise<boolean> {
    const file = this.pathFor(documentId)
    if (!file) return false
    try {
      await this.ensureDir()
      await writeFile(file, buffer)
      return true
    } catch (err) {
      this.logger.warn(
        `上传字节落盘失败（该文档重启后无法续跑索引）: ${documentId}, ` +
          (err instanceof Error ? err.message : String(err)),
      )
      return false
    }
  }

  /** 读回字节；不存在或 id 非法返回 null。真实 IO 错误照常抛出，由调用方区分「没有」与「读不动」 */
  async read(documentId: string): Promise<Buffer | null> {
    const file = this.pathFor(documentId)
    if (!file) return null
    try {
      return await readFile(file)
    } catch (err) {
      // ENOENT 是「没有副本」这一档；其余（权限、IO）抛给调用方，别被误判成文档已不可得
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw err
    }
  }

  /** 删除副本：索引成功或已进终态都要删，否则磁盘只增不减 */
  async remove(documentId: string): Promise<void> {
    const file = this.pathFor(documentId)
    if (!file) return
    try {
      await unlink(file)
    } catch {
      // 不存在即已达成目的
    }
  }
}
