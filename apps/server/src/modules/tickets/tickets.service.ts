import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { CreateTicketDto, CreateTicketCommentDto, UpdateTicketDto } from './tickets.dto'

const AUTHOR_BRIEF = { select: { id: true, name: true, email: true, role: true } }

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
}

// 工单可见/可操作的判断：
// - 普通员工：只看到/操作自己创建的工单，可关闭自己的工单
// - 坐席/管理员：看到全部工单，可更新状态/优先级/受理人
@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  private isStaff(user: { role: string }) {
    return user.role === 'agent' || user.role === 'admin'
  }

  // 可见性校验 + 取单（员工仅自己的，坐席/管理员全部）
  private async getVisibleTicket(user: { id: string; role: string }, id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } })
    if (!ticket || (!this.isStaff(user) && ticket.creatorId !== user.id)) {
      throw new NotFoundException('工单不存在')
    }
    return ticket
  }

  // 系统事件写入时间线（状态流转/受理/转派/优先级调整）
  private async addSystemEvent(ticketId: string, operatorId: string, content: string) {
    await this.prisma.ticketComment.create({
      data: { ticketId, authorId: operatorId, kind: 'system', content },
    })
  }

  // 列表：员工看自己的，坐席/管理员看全部（含创建者/受理人摘要 + 最新一条时间线预览）
  async list(user: { id: string; role: string }) {
    const tickets = await this.prisma.ticket.findMany({
      where: this.isStaff(user) ? {} : { creatorId: user.id },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        creator: AUTHOR_BRIEF,
        assignee: AUTHOR_BRIEF,
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { kind: true, content: true, createdAt: true },
        },
      },
    })
    return tickets
  }

  // 可分派坐席列表（agent/admin），供工单转派下拉使用
  async listStaff() {
    return this.prisma.user.findMany({
      where: { role: { in: ['agent', 'admin'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
  }

  async create(userId: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.ticket.create({
      data: {
        creatorId: userId,
        title: dto.title,
        content: dto.content,
        priority: dto.priority || 'normal',
      },
      include: {
        creator: AUTHOR_BRIEF,
        assignee: AUTHOR_BRIEF,
      },
    })
    // AI 自动建单或手动建单：时间线留痕，便于坐席了解来源
    await this.addSystemEvent(
      ticket.id,
      userId,
      dto.source === 'agent'
        ? 'AI 对话中自动升级创建工单'
        : `工单已创建（优先级：${PRIORITY_LABEL[ticket.priority]}）`,
    )
    return ticket
  }

  // 详情：创建者或坐席/管理员，含时间线（评论 + 系统事件）
  async detail(user: { id: string; role: string }, id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        creator: AUTHOR_BRIEF,
        assignee: AUTHOR_BRIEF,
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: AUTHOR_BRIEF },
        },
      },
    })
    if (!ticket || (!this.isStaff(user) && ticket.creatorId !== user.id)) {
      throw new NotFoundException('工单不存在')
    }
    return ticket
  }

  // 评论：创建者与坐席/管理员可留言（时间线沟通闭环）
  async addComment(user: { id: string; role: string }, id: string, dto: CreateTicketCommentDto) {
    await this.getVisibleTicket(user, id)
    return this.prisma.ticketComment.create({
      data: {
        ticketId: id,
        authorId: user.id,
        kind: 'comment',
        content: dto.content.trim(),
      },
      include: { author: AUTHOR_BRIEF },
    })
  }

  // 更新：员工只能关闭自己的工单；坐席/管理员可全量更新（变更自动写入时间线）
  async update(user: { id: string; role: string }, id: string, dto: UpdateTicketDto) {
    const ticket = await this.getVisibleTicket(user, id)
    if (!this.isStaff(user)) {
      // 普通员工仅允许将自己的工单置为 closed
      if (dto.status !== 'closed' || dto.priority || dto.assigneeId) {
        throw new NotFoundException('无权修改')
      }
    }

    const data: { status?: string; priority?: string; assigneeId?: string | null } = {}
    if (dto.status) data.status = dto.status
    if (dto.priority) data.priority = dto.priority
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId
    // 指派受理人且未显式给状态时，自动进入处理中
    if (dto.assigneeId && !dto.status && ticket.status === 'open') data.status = 'processing'

    const updated = await this.prisma.ticket.update({
      where: { id },
      data,
      include: {
        creator: AUTHOR_BRIEF,
        assignee: AUTHOR_BRIEF,
      },
    })

    // 变更留痕（优先级标签员工无权限改，仅坐席触达）
    const events: string[] = []
    if (dto.priority && dto.priority !== ticket.priority) {
      events.push(`优先级调整为「${PRIORITY_LABEL[dto.priority]}」`)
    }
    if (data.status && data.status !== ticket.status) {
      events.push(`状态变更为「${STATUS_LABEL[data.status]}」`)
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
      if (dto.assigneeId) {
        const assignee = await this.prisma.user.findUnique({
          where: { id: dto.assigneeId },
          select: { name: true, email: true },
        })
        const label = assignee ? assignee.name || assignee.email : '未知用户'
        events.push(ticket.assigneeId ? `转派给 ${label}` : `由 ${label} 受理`)
      } else {
        events.push('受理人已移除')
      }
    }
    for (const e of events) {
      await this.addSystemEvent(id, user.id, e)
    }

    return updated
  }

  async remove(user: { id: string; role: string }, id: string) {
    await this.getVisibleTicket(user, id)
    await this.prisma.ticket.delete({ where: { id } })
    return { success: true }
  }
}
