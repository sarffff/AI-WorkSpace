import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

// 默认值，DB 中未设置时的回退
const DEFAULTS: Record<string, string> = {
  llmBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
  llmApiKey: '',
  llmModel: 'GLM-4-Flash',
}

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  // 读取某用户的全部配置，DB 值覆盖默认值
  async getAll(userId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany({ where: { userId } })
    const map: Record<string, string> = { ...DEFAULTS }
    for (const row of rows) {
      map[row.key] = row.value
    }
    return map
  }

  // 读取某用户的单个配置项
  async get(userId: string, key: string): Promise<string> {
    const row = await this.prisma.setting.findUnique({
      where: { userId_key: { userId, key } },
    })
    return row?.value ?? DEFAULTS[key] ?? ''
  }

  // 批量 upsert 某用户的配置项，返回更新后的完整配置
  async setMany(userId: string, entries: Record<string, string>): Promise<Record<string, string>> {
    for (const [key, value] of Object.entries(entries)) {
      await this.prisma.setting.upsert({
        where: { userId_key: { userId, key } },
        update: { value },
        create: { userId, key, value },
      })
    }
    return this.getAll(userId)
  }
}
