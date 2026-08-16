import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '@/prisma/prisma.service'
import { RegisterDto, LoginDto } from './auth.dto'

export interface SafeUser {
  id: string
  email: string
  name: string | null
  avatar: string | null
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // 注册：校验邮箱唯一 → bcrypt 加密 → 建用户 → 签发 token
  // 兼容历史无密码用户：已有记录则补写密码（视为认领账号）
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing?.password) throw new ConflictException('该邮箱已被注册')

    const hashedPassword = await bcrypt.hash(dto.password, 10)
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { password: hashedPassword, name: dto.name || existing.name },
        })
      : await this.prisma.user.create({
          data: { email: dto.email, password: hashedPassword, name: dto.name },
        })

    return this.buildAuthResponse(user)
  }

  // 登录：校验密码 → 签发 token
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user || !user.password) throw new UnauthorizedException('邮箱或密码错误')

    const valid = await bcrypt.compare(dto.password, user.password)
    if (!valid) throw new UnauthorizedException('邮箱或密码错误')

    return this.buildAuthResponse(user)
  }

  // JWT 策略回调：token 里的 sub → 用户（挂在 request.user 上）
  async validateUser(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new UnauthorizedException('用户不存在')
    return this.toSafeUser(user)
  }

  // ===== 工具方法 =====

  private buildAuthResponse(user: {
    id: string
    email: string
    name: string | null
    avatar: string | null
  }) {
    const token = this.jwtService.sign({ sub: user.id, email: user.email })
    return { token, user: this.toSafeUser(user) }
  }

  private toSafeUser(user: {
    id: string
    email: string
    name: string | null
    avatar: string | null
  }): SafeUser {
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  }
}
