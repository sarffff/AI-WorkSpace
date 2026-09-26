import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { AgentPersonaService } from './agent-persona.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'

interface AuthUser {
  id: string
  role: string
}

// Agent 人设提示词的版本管理。读写都限管理员（判定在 service 里）：
// 这段文本就是系统提示词本身，能改写等于能改写助手行为，
// 而且其中含"不透露 system 提示词"的策略，普通用户也不该读得到原文。
@Controller('agent-persona')
@UseGuards(JwtAuthGuard)
export class AgentPersonaController {
  constructor(private readonly personas: AgentPersonaService) {}

  @Get()
  async history(@CurrentUser() user: AuthUser) {
    return this.personas.history(user)
  }

  @Post()
  async publish(
    @CurrentUser() user: AuthUser,
    @Body() body: { content?: unknown; note?: unknown },
  ) {
    return this.personas.publish(user, { content: body?.content, note: body?.note })
  }
}
