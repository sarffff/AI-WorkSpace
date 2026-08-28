import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { CreateTicketDto, UpdateTicketDto } from './tickets.dto'

// 工单可见/可操作的判断：
// - 普通员工：只看到/操作自己创建的工单，可关闭自己的工单
// - 坐席/管理员：看到全部工单，可更新状态/优先级/受理人
@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService) {}

  private isStaff(user: { role: string }) {
    return user.role === 'agent' || user.role === 'admin'
  }

  // 列表：员工看自己的，坐席/管理员看全部（含创建者/受理人摘要）
  async list(user: { id: string; role: string }) {
    const tickets = await this.prisma.ticket.findMany({
      where: this.isStaff(user) ? {} : { creatorId: user.id },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
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
    return this.prisma.ticket.create({
      data: {
        creatorId: userId,
        title: dto.title,
        content: dto.content,
        priority: dto.priority || 'normal',
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })
  }

  // 详情：创建者或坐席/管理员
  async detail(user: { id: string; role: string }, id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })
    if (!ticket || (!this.isStaff(user) && ticket.creatorId !== user.id)) {
      throw new NotFoundException('工单不存在')
    }
    return ticket
  }

  // 更新：员工只能关闭自己的工单；坐席/管理员可全量更新（受理自动标记处理中）
  async update(user: { id: string; role: string }, id: string, dto: UpdateTicketDto) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } })
    if (!ticket || (!this.isStaff(user) && ticket.creatorId !== user.id)) {
      throw new NotFoundException('工单不存在')
    }
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

    return this.prisma.ticket.update({
      where: { id },
      data,
      include: {
        creator: { select: { id: true, name: true, email: true } },
        assignee: { select: { id: true, name: true, email: true } },
      },
    })
  }

  async remove(user: { id: string; role: string }, id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } })
    if (!ticket || (!this.isStaff(user) && ticket.creatorId !== user.id)) {
      throw new NotFoundException('工单不存在')
    }
    await this.prisma.ticket.delete({ where: { id } })
    return { success: true }
  }
}
