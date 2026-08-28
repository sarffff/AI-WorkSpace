import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { PromptsService } from './prompts.service'
import { SavePromptDto } from './prompts.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  // 当前用户的提示词列表（首次访问自动初始化预设）
  @Get()
  list(@UserId() userId: string) {
    return this.promptsService.list(userId)
  }

  @Post()
  create(@UserId() userId: string, @Body() dto: SavePromptDto) {
    return this.promptsService.create(userId, dto)
  }

  @Patch(':id')
  update(@UserId() userId: string, @Param('id') id: string, @Body() dto: SavePromptDto) {
    return this.promptsService.update(userId, id, dto)
  }

  @Delete(':id')
  remove(@UserId() userId: string, @Param('id') id: string) {
    return this.promptsService.remove(userId, id)
  }
}
