import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common'
import { SettingsService } from './settings.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // 获取当前用户的全部配置
  @Get()
  async getSettings(@UserId() userId: string) {
    return this.settingsService.getAll(userId)
  }

  // 更新当前用户的配置（支持部分更新）
  @Patch()
  async updateSettings(@UserId() userId: string, @Body() body: Record<string, string>) {
    return this.settingsService.setMany(userId, body)
  }
}
