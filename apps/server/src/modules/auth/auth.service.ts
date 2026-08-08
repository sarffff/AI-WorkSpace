import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // 注册：校验邮箱唯一 → bcrypt 加密 → 建用户 → 签 JWT
  async register(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) {
      if (existing.password) throw new ConflictException('该邮箱已被注册')
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { password: hashedPassword, name: name || existing.name },
        })
      : await this.prisma.user.create({
          data: { email, password: hashedPassword, name },
        })

    return this.buildAuthResponse(user)
  }

  // 登录：校验密码 → 签 JWT
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user || !user.password) throw new UnauthorizedException('邮箱或密码错误')

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) throw new UnauthorizedException('邮箱或密码错误')

    return this.buildAuthResponse(user)
  }

  // JWT 策略回调：token 里的 sub → 用户
  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException('用户不存在')
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
    }
  }

  private buildAuthResponse(user: {
    id: string
    email: string
    name: string | null
    avatar: string | null
  }) {
    const token = this.jwtService.sign({ sub: user.id, email: user.email })
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      token,
    }
  }
}
