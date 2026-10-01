import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { PrismaService } from '@/prisma/prisma.service'
import { RegisterDto, LoginDto, CreateUserDto, UpdateUserDto, ResetPasswordDto } from './auth.dto'

export interface SafeUser {
  id: string
  email: string
  name: string | null
  avatar: string | null
  department: string | null
  role: string
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  // 注册：校验邮箱唯一 → bcrypt 加密 → 建用户 → 签发 token
  // 兼容历史无密码用户：已有记录则补写密码（视为认领账号）。
  // 注册闸门：企业引入默认关闭自助注册（OPEN_REGISTRATION != true 即 403），
  // 账号改由管理员在成员管理开通 —— 开放自注册等于把内网服务台暴露给任意邮箱
  async register(dto: RegisterDto) {
    if ((this.config.get<string>('OPEN_REGISTRATION') ?? 'false').toLowerCase() !== 'true') {
      throw new ForbiddenException('注册通道已关闭，请联系管理员开通账号')
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing?.password) throw new ConflictException('该邮箱已被注册')

    const hashedPassword = await bcrypt.hash(dto.password, 10)
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            password: hashedPassword,
            name: dto.name || existing.name,
            department: dto.department ?? existing.department,
          },
        })
      : await this.prisma.user.create({
          data: {
            email: dto.email,
            password: hashedPassword,
            name: dto.name,
            department: dto.department,
          },
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

  // ===== 成员管理（仅 admin） =====

  private assertAdmin(actor: SafeUser) {
    if (actor.role !== 'admin') throw new ForbiddenException('需要管理员权限')
  }

  // 成员列表 + 部门字典（部门取自存量用户的去重值，供建号/改部门时下拉建议）
  async listUsers(actor: SafeUser) {
    this.assertAdmin(actor)
    const [users, deptRows] = await Promise.all([
      this.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          department: true,
          role: true,
          createdAt: true,
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.user.findMany({
        where: { department: { not: null } },
        distinct: ['department'],
        select: { department: true },
      }),
    ])
    return { users, departments: deptRows.map((r) => r.department as string).sort() }
  }

  async createUser(actor: SafeUser, dto: CreateUserDto) {
    this.assertAdmin(actor)
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
    if (existing) throw new ConflictException('该邮箱已存在')
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: await bcrypt.hash(dto.password, 10),
        name: dto.name,
        department: dto.department,
        role: dto.role || 'employee',
      },
    })
    return this.toSafeUser(user)
  }

  async updateUser(actor: SafeUser, id: string, dto: UpdateUserDto) {
    this.assertAdmin(actor)
    const target = await this.prisma.user.findUnique({ where: { id } })
    if (!target) throw new NotFoundException('用户不存在')
    // 最后一个 admin 不能被降级：否则全库再无管理员，成员管理与坐席看板永久锁死
    if (dto.role && dto.role !== 'admin' && target.role === 'admin') {
      const admins = await this.prisma.user.count({ where: { role: 'admin' } })
      if (admins <= 1) throw new ConflictException('不能修改最后一个管理员的角色')
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name ?? target.name,
        // 空串归一为 null：部门字典按 not null 去重，空串混进去会出现一个""选项
        department:
          dto.department !== undefined ? dto.department.trim() || null : target.department,
        role: dto.role ?? target.role,
      },
    })
    return this.toSafeUser(user)
  }

  // 重置密码：员工忘记密码的旁路；新密码由管理员线下传达
  async resetPassword(actor: SafeUser, id: string, dto: ResetPasswordDto) {
    this.assertAdmin(actor)
    const target = await this.prisma.user.findUnique({ where: { id } })
    if (!target) throw new NotFoundException('用户不存在')
    await this.prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(dto.password, 10) },
    })
    return { success: true }
  }

  // ===== 工具方法 =====

  private buildAuthResponse(user: {
    id: string
    email: string
    name: string | null
    avatar: string | null
    department: string | null
    role: string
  }) {
    const token = this.jwtService.sign({ sub: user.id, email: user.email })
    return { token, user: this.toSafeUser(user) }
  }

  private toSafeUser(user: {
    id: string
    email: string
    name: string | null
    avatar: string | null
    department: string | null
    role: string
  }): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      department: user.department,
      role: user.role,
    }
  }
}
