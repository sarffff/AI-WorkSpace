import { IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export const TICKET_STATUSES = ['open', 'processing', 'resolved', 'closed'] as const

// 创建工单
export class CreateTicketDto {
  @IsString()
  @Length(1, 80, { message: '标题长度需为 1-80 字' })
  title: string

  @IsString()
  @IsNotEmpty({ message: '请描述问题' })
  @MaxLength(2000, { message: '描述过长（最多 2000 字）' })
  content: string

  @IsOptional()
  @IsIn(PRIORITIES, { message: '优先级不合法' })
  priority?: string
}

// 更新工单（坐席/管理员：状态、优先级、受理人；创建者：仅可关闭自己的工单）
export class UpdateTicketDto {
  @IsOptional()
  @IsIn(TICKET_STATUSES, { message: '状态不合法' })
  status?: string

  @IsOptional()
  @IsIn(PRIORITIES, { message: '优先级不合法' })
  priority?: string

  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '受理人 ID 不合法' })
  assigneeId?: string | null
}
