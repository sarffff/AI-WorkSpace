import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Response } from 'express'

// multer 体积超限抛的是 MulterError（code=LIMIT_FILE_SIZE），不是 HttpException，
// 默认会变成 500「Internal server error」，用户看不出是文件太大。
// 这里按 code 归一成 413，其余异常保持原状透传。
//
// 鸭子类型判定而非 import multer：multer 是 @nestjs/platform-express 的传递依赖，
// 直接 import 会让本文件依赖未在 package.json 声明的包。
function isFileTooLarge(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'LIMIT_FILE_SIZE'
  )
}

@Catch()
export class UploadErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(UploadErrorFilter.name)

  constructor(private readonly maxBytes: number) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>()

    if (isFileTooLarge(exception)) {
      const mb = (this.maxBytes / 1024 / 1024).toFixed(0)
      this.logger.warn(`upload rejected: file exceeds ${mb}MB limit`)
      res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `文件过大，单个文件不得超过 ${mb}MB`,
      })
      return
    }

    // 非体积问题：保持既有语义（HttpException 用自身状态，其余按 500）
    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json(exception.getResponse())
      return
    }
    this.logger.error(
      `upload failed: ${exception instanceof Error ? exception.message : String(exception)}`,
    )
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    })
  }
}
