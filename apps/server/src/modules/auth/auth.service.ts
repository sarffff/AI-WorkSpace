import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '@/prisma/prisma.service'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import type { User } from '@prisma/client'
import { RegisterDto, LoginDto } from './auth.dto'

export interface SafeUser {
  id: string
  email: string
  name: string | null
  avatar: string | null
}

const FALLBACK_SECRET = 'ai-workspace-dev-secret'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // 注册：校验邮箱唯一 → 哈希密码 → 建用户 → 签发 token
  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (exists) throw new ConflictException('该邮箱已被注册')

    const password = await bcrypt.hash(dto.password, 10)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password,
        name: dto.name || dto.email.split('@')[0],
      },
    })
    return this.issueToken(user)
  }

  // 登录：比对密码哈希 → 签发 token
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (!user) throw new UnauthorizedException('邮箱或密码错误')

    // 兼容历史种子用户（默认哈希占位值无法通过校验）
    const valid =
      user.password && user.password !== 'default_hash_please_change'
        ? await bcrypt.compare(dto.password, user.password)
        : false
    if (!valid) throw new UnauthorizedException('邮箱或密码错误')

    return this.issueToken(user)
  }

  // 校验 token，返回当前用户信息
  async verifyUser(token: string): Promise<SafeUser> {
    try {
      const secret = this.config.get<string>('JWT_SECRET') || FALLBACK_SECRET
      const payload = jwt.verify(token, secret) as { sub: string }
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
      if (!user) throw new UnauthorizedException('用户不存在')
      return this.toSafeUser(user)
    } catch {
      throw new UnauthorizedException('登录已过期，请重新登录')
    }
  }

  // ===== 工具方法 =====

  private issueToken(user: User) {
    const secret = this.config.get<string>('JWT_SECRET') || FALLBACK_SECRET
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN') || '7d'
    const token = jwt.sign({ sub: user.id, email: user.email }, secret, {
      expiresIn,
    } as jwt.SignOptions)
    return { token, user: this.toSafeUser(user) }
  }

  private toSafeUser(user: User): SafeUser {
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  }
}
