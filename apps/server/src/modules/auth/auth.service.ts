import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const SALT_LEN = 16
const HASH_LEN = 64

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  // 注册
  async register(email: string, password: string, name?: string) {
    const existing = await this.prisma.user.findUnique({ where: { email } })
    if (existing) throw new ConflictException('邮箱已注册')

    const hash = this.hashPassword(password)
    const user = await this.prisma.user.create({
      data: { email, password: hash, name: name || email.split('@')[0] },
    })
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  }

  // 登录
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new UnauthorizedException('邮箱或密码错误')

    if (!this.verifyPassword(password, user.password)) {
      throw new UnauthorizedException('邮箱或密码错误')
    }
    return { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
  }

  private hashPassword(password: string): string {
    const salt = randomBytes(SALT_LEN).toString('hex')
    const hash = scryptSync(password, salt, HASH_LEN).toString('hex')
    return `${salt}:${hash}`
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':')
    const derived = scryptSync(password, salt, HASH_LEN).toString('hex')
    return timingSafeEqual(Buffer.from(derived), Buffer.from(hash))
  }
}
