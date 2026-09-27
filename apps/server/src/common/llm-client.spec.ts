import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import { LlmAbortedError, LlmClient } from './llm-client'

// ===== 调用方取消（客户端断连）语义 =====
//
// 生成器 return() 只能让上层「不再等」，收不回已经发出去的 HTTP 请求。
// 不接外部 signal 时，用户点了停止，这一次提问仍会把
// 「重试 × N + 备用模型 × M」整条链跑完 —— token 照付，请求数照占。
// 这里用假 OpenAI client 钉住几件事：已取消就不发、取消后不再重试/降级、
// 取消当场掐掉 in-flight 请求、signal 不能被当成请求体字段发出去、
// 消费结束要摘掉挂在 signal 上的监听。

const retryableError = () => Object.assign(new Error('gateway timeout'), { name: 'TimeoutError' })

/** 等 signal 触发（已触发则立刻返回），模拟真实 fetch 对 abort 的反应 */
const waitAbort = (signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (!signal || signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })

interface CreateCall {
  model: string
  body: Record<string, unknown>
  signal: AbortSignal | undefined
}

function makeClient(config: Record<string, string> = {}) {
  const calls: CreateCall[] = []
  const client = new LlmClient({ get: (key: string) => config[key] } as unknown as ConfigService)
  return { client, calls }
}

function fakeOpenAI(behavior: (call: CreateCall) => Promise<unknown>): OpenAI {
  return {
    chat: {
      completions: {
        create: async (params: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          const call: CreateCall = {
            model: String(params.model),
            body: params,
            signal: options?.signal,
          }
          return behavior(call)
        },
      },
    },
  } as unknown as OpenAI
}

const chunk = (text: string) => ({ choices: [{ delta: { content: text } }] })

/**
 * 统计 signal 上 abort 监听的挂/摘次数。
 * jsdom 版 AbortSignal 没有 listenerCount，只能自己包一层 —— 调用方可能传一个
 * 长期复用的 signal（比如整个会话一个），漏摘就是无界增长。
 */
function countAbortHandlers(signal: AbortSignal) {
  const state = { added: 0, removed: 0 }
  const wrap = (key: 'addEventListener' | 'removeEventListener', hit: () => void) => {
    const target = signal as unknown as Record<string, unknown>
    const orig = target[key] as (...args: unknown[]) => void
    target[key] = (...args: unknown[]) => {
      if (args[0] === 'abort') hit()
      return orig.apply(signal, args)
    }
  }
  wrap('addEventListener', () => state.added++)
  wrap('removeEventListener', () => state.removed++)
  return state
}

describe('LlmClient 取消语义', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('signal 已取消时一次请求都不发', async () => {
    const { client, calls } = makeClient()
    const ac = new AbortController()
    ac.abort()

    const run = () =>
      client.complete(
        fakeOpenAI(async (c) => {
          calls.push(c)
          return { completion: { choices: [] } }
        }),
        ['m1'],
        { messages: [], signal: ac.signal },
      )

    await expect(run()).rejects.toBeInstanceOf(LlmAbortedError)
    expect(calls).toHaveLength(0)
  })

  it('请求失败后被取消：不重试，也不降级到备用模型', async () => {
    const { client, calls } = makeClient({ LLM_MAX_RETRIES: '0' })
    const ac = new AbortController()

    await expect(
      client.complete(
        fakeOpenAI(async (c) => {
          calls.push(c)
          ac.abort() // 模拟「这次调用还没回来用户就走了」
          throw retryableError()
        }),
        ['m1', 'm2', 'm3'],
        { messages: [], signal: ac.signal },
      ),
    ).rejects.toBeInstanceOf(LlmAbortedError)
    expect(calls.map((c) => c.model)).toEqual(['m1'])
  })

  it('取消当场掐掉 in-flight 请求，而不是等它超时', async () => {
    // 超时设 30s：若取消没有传导到 fetch，这个用例只会以超时失败
    const { client, calls } = makeClient({ LLM_TIMEOUT_MS: '30000' })
    const ac = new AbortController()

    const started = Date.now()
    const pending = client.complete(
      fakeOpenAI(async (c) => {
        calls.push(c)
        const inflight = waitAbort(c.signal).then(() => {
          throw retryableError()
        })
        setTimeout(() => ac.abort(), 20)
        return inflight
      }),
      ['m1'],
      { messages: [], signal: ac.signal },
    )

    await expect(pending).rejects.toBeInstanceOf(LlmAbortedError)
    expect(calls).toHaveLength(1)
    expect(calls[0].signal?.aborted).toBe(true)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('signal 不进请求体（否则会被当作参数序列化给兼容层）', async () => {
    const { client, calls } = makeClient()
    const ac = new AbortController()

    await expect(
      client.complete(
        fakeOpenAI(async (c) => {
          calls.push(c)
          return { completion: { choices: [] } }
        }),
        ['m1'],
        { messages: [{ role: 'user', content: 'x' }], signal: ac.signal },
      ),
    ).resolves.toMatchObject({ model: 'm1' })

    expect(calls[0].body).not.toHaveProperty('signal')
    expect(calls[0].body).toMatchObject({ model: 'm1', stream: false })
  })

  it('流式：消费中途取消会掐掉上游', async () => {
    const { client, calls } = makeClient({ LLM_TIMEOUT_MS: '30000' })
    const ac = new AbortController()

    const result = await client.stream(
      fakeOpenAI(async (c) => {
        calls.push(c)
        return (async function* () {
          yield chunk('a')
          yield chunk('b')
          await waitAbort(c.signal)
          throw retryableError()
        })()
      }),
      ['m1'],
      { messages: [], signal: ac.signal },
    )

    const it = result.stream[Symbol.asyncIterator]()
    // 上游在两个 chunk 之后才去等 abort，所以取消要发生在那之前
    expect(await it.next()).toMatchObject({ value: chunk('a'), done: false })
    expect(await it.next()).toMatchObject({ value: chunk('b'), done: false })
    ac.abort()
    await expect(it.next()).rejects.toBeTruthy()
    expect(calls[0].signal?.aborted).toBe(true)
  })

  it('流式正常读完：摘掉挂在调用方 signal 上的监听', async () => {
    const { client } = makeClient()
    const ac = new AbortController()
    const handlers = countAbortHandlers(ac.signal)

    const result = await client.stream(
      fakeOpenAI(async () =>
        (async function* () {
          yield chunk('a')
        })(),
      ),
      ['m1'],
      { messages: [], signal: ac.signal },
    )
    expect(handlers).toEqual({ added: 1, removed: 0 })

    for await (const c of result.stream) expect(c).toEqual(chunk('a'))
    expect(handlers).toEqual({ added: 1, removed: 1 })
  })
})
