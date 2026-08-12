import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { UserId } from '../auth/user-id.decorator'
import { TicketsService } from './tickets.service'

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  list(@UserId() userId: string, @Query('status') status?: string) {
    return this.ticketsService.list(userId, status)
  }

  @Get(':id')
  get(@UserId() userId: string, @Param('id') id: string) {
    return this.ticketsService.get(userId, id)
  }

  @Post()
  create(
    @UserId() userId: string,
    @Body()
    body: {
      externalRef?: string
      title: string
      description: string
      customerName: string
      customerEmail?: string
      priority?: string
    },
  ) {
    return this.ticketsService.create(userId, body)
  }

  @Patch(':id')
  update(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; priority?: string; status?: string },
  ) {
    return this.ticketsService.update(userId, id, body)
  }

  @Post(':id/generate-suggestion')
  generateSuggestion(@UserId() userId: string, @Param('id') id: string) {
    return this.ticketsService.generateSuggestion(userId, id)
  }

  @Post(':id/suggestions/:suggestionId/decision')
  decideSuggestion(
    @UserId() userId: string,
    @Param('id') id: string,
    @Param('suggestionId') suggestionId: string,
    @Body() body: { approved: boolean; content?: string; note?: string },
  ) {
    return this.ticketsService.decideSuggestion(userId, id, suggestionId, body)
  }
}
