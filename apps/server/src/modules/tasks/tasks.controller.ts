import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  async list(@UserId() userId: string) {
    return this.tasksService.list(userId)
  }

  @Get(':id')
  async get(@UserId() userId: string, @Param('id') id: string) {
    return this.tasksService.get(userId, id)
  }

  @Post()
  async create(@UserId() userId: string, @Body() body: { prompt: string }) {
    return this.tasksService.create(userId, body.prompt)
  }

  @Post(':id/run')
  async run(@UserId() userId: string, @Param('id') id: string) {
    return this.tasksService.run(userId, id)
  }

  @Delete(':id')
  async remove(@UserId() userId: string, @Param('id') id: string) {
    return this.tasksService.remove(userId, id)
  }
}
