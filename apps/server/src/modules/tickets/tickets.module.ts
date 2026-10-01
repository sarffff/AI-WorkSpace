import { Module } from '@nestjs/common'
import { NotificationsModule } from '@/modules/notifications/notifications.module'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'
import { SlaSchedulerService } from './sla-scheduler.service'
import { TicketAttachmentsService } from './ticket-attachments.service'
import { TicketAttachmentStore } from './ticket-attachment.store'

@Module({
  imports: [NotificationsModule],
  controllers: [TicketsController],
  providers: [TicketsService, TicketAttachmentsService, TicketAttachmentStore, SlaSchedulerService],
  exports: [TicketsService],
})
export class TicketsModule {}
