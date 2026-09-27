import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { CreateTicketDto, CreateTicketCommentDto, UpdateTicketDto } from './tickets.dto'
import { CATEGORY_LABEL, TICKET_CATEGORIES } from './ticket-taxonomy'
import {
  backtestDispatch,
  previewDispatch,
  type DispatchAgent,
  type DispatchTicketRow,
} from './dispatch-preview'

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

  // ===== 派单预演：只读，一个字段都不写 =====
  //
  // 「这单该给谁」目前是坐席的临场判断。在让机器接手之前，先拿历史工单量一遍命中率
  // （口径住在 dispatch-preview.ts）：猜不中就说明路由规则不在分类维度里，自动派单不该上。
  // 刻意不写库 —— 猜错的代价是单子在路上多躺一天，这个决定要用数字换，不能拿工单换。

  /** 预演窗口比看板的 90 天上限长：派单要的是"谁做过这类"，窗口太短根本没有经验可学 */
  private static readonly DISPATCH_MAX_DAYS = 365
  private static readonly DISPATCH_DEFAULT_DAYS = 90
  /** 时间线里"第一次派错了"的标记，与 update() 写入的事件文案同源 */
  private static readonly REASSIGN_EVENT_PREFIX = '转派给'

  private dispatchDays(days?: number) {
    const d = typeof days === 'number' && Number.isFinite(days) ? Math.round(days) : 0
    if (d <= 0) return TicketsService.DISPATCH_DEFAULT_DAYS
    return Math.min(d, TicketsService.DISPATCH_MAX_DAYS)
  }

  /**
   * 预演数据：花名册 + 工单行。
   * 时间窗是「createdAt 在窗口内 或 至今未完结」，后半句不能省 —— 只按窗口取会把
   * 三个月前挂到现在的老单当成不存在，手上压着老单的坐席反而算出来最闲。
   */
  private async loadDispatchData(
    days: number,
  ): Promise<{ agents: DispatchAgent[]; rows: DispatchTicketRow[] }> {
    const since = new Date(Date.now() - days * 86_400_000)
    const [users, tickets] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: { in: ['agent', 'admin'] } },
        select: { id: true, name: true, email: true, department: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: { OR: [{ createdAt: { gte: since } }, { status: { in: ['open', 'processing'] } }] },
        select: {
          id: true,
          title: true,
          category: true,
          priority: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          assigneeId: true,
          creator: { select: { department: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return {
      agents: users.map((u) => ({ id: u.id, name: u.name || u.email, department: u.department })),
      rows: tickets.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        priority: t.priority,
        assigneeId: t.assigneeId,
        creatorDepartment: t.creator.department,
        createdAt: t.createdAt,
        // 完结时刻用 updatedAt 近似。时间线里的「已解决」事件更准，但为一次预演去拉
        // 全部工单评论不值：resolvedAt 只管"何时起可作证据"和负载，两处都是偏保守的次级依据
        resolvedAt: t.status === 'resolved' || t.status === 'closed' ? t.updatedAt : null,
      })),
    }
  }

  async dispatchPreview(
    user: { role: string },
    days?: number,
    limit?: number,
    knobs: { minEvidence?: number; maxLoad?: number | null } = {},
  ) {
    if (!this.isStaff(user)) {
      throw new ForbiddenException('仅坐席/管理员可查看派单预演')
    }
    const periodDays = this.dispatchDays(days)
    const { agents, rows } = await this.loadDispatchData(periodDays)
    // 缺省/非法/0 都退回 50：清单再长也不该一屏灌不完
    const capped = Math.min(Math.max(Math.round(limit ?? 0) || 50, 1), 200)
    return {
      periodDays,
      roster: agents,
      ...previewDispatch(rows, agents, new Date(), {
        limit: capped,
        minEvidence: knobs.minEvidence,
        maxLoad: knobs.maxLoad,
      }),
    }
  }

  /**
   * 历史回测：把每张派过人的单假装成没派过，只用它创建之前的经验重派一次。
   *
   * 命中的是"最终受理人"，而转过派的单第一次其实派错了 —— 所以另取转派事件，
   * 单独报「这次转派本可以省掉」的条数，否则这个数字会把猜中纠正结果当成猜中首派。
   */
  async dispatchBacktest(
    user: { role: string },
    days?: number,
    knobs: { minEvidence?: number; decisionsLimit?: number } = {},
  ) {
    if (!this.isStaff(user)) {
      throw new ForbiddenException('仅坐席/管理员可查看派单回测')
    }
    const periodDays = this.dispatchDays(days)
    const { agents, rows } = await this.loadDispatchData(periodDays)
    const assignedIds = rows.filter((r) => r.assigneeId).map((r) => r.id)
    const reassignEvents = assignedIds.length
      ? await this.prisma.ticketComment.findMany({
          where: {
            kind: 'system',
            content: { startsWith: TicketsService.REASSIGN_EVENT_PREFIX },
            ticketId: { in: assignedIds },
          },
          select: { ticketId: true },
        })
      : []
    return backtestDispatch(rows, agents, {
      reassignTicketIds: new Set(reassignEvents.map((e) => e.ticketId)),
      minEvidence: knobs.minEvidence,
      decisionsLimit: knobs.decisionsLimit,
    })
  }

  // ===== 坐席看板统计（仅坐席/管理员） =====
  // 偏转率 = 1 − AI 升级工单数 / 活跃会话数（期间内有活动的 Chat）
  // SLA：期内已解决工单按优先级阈值（urgent 4h / high 8h / normal 24h / low 48h）统计达标率；
  // 解决时间取时间线系统事件，无记录的旧工单回退 updatedAt（近似）
  private static readonly SLA_HOURS: Record<string, number> = {
    urgent: 4,
    high: 8,
    normal: 24,
    low: 48,
  }

  async stats(user: { role: string }, days = 30) {
    if (!this.isStaff(user)) {
      throw new ForbiddenException('仅坐席/管理员可查看统计')
    }
    const since = new Date(Date.now() - days * 86400_000)

    const [activeSessions, periodTickets, backlogRows] = await Promise.all([
      this.prisma.chat.count({ where: { updatedAt: { gte: since } } }),
      this.prisma.ticket.findMany({
        where: { createdAt: { gte: since } },
        include: { comments: { where: { kind: 'system' }, orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { status: { in: ['open', 'processing'] } },
        _count: { _all: true },
      }),
    ])

    // 工单解决时刻：时间线「已解决」事件优先，旧数据回退 updatedAt
    const resolvedAtOf = (t: (typeof periodTickets)[number]) => {
      const ev = t.comments.find((c) => c.content.includes('已解决'))
      if (ev) return ev.createdAt
      return t.status === 'resolved' || t.status === 'closed' ? t.updatedAt : null
    }
    // 首次响应时刻：时间线「由 X 受理」事件
    const claimedAtOf = (t: (typeof periodTickets)[number]) => {
      const ev = t.comments.find((c) => /^由 .+ 受理$/.test(c.content))
      return ev ? ev.createdAt : null
    }
    const hours = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3600_000

    const statusCount: Record<string, number> = { open: 0, processing: 0, resolved: 0, closed: 0 }
    for (const t of periodTickets) statusCount[t.status] = (statusCount[t.status] || 0) + 1
    const escalated = periodTickets.filter((t) => t.source === 'agent').length

    // SLA：期内已解决（resolved/closed）的工单
    const resolvedTickets = periodTickets.filter(
      (t) => t.status === 'resolved' || t.status === 'closed',
    )
    let slaMet = 0
    const resolutionHours: number[] = []
    const firstResponseHours: number[] = []
    for (const t of resolvedTickets) {
      const resolvedAt = resolvedAtOf(t)
      if (resolvedAt) {
        const h = hours(t.createdAt, resolvedAt)
        resolutionHours.push(h)
        if (h <= (TicketsService.SLA_HOURS[t.priority] ?? 24)) slaMet++
      }
      const claimedAt = claimedAtOf(t)
      if (claimedAt) firstResponseHours.push(hours(t.createdAt, claimedAt))
    }
    const avg = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null

    // 按分类分布：识别高频问题类型 —— 高频且 AI 升级占比高的分类，
    // 说明该类知识库覆盖不足，是知识沉淀的优先方向
    const byCategory = TICKET_CATEGORIES.map((category) => {
      const list = periodTickets.filter((t) => t.category === category)
      return {
        category,
        total: list.length,
        escalated: list.filter((t) => t.source === 'agent').length,
        resolved: list.filter((t) => t.status === 'resolved' || t.status === 'closed').length,
      }
    }).filter((c) => c.total > 0)

    // 按优先级分布
    const byPriority = ['urgent', 'high', 'normal', 'low'].map((priority) => {
      const list = periodTickets.filter((t) => t.priority === priority)
      let met = 0
      for (const t of list) {
        const resolvedAt = resolvedAtOf(t)
        if (
          resolvedAt &&
          hours(t.createdAt, resolvedAt) <= (TicketsService.SLA_HOURS[priority] ?? 24)
        ) {
          met++
        }
      }
      return {
        priority,
        total: list.length,
        escalated: list.filter((t) => t.source === 'agent').length,
        resolved: list.filter((t) => t.status === 'resolved' || t.status === 'closed').length,
        slaMet: met,
      }
    })

    const backlog = backlogRows.reduce((acc, r) => acc + r._count._all, 0)
    const round = (n: number) => Math.round(n * 1000) / 1000

    return {
      periodDays: days,
      sessions: activeSessions,
      tickets: {
        total: periodTickets.length,
        escalated,
        manual: periodTickets.length - escalated,
        ...statusCount,
      },
      backlog, // 当前未完结（待处理+处理中）存量
      deflectRate: activeSessions > 0 ? round(Math.max(0, 1 - escalated / activeSessions)) : null,
      sla: {
        met: slaMet,
        total: resolvedTickets.length,
        rate: resolvedTickets.length ? round(slaMet / resolvedTickets.length) : null,
        avgResolutionHours: avg(resolutionHours),
        avgFirstResponseHours: avg(firstResponseHours),
        thresholdHours: TicketsService.SLA_HOURS,
      },
      byPriority,
      byCategory,
    }
  }

  /**
   * @param internal 只给服务端内部调用（Agent 建单）用的字段：来源与归属会话。
   *   刻意不放进 CreateTicketDto —— 那会让客户端能自报「我是 AI 升级的」并指定归属会话，
   *   而这两个值正是偏转率的分子。
   */
  async create(
    userId: string,
    dto: CreateTicketDto,
    internal: { source?: 'agent' | 'manual'; chatId?: string | null } = {},
  ) {
    const source = internal.source === 'agent' ? 'agent' : 'manual'
    const ticket = await this.prisma.ticket.create({
      data: {
        creatorId: userId,
        title: dto.title,
        content: dto.content,
        priority: dto.priority || 'normal',
        category: dto.category || 'other',
        source,
        chatId: internal.chatId ?? null,
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
      source === 'agent'
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
      // 普通员工仅允许将自己的工单置为 closed（分类纠正同属坐席权限）
      if (dto.status !== 'closed' || dto.priority || dto.assigneeId || dto.category) {
        throw new NotFoundException('无权修改')
      }
    }

    const data: {
      status?: string
      priority?: string
      assigneeId?: string | null
      category?: string
    } = {}
    if (dto.status) data.status = dto.status
    if (dto.priority) data.priority = dto.priority
    if (dto.category) data.category = dto.category
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
    // 分类纠正留痕：记录改前改后，便于回看 Agent 判错的分类分布
    if (dto.category && dto.category !== ticket.category) {
      events.push(
        `分类由「${CATEGORY_LABEL[ticket.category] ?? ticket.category}」调整为「${
          CATEGORY_LABEL[dto.category] ?? dto.category
        }」`,
      )
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
      if (dto.assigneeId) {
        const assignee = await this.prisma.user.findUnique({
          where: { id: dto.assigneeId },
          select: { name: true, email: true },
        })
        const label = assignee ? assignee.name || assignee.email : '未知用户'
        events.push(
          ticket.assigneeId
            ? `${TicketsService.REASSIGN_EVENT_PREFIX} ${label}`
            : `由 ${label} 受理`,
        )
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
