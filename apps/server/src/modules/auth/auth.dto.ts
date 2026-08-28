import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator'

// 注册请求体
export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string

  @IsString()
  @Length(6, 64, { message: '密码长度需为 6-64 位' })
  password: string

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '昵称过长' })
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '部门名过长' })
  department?: string
}

// 登录请求体
export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string

  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  password: string
}
