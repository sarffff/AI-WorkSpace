import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class AuthService {
  // 登录限流：按邮箱计数，15 分钟内最多 MAX_FAILURES 次失败
  private readonly MAX_FAILURES = 5
  private readonly WINDOW_MS = 15 * 60 * 1000
  private loginFailures = new Map<string, { count: number; resetAt: number }>()

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
    this.checkLoginLimit(email)

    const user = await this.prisma.user.findUnique({ where: { email } })
    const valid = user && user.password ? await bcrypt.compare(password, user.password) : false
    if (!user || !valid) {
      this.recordLoginFailure(email)
      throw new UnauthorizedException('邮箱或密码错误')
    }

    this.loginFailures.delete(email)
    return this.buildAuthResponse(user)
  }

  // 校验该邮箱是否已被限流
  private checkLoginLimit(email: string) {
    const entry = this.loginFailures.get(email)
    if (!entry) return
    if (Date.now() > entry.resetAt) {
      this.loginFailures.delete(email)
      return
    }
    if (entry.count >= this.MAX_FAILURES) {
      throw new HttpException('登录失败次数过多，请 15 分钟后再试', HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  // 记录一次失败
  private recordLoginFailure(email: string) {
    const entry = this.loginFailures.get(email)
    if (!entry || Date.now() > entry.resetAt) {
      this.loginFailures.set(email, { count: 1, resetAt: Date.now() + this.WINDOW_MS })
      return
    }
    entry.count += 1
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
