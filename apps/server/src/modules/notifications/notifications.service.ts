import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'

export interface NotificationInput {
  type: string
  title: string
  body: string
  payload?: unknown
}

// ===== 站内通知 =====
//
// 工单事件（新单待受理/指派/状态变更）与 SLA 预警触达对应用户，前端轮询未读数。
// 发送是 fire-and-forget 语义：通知失败不该回滚主链路（建单/改状态），
// 因此 send() 内部吞掉异常仅告警，调用方可放心 void 调用。
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(private readonly prisma: PrismaService) {}

  async send(userIds: string[], input: NotificationInput): Promise<void> {
    const targets = [...new Set(userIds.filter(Boolean))]
    if (targets.length === 0) return
    try {
      await this.prisma.notification.createMany({
        data: targets.map((userId) => ({
          userId,
          type: input.type,
          title: input.title,
          body: input.body.slice(0, 500),
          payload: input.payload as Prisma.InputJsonValue | undefined,
        })),
      })
    } catch (err) {
      this.logger.warn(
        `send notification failed (type=${input.type}, users=${targets.length}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  // 最近通知 + 未读数（前端铃铛轮询一次拿全）
  async list(userId: string, limit = 50) {
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ])
    return { items, unreadCount }
  }

  async markRead(userId: string, id: string) {
    // updateMany 带 userId 条件：别人的通知改不到（update 单条会先抛再判权，多一次读）
    const res = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    })
    if (res.count === 0) throw new NotFoundException('通知不存在')
    return { success: true }
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    })
    return { updated: res.count }
  }
}
