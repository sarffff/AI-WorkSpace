import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { TicketsService } from './tickets.service'
import { CreateTicketDto, UpdateTicketDto } from './tickets.dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser } from '../auth/user-id.decorator'
import type { SafeUser } from '../auth/auth.service'

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  // 工单列表（员工只看自己的，坐席/管理员看全部）
  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.ticketsService.list(user)
  }

  @Post()
  create(@CurrentUser() user: SafeUser, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(user.id, dto)
  }

  @Get(':id')
  detail(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.ticketsService.detail(user, id)
  }

  @Patch(':id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.ticketsService.update(user, id, dto)
  }

  @Delete(':id')
  remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.ticketsService.remove(user, id)
  }
}
