import type { ConfigService } from '@nestjs/config'
import type { ChatService } from './chat.service'
import { StreamSlotService } from './stream-slot.service'
import { ChatController } from './chat.controller'

// 行为依据（与实现一致）：
// - 超过每用户在途流上限时，必须在写 SSE 响应头之前返回 HTTP 429
//   （切到 SSE 之后只能把错误塞进流内 error 帧，前端会当成"回答出错"）
// - 被拒的请求不得触碰 chatService（不生成、不计费）
// - 流结束、以及 startStream 抛错，都要释放在途槽位
// - 归属校验（assertOwned）在占用槽位之后进行，失败也要归还

interface ResState {
  headers: Record<string, string>
  written: string[]
  statusCode: number
  jsonBody: unknown
  ended: boolean
}

function fakeRes() {
  const state: ResState = {
    headers: {},
    written: [],
    statusCode: 200,
    jsonBody: null,
    ended: false,
  }
  const handlers: Record<string, Array<() => void>> = {}
  const res: Record<string, unknown> = {
    setHeader: (k: string, v: string) => {
      state.headers[k] = v
    },
    // 控制器会把 LoggingInterceptor 写在响应头上的 X-Request-Id 传给运行层做归因
    getHeader: (k: string) => (k === 'X-Request-Id' ? 'req-test' : undefined),
    on: (ev: string, fn: () => void) => {
      ;(handlers[ev] ??= []).push(fn)
    },
    write: (s: string) => {
      state.written.push(s)
      return true
    },
    end: () => {
      state.ended = true
    },
    status: (code: number) => {
      state.statusCode = code
      return res
    },
    json: (body: unknown) => {
      state.jsonBody = body
      return res
    },
  }
  // 触发 res 事件：'close' 即「客户端走了」
  const fire = (ev: string) => handlers[ev]?.forEach((fn) => fn())
  return { res, state, fire }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeController(opts: {
  streams: (chatId: string, signal?: AbortSignal) => AsyncGenerator<unknown>
  onStartStream?: () => Promise<void>
  streamMax?: string
}) {
  const slots = new StreamSlotService({
    get: (key: string) =>
      key === 'MAX_CONCURRENT_STREAMS_PER_USER' ? (opts.streamMax ?? '1') : undefined,
  } as unknown as ConfigService)

  /** 运行层收到的 opts（requestId / signal），按调用顺序 */
  const streamOpts: Array<{ requestId?: string; signal?: AbortSignal }> = []
  const chatService = {
    assertOwned: async () => ({ id: 'c1' }),
    startStream: async (
      chatId: string,
      _prompt: string,
      _model: string | undefined,
      _useRag: boolean | undefined,
      _systemPrompt: string | undefined,
      o?: { requestId?: string; signal?: AbortSignal },
    ) => {
      streamOpts.push(o ?? {})
      await opts.onStartStream?.()
      return { stream: opts.streams(chatId, o?.signal) }
    },
  }
  const controller = new ChatController(chatService as unknown as ChatService, slots)
  return { controller, slots, streamOpts }
}

const oneChunkStream = (): AsyncGenerator<never> =>
  (async function* () {
    yield { type: 'content', text: '答' } as never
  })()

describe('ChatController 流式端点的并发上限', () => {
  it('第二条在途流被 429 拦下，且不写 SSE 头、不触发生成', async () => {
    const gate = deferred()
    const { controller, slots } = makeController({
      streams: () =>
        (async function* () {
          await gate.promise
          yield { type: 'content', text: '答' } as never
        })(),
    })

    const first = fakeRes()
    const running = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, first.res as never)
    // 让第一条流真正进到 await 里挂住
    await new Promise((r) => setImmediate(r))
    expect(slots.activeCount('u1')).toBe(1)

    const second = fakeRes()
    await controller.streamCompletions('u1', 'c1', { prompt: 'q2' }, second.res as never)

    expect(second.state.statusCode).toBe(429)
    expect(second.state.headers['Content-Type']).toBeUndefined()
    expect(second.state.written).toEqual([])
    expect(second.state.jsonBody).toMatchObject({ maxConcurrentStreams: 1 })

    gate.resolve()
    await running
    expect(slots.activeCount('u1')).toBe(0)
    expect(first.state.ended).toBe(true)
  })

  it('流结束后槽位归还，后续请求可再进入', async () => {
    const { controller, slots } = makeController({ streams: () => oneChunkStream() })

    const a = fakeRes()
    await controller.streamCompletions('u1', 'c1', { prompt: 'q' }, a.res as never)
    expect(slots.activeCount('u1')).toBe(0)

    const b = fakeRes()
    await controller.streamCompletions('u1', 'c1', { prompt: 'q' }, b.res as never)
    expect(b.state.statusCode).toBe(200)
    expect(b.state.written.some((w) => w.includes('"done":true'))).toBe(true)
  })

  it('startStream 抛错也要归还槽位', async () => {
    const { controller, slots } = makeController({
      streams: () => oneChunkStream(),
      onStartStream: async () => {
        throw new Error('上游不可用')
      },
    })

    const r = fakeRes()
    await controller.streamCompletions('u1', 'c1', { prompt: 'q' }, r.res as never)

    expect(slots.activeCount('u1')).toBe(0)
    expect(r.state.written.some((w) => w.includes('上游不可用'))).toBe(true)
    expect(r.state.ended).toBe(true)
  })

  it('不同用户各自独立计数', async () => {
    const gate = deferred()
    const blocking = () =>
      (async function* () {
        await gate.promise
        yield { type: 'content', text: '答' } as never
      })()
    const { controller, slots } = makeController({ streams: blocking })

    const a = fakeRes()
    const runningU1 = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, a.res as never)
    const b = fakeRes()
    const runningU2 = controller.streamCompletions('u2', 'c2', { prompt: 'q' }, b.res as never)
    await new Promise((r) => setImmediate(r))

    expect(slots.activeCount('u1')).toBe(1)
    expect(slots.activeCount('u2')).toBe(1)
    // u1 占满自己的上限也不能把 u2 挡在门外
    expect(b.state.statusCode).toBe(200)
    expect(b.state.headers['Content-Type']).toBe('text/event-stream')

    gate.resolve()
    await Promise.all([runningU1, runningU2])
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.activeCount('u2')).toBe(0)
  })

  it('同一会话被占用时返回 409，且不消耗后来者的用户槽位', async () => {
    const gate = deferred()
    // 第三次调用要能正常跑完，所以只在前两次挂住
    let block = true
    const { controller, slots } = makeController({
      streamMax: '2',
      streams: () =>
        block
          ? (async function* () {
              await gate.promise
              yield { type: 'content', text: '答' } as never
            })()
          : oneChunkStream(),
    })

    const a = fakeRes()
    const running = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, a.res as never)
    await new Promise((r) => setImmediate(r))

    const b = fakeRes()
    await controller.streamCompletions('u2', 'c1', { prompt: 'q' }, b.res as never)

    expect(b.state.statusCode).toBe(409)
    expect(b.state.headers['Content-Type']).toBeUndefined()
    expect(b.state.written).toEqual([])
    // 关键：被会话占用拒掉的请求不能顺手吃掉一个用户槽
    expect(slots.activeCount('u2')).toBe(0)

    gate.resolve()
    await running
    // 会话占用随流结束归还
    expect(slots.chatHolder('c1')).toBeUndefined()

    block = false
    const c = fakeRes()
    await controller.streamCompletions('u2', 'c1', { prompt: 'q' }, c.res as never)
    expect(c.state.statusCode).toBe(200)
    expect(slots.activeCount('u2')).toBe(0)
  })
})

