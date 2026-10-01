import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator'

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

// ===== 成员管理（仅 admin） =====

// 管理员开通账号：企业引入默认关自助注册后的唯一建号入口
export class CreateUserDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string

  @IsString()
  @Length(8, 64, { message: '初始密码长度需为 8-64 位' })
  password: string

  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '昵称过长' })
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '部门名过长' })
  department?: string

  @IsOptional()
  @IsIn(['employee', 'agent', 'admin'], { message: '角色不合法' })
  role?: string
}

// 管理员修改成员：昵称/部门/角色（均可选，缺省不动）
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '昵称过长' })
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '部门名过长' })
  department?: string

  @IsOptional()
  @IsIn(['employee', 'agent', 'admin'], { message: '角色不合法' })
  role?: string
}

// 管理员重置成员密码（员工忘记密码时的旁路）
export class ResetPasswordDto {
  @IsString()
  @Length(8, 64, { message: '密码长度需为 8-64 位' })
  password: string
}
