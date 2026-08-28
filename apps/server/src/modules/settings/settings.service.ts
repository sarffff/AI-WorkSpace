import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

// 默认值，DB 中未设置时的回退（RAG 检索参数支持环境变量覆盖，作为全局默认）
const DEFAULTS: Record<string, string> = {
  llmBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
  llmApiKey: '',
  llmModel: 'GLM-4-Flash',
  // RAG 检索参数：Setting 表按用户覆盖，环境变量为全局默认
  ragTopK: process.env.RAG_TOP_K || '4',
  ragMinScore: process.env.RAG_MIN_SCORE || '0.25',
  ragCoarseTopK: process.env.RAG_COARSE_TOP_K || '20',
  ragRerank: process.env.RAG_RERANK || 'on',
  ragQueryRewrite: process.env.RAG_QUERY_REWRITE || 'on',
  // Agent 工具决策循环轮数上限（死循环哨兵边界，可经 Setting/env 调参）
  ragAgentMaxRounds: process.env.RAG_AGENT_MAX_ROUNDS || '4',
  // 上下文工程：历史 token 预算（超出部分压缩为会话摘要）
  ragHistoryTokens: process.env.RAG_HISTORY_TOKENS || '6000',
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
