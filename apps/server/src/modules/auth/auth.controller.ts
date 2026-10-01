import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { AuthService, SafeUser } from './auth.service'
import { LoginDto, RegisterDto, CreateUserDto, UpdateUserDto, ResetPasswordDto } from './auth.dto'
import { JwtAuthGuard } from './jwt-auth.guard'
import { CurrentUser, UserId } from './user-id.decorator'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 注册新用户
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto)
  }

  // 密码登录
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  // 校验 token，返回当前用户信息（桌面端启动时探测会话有效性）
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@UserId() userId: string) {
    return this.authService.validateUser(userId)
  }

  // ===== 成员管理（仅 admin，服务层断言） =====

  // 成员列表 + 部门字典
  @Get('users')
  @UseGuards(JwtAuthGuard)
  listUsers(@CurrentUser() user: SafeUser) {
    return this.authService.listUsers(user)
  }

  // 开通账号（默认关自助注册后的唯一建号入口）
  @Post('users')
  @UseGuards(JwtAuthGuard)
  createUser(@CurrentUser() user: SafeUser, @Body() dto: CreateUserDto) {
    return this.authService.createUser(user, dto)
  }

  // 修改昵称/部门/角色
  @Patch('users/:id')
  @UseGuards(JwtAuthGuard)
  updateUser(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.authService.updateUser(user, id, dto)
  }

  // 重置成员密码
  @Post('users/:id/reset-password')
  @UseGuards(JwtAuthGuard)
  resetPassword(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(user, id, dto)
  }
}
