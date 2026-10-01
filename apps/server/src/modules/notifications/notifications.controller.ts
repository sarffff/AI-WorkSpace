import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'
import { NotificationsService } from './notifications.service'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // 最近通知列表 + 未读数（铃铛轮询）
  @Get()
  list(@UserId() userId: string) {
    return this.notifications.list(userId)
  }

  @Post('read-all')
  readAll(@UserId() userId: string) {
    return this.notifications.markAllRead(userId)
  }

  @Post(':id/read')
  read(@UserId() userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id)
  }
}
