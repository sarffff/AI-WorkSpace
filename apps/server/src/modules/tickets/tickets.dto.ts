import { IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator'
import { TICKET_CATEGORIES } from './ticket-taxonomy'

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

  // 工单分类：缺省由 DB 默认值归入 other
  @IsOptional()
  @IsIn(TICKET_CATEGORIES, { message: '分类不合法' })
  category?: string

  // 建单来源标记：agent = AI 对话中自动升级（内部调用），缺省 = 手动创建
  @IsOptional()
  @IsIn(['agent', 'manual'], { message: '来源不合法' })
  source?: string
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

  // 坐席纠正 Agent 判错的分类（变更写入时间线留痕）
  @IsOptional()
  @IsIn(TICKET_CATEGORIES, { message: '分类不合法' })
  category?: string
}

// 工单评论（创建者与坐席/管理员均可在时间线留言）
export class CreateTicketCommentDto {
  @IsString()
  @IsNotEmpty({ message: '评论内容不能为空' })
  @MaxLength(1000, { message: '评论过长（最多 1000 字）' })
  content: string
}
