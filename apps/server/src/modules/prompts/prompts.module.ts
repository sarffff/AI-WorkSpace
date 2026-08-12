import { Module, OnModuleInit } from '@nestjs/common'
import { PromptsService } from './prompts.service'
import { PromptsController } from './prompts.controller'

@Module({
  providers: [PromptsService],
  controllers: [PromptsController],
})
export class PromptsModule implements OnModuleInit {
  constructor(private readonly promptsService: PromptsService) {}

  async onModuleInit() {
    await this.promptsService.seedPresets()
  }
}
