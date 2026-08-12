import { Controller, Get, Patch, Body, UseGuards, BadRequestException } from '@nestjs/common'
import { SettingsService } from './settings.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

// 可修改的配置项（DB 覆盖，重启仍生效）
export interface SettingsPatch {
  llmApiKey?: string | null
  llmApiUrl?: string | null
  llmModel?: string | null
  llmModels?: string | null
  embeddingApiKey?: string | null
  embeddingBaseUrl?: string | null
  embeddingModel?: string | null
  ragTopK?: number | null
  ragThreshold?: number | null
  agentMaxIterations?: number | null
  agentApprovalTools?: string | null
  memoryThreshold?: number | null
}

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // 读取全部可配置项（敏感值脱敏）
  @Get()
  async getSettings() {
    const items = await this.settingsService.getAllMasked()
    return { success: true, data: items }
  }

  // 部分更新（null 恢复环境变量默认）
  @Patch()
  async updateSettings(@Body() body: SettingsPatch) {
    const map: Record<string, string | null> = {
      LLM_API_KEY: body.llmApiKey ?? null,
      LLM_API_URL: body.llmApiUrl ?? null,
      LLM_API_MODEL: body.llmModel ?? null,
      LLM_MODELS: body.llmModels ?? null,
      EMBEDDING_API_KEY: body.embeddingApiKey ?? null,
      EMBEDDING_BASE_URL: body.embeddingBaseUrl ?? null,
      EMBEDDING_MODEL: body.embeddingModel ?? null,
    }

    const keys = Object.keys(map) as (keyof typeof map)[]
    const provided = keys.filter((k) => k in body)
    if (
      provided.length === 0 &&
      body.ragTopK === undefined &&
      body.ragThreshold === undefined &&
      body.agentMaxIterations === undefined &&
      body.agentApprovalTools === undefined &&
      body.memoryThreshold === undefined
    ) {
      throw new BadRequestException('没有可更新的配置项')
    }

    for (const key of provided) {
      await this.settingsService.set(key as never, map[key] as never)
    }

    if (body.ragTopK !== undefined) {
      await this.settingsService.set(
        'RAG_TOP_K',
        body.ragTopK === null ? null : String(body.ragTopK),
      )
    }
    if (body.ragThreshold !== undefined) {
      await this.settingsService.set(
        'RAG_THRESHOLD',
        body.ragThreshold === null ? null : String(body.ragThreshold),
      )
    }
    if (body.agentMaxIterations !== undefined) {
      await this.settingsService.set(
        'AGENT_MAX_ITERATIONS',
        body.agentMaxIterations === null ? null : String(body.agentMaxIterations),
      )
    }
    if (body.agentApprovalTools !== undefined) {
      await this.settingsService.set('AGENT_APPROVAL_TOOLS', body.agentApprovalTools)
    }
    if (body.memoryThreshold !== undefined) {
      await this.settingsService.set(
        'MEMORY_THRESHOLD',
        body.memoryThreshold === null ? null : String(body.memoryThreshold),
      )
    }

    return { success: true }
  }
}
