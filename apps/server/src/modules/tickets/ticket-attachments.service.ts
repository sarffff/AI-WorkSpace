import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { TicketAttachmentStore } from './ticket-attachment.store'

// 工单附件：上传/列表/下载/删除。可见性沿用工单本身的行级规则
// （员工仅本人创建的工单，坐席/管理员全部）。字节走 TicketAttachmentStore 落盘，此处管元数据与鉴权。

// 单个附件体积上限：与知识库上传同量级，全程在内存 + 落盘，无上限单文件即可打爆内存。
// multipart 超限由 multer 抛 LIMIT_FILE_SIZE，控制器上的 UploadErrorFilter 归一成 413。
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

const ATTACHMENT_BRIEF = {
  id: true,
  filename: true,
  mimeType: true,
  size: true,
  uploaderId: true,
  createdAt: true,
} as const

@Injectable()
export class TicketAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: TicketAttachmentStore,
  ) {}

  private isStaff(user: { role: string }) {
    return user.role === 'agent' || user.role === 'admin'
  }

  // 工单可见性：员工仅本人创建的，坐席/管理员全部（与 TicketsService.getVisibleTicket 同口径）。
  // 不存在与越权都回 NotFound，不泄露"工单存在但你看不到"
  private async assertVisibleTicket(user: { id: string; role: string }, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, creatorId: true },
    })
    if (!ticket || (!this.isStaff(user) && ticket.creatorId !== user.id)) {
      throw new NotFoundException('工单不存在')
    }
    return ticket
  }

  async list(user: { id: string; role: string }, ticketId: string) {
    await this.assertVisibleTicket(user, ticketId)
    return this.prisma.ticketAttachment.findMany({
      where: { ticketId },
      select: ATTACHMENT_BRIEF,
      orderBy: { createdAt: 'asc' },
    })
  }

  // 上传：能看到工单的人即可加附件（员工给自己的单、坐席给任意单）。
  // 先落库拿到 id，再以该 id 为键写盘；写盘失败回滚 DB 行 —— 不留没有字节的空附件记录。
  async add(user: { id: string; role: string }, ticketId: string, file?: Express.Multer.File) {
    await this.assertVisibleTicket(user, ticketId)
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('未收到文件')
    }
    // 原始文件名可能是 latin1 编码（multer 默认），转回 UTF-8 保住中文名
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 191)
    const row = await this.prisma.ticketAttachment.create({
      data: {
        ticketId,
        uploaderId: user.id,
        filename,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
      },
      select: ATTACHMENT_BRIEF,
    })
    try {
      await this.store.write(row.id, file.buffer)
    } catch (err) {
      // 字节没落盘就把空记录删掉，避免列表里出现下载即 404 的幽灵附件
      await this.prisma.ticketAttachment.delete({ where: { id: row.id } }).catch(() => {})
      throw err
    }
    return row
  }

  // 下载：返回元数据 + 字节。行必须属于该工单（防止用别的工单 id 借道读到本不可见的附件）
  async getForDownload(user: { id: string; role: string }, ticketId: string, attachmentId: string) {
    await this.assertVisibleTicket(user, ticketId)
    const row = await this.prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, ticketId: true, filename: true, mimeType: true, size: true },
    })
    if (!row || row.ticketId !== ticketId) {
      throw new NotFoundException('附件不存在')
    }
    const bytes = await this.store.read(row.id)
    if (!bytes) {
      throw new NotFoundException('附件文件已丢失')
    }
    return { filename: row.filename, mimeType: row.mimeType, bytes }
  }

  // 删除：上传者本人或坐席/管理员。防止员工删掉坐席在自己工单上留的证据
  async remove(user: { id: string; role: string }, ticketId: string, attachmentId: string) {
    await this.assertVisibleTicket(user, ticketId)
    const row = await this.prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, ticketId: true, uploaderId: true },
    })
    if (!row || row.ticketId !== ticketId) {
      throw new NotFoundException('附件不存在')
    }
    if (row.uploaderId !== user.id && !this.isStaff(user)) {
      throw new ForbiddenException('只能删除自己上传的附件')
    }
    await this.prisma.ticketAttachment.delete({ where: { id: row.id } })
    await this.store.remove(row.id)
    return { success: true }
  }
}
