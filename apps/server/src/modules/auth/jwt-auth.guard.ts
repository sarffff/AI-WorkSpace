import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

// 全局可用的 JWT 认证守卫：校验 Bearer token 并把用户挂到 request.user
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
