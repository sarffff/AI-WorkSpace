import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

// 文本建文档请求体（知识运营闭环入口：缺口候选晋升 / 坐席随手补 SOP）
export class CreateTextDocumentDto {
  @IsString()
  @Length(1, 120, { message: '文档名长度需为 1-120 字符' })
  name: string

  // 下限 20 字与服务端一致：一句话进库只会制造检索噪声
  @IsString()
  @Length(20, 200_000, { message: '文档正文需为 20-200000 字符' })
  content: string

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '部门名过长' })
  department?: string

  // 从哪条缺口晋升：文档落地即把该缺口记为已成文，出处就是这篇
  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '缺口工单号不合法' })
  fromGapTicketId?: string
}

// 缺口处置：成文 / 不打算成文 / 重新打开
export class SetGapStatusDto {
  @IsIn(['open', 'covered', 'dismissed'], { message: '缺口状态不合法' })
  status: 'open' | 'covered' | 'dismissed'

  @IsOptional()
  @IsString()
  @Length(1, 64, { message: '文档 id 不合法' })
  documentId?: string

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: '备注过长' })
  note?: string
}
