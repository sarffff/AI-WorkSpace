import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'

// ===== LLM 调用统一封装：超时 + 指数退避重试 + 备用模型降级 =====
//
// 背景：chat.service / knowledge.service 中所有 openai.chat.completions.create 原本
// 没有任何超时/重试保护，网络抖动、网关 429/5xx 会直接打断对话链路。
// 本封装对非流式与流式调用统一提供：
// - AbortController 超时（env LLM_TIMEOUT_MS，默认 60000ms）
// - 429 / 5xx / 超时 / 网络错误按 500ms * 2^n + 抖动 指数退避重试（env LLM_MAX_RETRIES，默认 2）
// - 备用模型降级：主模型重试耗尽后依次尝试 fallback 模型（env LLM_FALLBACK_MODELS，逗号分隔）
// - 实际使用的模型通过返回值 model 字段透出，调用方据此落库/记录
// - 调用方可传 input.signal 取消：当场掐掉 in-flight 请求，且不再重试、不再降级到备用模型
//   （断连后继续把整条模型链跑完 = 白付 token，还会把已经没人看的回答拖到超时）
//
// 流式语义：重试只发生在流建立之前（create 调用阶段）；流建立后仅做整体消费超时
// abort，不做中途重试（重放会重复 token 与工具副作用，收益低风险高）。

export interface LlmCompletionResult {
  completion: OpenAI.Chat.Completions.ChatCompletion
  /** 实际完成本次调用的模型（可能为降级后的备用模型） */
  model: string
}

export interface LlmStreamResult {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  /** 实际建立本次流的模型（可能为降级后的备用模型） */
  model: string
}

type CompleteParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  'model' | 'messages' | 'stream'
>

type StreamParams = Omit<
  OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
  'model' | 'messages' | 'stream'
>

export interface CompleteInput extends CompleteParams {
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  /** 调用方取消（客户端断连）：立即停止重试与降级，不再发起新请求 */
  signal?: AbortSignal
}

export interface StreamInput extends StreamParams {
  messages: OpenAI.Chat.ChatCompletionMessageParam[]
  signal?: AbortSignal
}

// 是否可重试：429 / 5xx / 超时 abort / 网络错误。
// SDK 对 signal abort 抛 APIUserAbortError（status 为 undefined），连接错误同理，
// 因此 status === undefined 的 APIError 也归入可重试；4xx（除 429）不重试。
function isRetryableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    const status = err.status
    return (
      status === 429 ||
      (status !== undefined && status >= 500 && status < 600) ||
      status === undefined
    )
  }
  // 兼容层可能直接抛原始 AbortError / TimeoutError
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'TimeoutError' || err.name === 'APIUserAbortError')
  )
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : JSON.stringify(err)
}

// 是否「参数不被兼容层支持」类错误（4xx 除 429）：
// 供调用方判断能否换一套参数重试（如去掉 stream_options），避免把超时/5xx 误判成参数问题
export function isInvalidRequestError(err: unknown): boolean {
  return (
    err instanceof OpenAI.APIError &&
    err.status !== undefined &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 429
  )
}

/**
 * 调用方取消（客户端断连）导致的中止。与超时/网络失败分开，因为它是正常收尾而不是故障：
 * 上层据此停止后续轮次，并且不再按「可重试/可降级」处理。
 */
export class LlmAbortedError extends Error {
  constructor() {
    super('llm call cancelled by caller')
    this.name = 'LlmAbortedError'
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// 包装流：整体消费超时时由定时器 abort；finally 清理定时器与外部取消监听
// （覆盖正常结束、超时、以及调用方提前 break/throw 三种退出）
async function* withStreamTimeout<T>(
  upstream: AsyncIterable<T>,
  timer: NodeJS.Timeout,
  detach?: () => void,
): AsyncGenerator<T, void, undefined> {
  try {
    for await (const item of upstream) {
      yield item
    }
  } finally {
    clearTimeout(timer)
    detach?.()
  }
}

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name)

  constructor(private readonly configService: ConfigService) {}

  // 单次调用超时（ms）
  private timeoutMs(): number {
    const v = parseInt(this.configService.get<string>('LLM_TIMEOUT_MS') ?? '', 10)
    return Number.isFinite(v) && v > 0 ? v : 60000
  }

  // 同一模型的最大重试次数（总尝试次数 = 1 + retries）
  private maxRetries(): number {
    const v = parseInt(this.configService.get<string>('LLM_MAX_RETRIES') ?? '', 10)
    return Number.isFinite(v) && v >= 0 ? v : 2
  }

  // 模型降级链：主模型 + env LLM_FALLBACK_MODELS（逗号分隔，去空去重、剔除主模型）
  modelChain(primary: string): string[] {
    const raw = this.configService.get<string>('LLM_FALLBACK_MODELS') || ''
    const chain: string[] = [primary]
    for (const item of raw.split(',')) {
      const m = item.trim()
      if (m && !chain.includes(m)) chain.push(m)
    }
    return chain
  }

