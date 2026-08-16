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

  // 读取全部配置，DB 值覆盖默认值
  async getAll(): Promise<Record<string, string>> {
    const rows = await this.prisma.setting.findMany()
    const map: Record<string, string> = { ...DEFAULTS }
    for (const row of rows) {
      map[row.key] = row.value
    }
    return map
  }

  // 读取单个配置项
  async get(key: string): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key } })
    return row?.value ?? DEFAULTS[key] ?? ''
  }

  // 批量 upsert 配置项，返回更新后的完整配置
  async setMany(entries: Record<string, string>): Promise<Record<string, string>> {
    for (const [key, value] of Object.entries(entries)) {
      await this.prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }
    return this.getAll()
  }
}
