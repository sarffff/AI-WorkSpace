import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import OpenAI from 'openai'
import { LlmAbortedError, LlmClient } from './llm-client'

// ===== 取消传导到真实 fetch 的那一半 =====
//
// llm-client.spec.ts 用假 OpenAI client，证不了「abort 之后请求真的断了」。
// 这里起一个本地 HTTP 替身冒充 OpenAI 兼容端点（不联网、不用任何 Key），
// 从服务端视角看两件事：
// 1. 调用方取消后，in-flight 请求当场断开 —— 剩下的块不再发（否则 token 照付）
// 2. 取消后不再重试、不再降级到备用模型 —— 服务端只该收到一次请求

interface StubState {
  /** 每次收到的请求。finished=false 即「客户端提前走了」，chunksWritten 是当时已写出的块数 */
  requests: Array<{ model: string; stream: boolean; finished: boolean; chunksWritten: number }>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const completionBody = (model: string) => ({
  id: 'cmpl-1',
  object: 'chat.completion',
  created: 1,
  model,
  choices: [{ index: 0, message: { role: 'assistant', content: '好的' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
})

const chunkBody = (model: string, text: string) => ({
  id: 'chunk-1',
  object: 'chat.completion.chunk',
  created: 1,
  model,
  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
})

/**
 * @param holdMs 非流式响应前的挂起时长（用来制造「取消发生在请求途中」的窗口）
 * @param streamChunks 流式响应的块数与块间隔
 */
async function startStub(opts: { holdMs: number; streamChunks: number; chunkGapMs: number }) {
  const state: StubState = { requests: [] }
  const server = createServer(async (req, res) => {
    const raw: Buffer[] = []
    for await (const part of req) raw.push(part as Buffer)
    const body = JSON.parse(Buffer.concat(raw).toString('utf8') || '{}') as {
      model?: string
      stream?: boolean
    }
    const entry = {
      model: String(body.model),
      stream: !!body.stream,
      finished: false,
      chunksWritten: 0,
    }
    state.requests.push(entry)

    if (!body.stream) {
      await sleep(opts.holdMs)
      if (res.writableEnded || res.destroyed) return
      entry.finished = true
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(completionBody(entry.model)))
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    for (let i = 0; i < opts.streamChunks; i++) {
      if (res.destroyed) return
      res.write(`data: ${JSON.stringify(chunkBody(entry.model, `片段${i}`))}\n\n`)
      entry.chunksWritten++
      await sleep(opts.chunkGapMs)
    }
    if (!res.destroyed) {
      res.write('data: [DONE]\n\n')
      entry.finished = true
      res.end()
    }
  })

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  // maxRetries: 0 —— SDK 自带重试会把「服务端收到几次请求」这个计数搅浑
  const openai = new OpenAI({
    apiKey: 'test-key',
    baseURL: `http://127.0.0.1:${port}/v1`,
    maxRetries: 0,
  })
  // close() 只停监听；keep-alive 的连接会一直挂着让 jest 不退出
  const close = () =>
    new Promise<void>((r) => {
      server.closeAllConnections?.()
      server.close(() => r())
    })
  return { state, openai, close }
}

function makeLlm(config: Record<string, string>) {
  return new LlmClient({ get: (key: string) => config[key] } as unknown as ConfigService)
}

describe('LlmClient 取消传导到真实 HTTP 请求', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('对照：不取消时流正常收完', async () => {
    const { state, openai, close } = await startStub({
      holdMs: 0,
      streamChunks: 6,
      chunkGapMs: 5,
    })
    try {
      const result = await makeLlm({}).stream(openai, ['m-a'], { messages: [] })
      let chunks = 0
      for await (const c of result.stream) {
        chunks++
        expect(c.choices[0]?.delta?.content).toContain('片段')
      }
      expect(chunks).toBe(6)
      expect(state.requests).toHaveLength(1)
      expect(state.requests[0].finished).toBe(true)
    } finally {
      await close()
    }
  })

  it('消费中途取消：服务端当场断开，剩下的块不再发', async () => {
    // 20 块 × 60ms ≈ 1.2s；读到第 3 块就取消，服务端不该继续把剩下 17 块发完
    const { state, openai, close } = await startStub({
      holdMs: 0,
      streamChunks: 20,
      chunkGapMs: 60,
    })
    const ac = new AbortController()
    try {
      const result = await makeLlm({ LLM_TIMEOUT_MS: '30000' }).stream(openai, ['m-a'], {
        messages: [],
        signal: ac.signal,
      })
      let chunks = 0
      const startedAt = Date.now()
      try {
        for await (const c of result.stream) {
          expect(c.object).toBe('chat.completion.chunk')
          chunks++
          if (chunks === 3) ac.abort()
        }
      } catch {
        // 取消也可能表现为抛错（SDK 版本相关），两种都算当场收场
      }
      // 关键：取消后立刻收场，而不是等满 30s 超时、也不是把 20 块下完。
      // 注意 SDK 在 abort 时把流关成「正常结束」而非抛错 —— 上层不能只靠异常判断被取消
      expect(Date.now() - startedAt).toBeLessThan(1500)
      expect(chunks).toBeLessThan(10)

      await sleep(120)
      expect(state.requests[0].finished).toBe(false)
      expect(state.requests[0].chunksWritten).toBeLessThan(20)
    } finally {
      await close()
    }
  })

  it('请求途中取消：不重试也不降级，服务端只收到一次请求', async () => {
    const { state, openai, close } = await startStub({
      holdMs: 2000,
      streamChunks: 0,
      chunkGapMs: 0,
    })
    const ac = new AbortController()
    try {
      const pending = makeLlm({ LLM_TIMEOUT_MS: '30000', LLM_MAX_RETRIES: '2' }).complete(
        openai,
        ['m-a', 'm-b', 'm-c'],
        { messages: [], signal: ac.signal },
      )
      await sleep(120)
      const startedAt = Date.now()
      ac.abort()

      await expect(pending).rejects.toBeInstanceOf(LlmAbortedError)
      expect(Date.now() - startedAt).toBeLessThan(1500)

      // 留给「如果有重试/降级会多发的那 2s」一点余量，再确认服务端只见过一次
      await sleep(400)
      expect(state.requests.map((r) => r.model)).toEqual(['m-a'])
    } finally {
      await close()
    }
  })
})
