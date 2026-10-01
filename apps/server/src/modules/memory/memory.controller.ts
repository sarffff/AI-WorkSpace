import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'
import { MemoryService } from './memory.service'

// 记忆管理：跨会话长期记忆的可见性与可删除性（个人信息合规的最小闭环）。
// 此前记忆只有写入与注入路径，用户既看不到 Agent 记住了什么也删不掉。
@Controller('memory')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  // 我的记忆列表（按分类 + 更新时间）
  @Get()
  list(@UserId() userId: string) {
    return this.memory.list(userId)
  }

  // 删除单条
  @Delete(':id')
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.memory.removeById(userId, id)
  }

  // 清空我的全部记忆
  @Delete()
  clear(@UserId() userId: string) {
    return this.memory.clear(userId)
  }
}
