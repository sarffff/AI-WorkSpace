import { Module } from '@nestjs/common'
import { TasksService } from './tasks.service'
import { TasksController } from './tasks.controller'
import { SettingsModule } from '@/modules/settings/settings.module'

@Module({
  imports: [SettingsModule],
  providers: [TasksService],
  controllers: [TasksController],
})
export class TasksModule {}