  // 非流式调用：主模型重试耗尽 → 依次降级备用模型 → 全部失败抛最后一个错误。
  // input.signal 触发时立刻收手：既不重试也不再降级到下一个模型
  async complete(
    client: OpenAI,
    models: string[],
    input: CompleteInput,
  ): Promise<LlmCompletionResult> {
    const { signal, ...params } = input
    if (signal?.aborted) throw new LlmAbortedError()
    const maxRetries = this.maxRetries()
    const timeout = this.timeoutMs()
    let lastError: unknown = null
    let cancelled = false
    for (let mi = 0; mi < models.length; mi++) {
      if (signal?.aborted) {
        cancelled = true
        break
      }
      const model = models[mi]
      let result: LlmCompletionResult | null = null
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
          cancelled = true
          break
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        // 外部取消与本次超时共用同一个 controller：断连时 in-flight 请求当场掐掉，
        // 而不是等它跑完（生成器 return 只能让上层不再等，收不回已经发出去的 HTTP 请求）
        const onCancel = () => controller.abort()
        signal?.addEventListener('abort', onCancel, { once: true })
        try {
          const completion = await client.chat.completions.create(
            { ...params, model, stream: false },
            { signal: controller.signal },
          )
          result = { completion, model }
          break
        } catch (err) {
          lastError = err
          if (signal?.aborted) {
            cancelled = true
            break
          }
          const willRetry = isRetryableError(err) && attempt < maxRetries
          if (willRetry) {
            const delay = 500 * 2 ** attempt + Math.random() * 200
            this.logger.warn(
              `llm retryable error (model=${model}, attempt=${attempt + 1}/${maxRetries + 1}, retry in ${Math.round(delay)}ms): ${errMsg(err)}`,
            )
            await sleep(delay)
          } else {
            this.logger.warn(
              `llm call failed (model=${model}, attempt=${attempt + 1}, giving up this model): ${errMsg(err)}`,
            )
            break
          }
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onCancel)
        }
      }
      if (result) {
        if (mi > 0) {
          this.logger.warn(`llm fallback model used: primary=${models[0]} → ${result.model}`)
        }
        return result
      }
      if (cancelled) break
      if (mi < models.length - 1) {
        this.logger.warn(`llm switching to fallback model: ${model} → ${models[mi + 1]}`)
      }
    }
    if (cancelled) {
      // 断连不是故障：不占用 error 级日志，也不做无谓的重试/降级
      this.logger.log(`llm call cancelled by caller (chain=${models.join(' > ')})`)
      throw new LlmAbortedError()
    }
    this.logger.error(`llm all models failed (chain=${models.join(' > ')}): ${errMsg(lastError)}`)
    throw lastError
  }

  // 流式调用：重试只发生在流建立前；流建立后整体消费超时则 abort，不做中途重试。
  // input.signal 在建立与消费两个阶段都生效：建立期取消即放弃本次尝试，
  // 消费期取消掐掉上游连接（监听器移交给包装流，由其 finally 摘除）
  async stream(client: OpenAI, models: string[], input: StreamInput): Promise<LlmStreamResult> {
    const { signal, ...params } = input
    if (signal?.aborted) throw new LlmAbortedError()
    const maxRetries = this.maxRetries()
    const timeout = this.timeoutMs()
    let lastError: unknown = null
    let cancelled = false
    for (let mi = 0; mi < models.length; mi++) {
      if (signal?.aborted) {
        cancelled = true
        break
      }
      const model = models[mi]
      let result: LlmStreamResult | null = null
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) {
          cancelled = true
          break
        }
        const controller = new AbortController()
        // 流建立阶段超时：create() 迟迟不返回则 abort，可重试/降级
        const timer = setTimeout(() => controller.abort(), timeout)
        const onCancel = () => controller.abort()
        signal?.addEventListener('abort', onCancel, { once: true })
        let established = false
        try {
          const upstream = await client.chat.completions.create(
            { ...params, model, stream: true },
            { signal: controller.signal },
          )
          established = true
          // 流已建立：换为整体消费超时定时器（超时 abort，绝不中途重试）
          const consumeTimer = setTimeout(() => controller.abort(), timeout)
          result = {
            model,
            stream: withStreamTimeout(upstream, consumeTimer, () =>
              signal?.removeEventListener('abort', onCancel),
            ),
          }
          break
        } catch (err) {
          lastError = err
          if (signal?.aborted) {
            cancelled = true
            break
          }
          const willRetry = isRetryableError(err) && attempt < maxRetries
          if (willRetry) {
            const delay = 500 * 2 ** attempt + Math.random() * 200
            this.logger.warn(
              `llm stream retryable error (model=${model}, attempt=${attempt + 1}/${maxRetries + 1}, retry in ${Math.round(delay)}ms): ${errMsg(err)}`,
            )
            await sleep(delay)
          } else {
            this.logger.warn(
              `llm stream call failed (model=${model}, attempt=${attempt + 1}, giving up this model): ${errMsg(err)}`,
            )
            break
          }
        } finally {
          clearTimeout(timer)
          // 未建立成功时摘除；建立成功的交给包装流，消费结束再摘（否则边下边被取消会失效）
          if (!established) signal?.removeEventListener('abort', onCancel)
        }
      }
      if (result) {
        if (mi > 0) {
          this.logger.warn(
            `llm fallback model used for stream: primary=${models[0]} → ${result.model}`,
          )
        }
        return result
      }
      if (cancelled) break
      if (mi < models.length - 1) {
        this.logger.warn(`llm stream switching to fallback model: ${model} → ${models[mi + 1]}`)
      }
    }
    if (cancelled) {
      this.logger.log(`llm stream cancelled by caller (chain=${models.join(' > ')})`)
      throw new LlmAbortedError()
    }
    this.logger.error(
      `llm stream all models failed (chain=${models.join(' > ')}): ${errMsg(lastError)}`,
    )
    throw lastError
  }
}
