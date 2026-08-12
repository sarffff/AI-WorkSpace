import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { PromptsService } from './prompts.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

@Controller('prompts')
@UseGuards(JwtAuthGuard)
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  // 内置预设 + 本人自定义
  @Get()
  async list(@UserId() userId: string) {
    return this.promptsService.list(userId)
  }

  @Post()
  async create(
    @UserId() userId: string,
    @Body() body: { name: string; category: string; description?: string; content: string },
  ) {
    return this.promptsService.create(userId, body)
  }

  @Patch(':id')
  async update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; category?: string; description?: string; content?: string },
  ) {
    return this.promptsService.update(userId, id, body)
  }

  @Delete(':id')
  async remove(@UserId() userId: string, @Param('id') id: string) {
    return this.promptsService.remove(userId, id)
  }
}
