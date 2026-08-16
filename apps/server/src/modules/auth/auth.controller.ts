import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { LoginDto, RegisterDto } from './auth.dto'
import { JwtAuthGuard } from './jwt-auth.guard'
import { UserId } from './user-id.decorator'

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
}
