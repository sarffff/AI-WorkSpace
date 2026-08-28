import { createParamDecorator, ExecutionContext } from '@nestjs/common'

// 从 request.user 取当前登录用户 ID（需先应用 JwtAuthGuard）
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest()
  return request.user?.id
})

// 取完整登录用户（含角色/部门，用于行级权限判断）
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest()
  return request.user
})
