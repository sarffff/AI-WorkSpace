import { Controller, Get, Patch, Body } from '@nestjs/common'
import { SettingsService } from './settings.service'

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // 获取全部配置
  @Get()
  async getSettings() {
    return this.settingsService.getAll()
  }

  // 更新配置（支持部分更新）
  @Patch()
  async updateSettings(@Body() body: Record<string, string>) {
    return this.settingsService.setMany(body)
  }
}
