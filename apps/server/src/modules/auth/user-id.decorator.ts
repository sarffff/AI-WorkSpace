import { createParamDecorator, ExecutionContext } from '@nestjs/common'

// 从 request.user 取当前登录用户 ID（需先应用 JwtAuthGuard）
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest()
  return request.user?.id
})
