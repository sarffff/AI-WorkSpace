import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

/**
 * 结构化请求日志 + 链路 ID：
 * - 每个请求分配 reqId（尊重上游 X-Request-Id），响应头回传
 * - 单行 JSON 输出：reqId / method / path / status / 耗时 / 用户 / UA
 * - 错误响应同样记录（4xx/5xx status）
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP')

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest()
    const res = context.switchToHttp().getResponse()
    const reqId = (req.headers['x-request-id'] as string) || randomUUID().slice(0, 8)
    res.setHeader('X-Request-Id', reqId)
    const startedAt = Date.now()

    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, reqId, startedAt),
        error: (err) => this.log(req, res, reqId, startedAt, err?.status ?? 500),
      }),
    )
  }

  private log(
    req: {
      method: string
      originalUrl: string
      headers: Record<string, string>
      user?: { id?: string }
    },
    res: { statusCode: number },
    reqId: string,
    startedAt: number,
    errorStatus?: number,
  ) {
    this.logger.log(
      JSON.stringify({
        reqId,
        method: req.method,
        path: req.originalUrl,
        status: errorStatus ?? res.statusCode,
        ms: Date.now() - startedAt,
        userId: req.user?.id,
        ua: (req.headers['user-agent'] || '').slice(0, 80),
      }),
    )
  }
}
