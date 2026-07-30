import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null
  private readonly logger = new Logger(RedisService.name)
  private readonly enabled: boolean

  constructor(private configService: ConfigService) {
    this.enabled = !!this.configService.get<string>('REDIS_URL')
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('REDIS_URL not configured. Redis is disabled.')
      return
    }

    const redisUrl = this.configService.get<string>('REDIS_URL')!
    this.client = new Redis(redisUrl)
    this.client.on('error', (err) => {
      this.logger.error('Redis connection error:', err.message)
    })
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.quit()
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return

    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds)
    } else {
      await this.client.set(key, value)
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null
    return await this.client.get(key)
  }

  async del(key: string): Promise<number> {
    if (!this.client) return 0
    return await this.client.del(key)
  }
}
