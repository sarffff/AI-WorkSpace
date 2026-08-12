import { Injectable, BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/prisma/prisma.service'

// 允许通过 API 覆盖的运行配置项
const MUTABLE_KEYS = [
  'LLM_API_KEY',
  'LLM_API_URL',
  'LLM_API_MODEL',
  'LLM_MODELS',
  'EMBEDDING_API_KEY',
  'EMBEDDING_BASE_URL',
  'EMBEDDING_MODEL',
  'RAG_TOP_K',
  'RAG_THRESHOLD',
  'AGENT_MAX_ITERATIONS',
  'AGENT_APPROVAL_TOOLS',
  'MEMORY_THRESHOLD',
] as const

export type MutableKey = (typeof MUTABLE_KEYS)[number]

const SENSITIVE_KEYS: ReadonlySet<string> = new Set(['LLM_API_KEY', 'EMBEDDING_API_KEY'])

// 按约定前缀分组，便于前端分区展示
export function keyGroup(key: string): 'llm' | 'embedding' | 'rag' {
  if (key.startsWith('LLM_')) return 'llm'
  if (key.startsWith('EMBEDDING_')) return 'embedding'
  return 'rag'
}

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  // 读取配置：DB 覆盖优先，其次环境变量
  async get(key: MutableKey): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } })
    if (row) return row.value
    return this.configService.get<string>(key) ?? null
  }

  async getNumber(key: MutableKey, fallback: number): Promise<number> {
    const raw = await this.get(key)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : fallback
  }

  // 写入/删除 DB 覆盖（传 null 恢复环境变量默认）
  async set(key: MutableKey, value: string | null) {
    if (!MUTABLE_KEYS.includes(key)) throw new BadRequestException(`不允许修改配置项: ${key}`)
    if (value === null) {
      await this.prisma.setting.deleteMany({ where: { key } })
      return null
    }
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    })
  }

  // 返回所有可修改配置（敏感值脱敏）
  async getAllMasked() {
    const rows = await this.prisma.setting.findMany()
    const dbValues = new Map(rows.map((r) => [r.key, r.value]))

    const out: { key: string; group: string; value: string; sensitive: boolean }[] = []
    for (const key of MUTABLE_KEYS) {
      const value = keysForHanle(key, dbValues.get(key) ?? this.configService.get<string>(key))
      out.push({
        key,
        group: keyGroup(key),
        value: SENSITIVE_KEYS.has(key) ? maskSecret(value ?? '') : (value ?? ''),
        sensitive: SENSITIVE_KEYS.has(key),
      })
    }
    return out
  }
}

// 特殊处理：LLM_MODELS 等逗号列表
function keysForHanle(key: string, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  return raw
}

// 敏感性字段脱敏：只保留末 4 位
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return '********'
  return `****${secret.slice(-4)}`
}
