import { IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator'

// 创建/更新提示词的请求体
export class SavePromptDto {
  @IsString()
  @Length(1, 60, { message: '标题长度需为 1-60 字' })
  title: string

  @IsString()
  @IsNotEmpty({ message: '请输入提示词内容' })
  @MaxLength(5000, { message: '内容过长（最多 5000 字）' })
  content: string

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: '分类名过长' })
  category?: string
}