// 断连要真的把「别再花钱」传到运行层：return() 只让上层不再等，收不回已经发出去的
// 请求；signal 才是掐请求的那一手。同时断连后不能再往已关闭的响应里写帧。
describe('ChatController 断连取消', () => {
  it('res close 时 abort 信号发出，生成器被回收，槽位归还', async () => {
    const { controller, slots, streamOpts } = makeController({
      streams: (_id, signal) =>
        (async function* () {
          yield { type: 'content', text: '半' } as never
          // 模拟一次在途 LLM 调用：只有 signal 触发才会结束（真实实现里会抛错）
          await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('llm cancelled')), {
              once: true,
            })
          })
        })(),
    })

    const r = fakeRes()
    const running = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, r.res as never)
    await new Promise((res) => setImmediate(res))
    expect(r.state.written.some((w) => w.includes('半'))).toBe(true)

    r.fire('close')
    await running

    expect(streamOpts[0]?.signal?.aborted).toBe(true)
    expect(r.state.ended).toBe(true)
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.chatHolder('c1')).toBeUndefined()
    // 取消在生成器内部就是抛错：断连后 done 与 error 都不该再往已关闭的响应里写
    expect(r.state.written.some((w) => w.includes('"done":true'))).toBe(false)
    expect(r.state.written.some((w) => w.includes('"error"'))).toBe(false)
  })

  it('预检阶段就断连：生成器一次都不被驱动，也不写错误帧', async () => {
    const gate = deferred()
    let entered = false
    const { controller, slots } = makeController({
      // 预检（人设/历史/RAG）期间挂着：close 到来时流还没构造出来
      onStartStream: async () => {
        await gate.promise
      },
      streams: () =>
        (async function* () {
          entered = true
          yield { type: 'content', text: 'X' } as never
        })(),
    })

    const r = fakeRes()
    const running = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, r.res as never)
    await new Promise((res) => setImmediate(res))
    r.fire('close')
    gate.resolve()
    await running

    expect(entered).toBe(false)
    expect(r.state.written).toEqual([])
    expect(r.state.ended).toBe(true)
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.chatHolder('c1')).toBeUndefined()
  })

  it('未断连时照常写 done', async () => {
    const { controller } = makeController({ streams: () => oneChunkStream() })
    const ok = fakeRes()
    await controller.streamCompletions('u1', 'c1', { prompt: 'q' }, ok.res as never)
    expect(ok.state.written.some((w) => w.includes('"done":true'))).toBe(true)
  })
})
