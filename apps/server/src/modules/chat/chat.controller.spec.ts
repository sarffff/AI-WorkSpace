import type { ConfigService } from '@nestjs/config'
import { HttpException } from '@nestjs/common'
import type { ChatService } from './chat.service'
import { StreamSlotService } from './stream-slot.service'
import { StreamSessionService } from './stream-session.service'
import { ChatController } from './chat.controller'

// 行为依据（与实现一致）：
// - 超过每用户在途流上限时，必须在写 SSE 响应头之前返回 HTTP 429
//   （切到 SSE 之后只能把错误塞进流内 error 帧，前端会当成"回答出错"）
// - 被拒的请求不得触碰 chatService（不生成、不计费）
// - 泵结束、以及 startStream 抛错，都要释放在途槽位
// - 断连只退订不取消：pump 继续跑完，resume 带 afterSeq 回放
// - 取消的唯一入口：POST :id/stop 与停机排空（registerCancel）

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
  /** 抛错即「今日 token 预算已用尽」 */
  onBudget?: () => Promise<void>
  streamMax?: string
}) {
  const slots = new StreamSlotService({
    get: (key: string) =>
      key === 'MAX_CONCURRENT_STREAMS_PER_USER' ? (opts.streamMax ?? '1') : undefined,
  } as unknown as ConfigService)
  const sessions = new StreamSessionService()

  /** 运行层收到的 opts（requestId / signal），按调用顺序 */
  const streamOpts: Array<{ requestId?: string; signal?: AbortSignal }> = []
  const chatService = {
    assertOwned: async () => ({ id: 'c1' }),
    assertTokenBudget: async () => {
      await opts.onBudget?.()
    },
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
  const controller = new ChatController(chatService as unknown as ChatService, slots, sessions)
  return { controller, slots, sessions, streamOpts }
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

    // 同一用户的另一会话：用户槽已满 → 429（同会话重入是 409，另案覆盖）
    const second = fakeRes()
    await controller.streamCompletions('u1', 'c2', { prompt: 'q2' }, second.res as never)

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
    // 停机登记同样要注销，否则表随会话数无界增长
    expect(slots.inFlight()).toBe(0)

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

  it('今日 token 预算用尽：真实 429，不切 SSE、不占任何槽位', async () => {
    const { controller, slots } = makeController({
      streams: () => oneChunkStream(),
      onBudget: async () => {
        throw new HttpException(
          {
            statusCode: 429,
            message: '今天的模型用量已达预算上限 10000 tokens，00:00 后自动重置',
            reason: 'token_budget',
          },
          429,
        )
      },
    })

    const r = fakeRes()
    await expect(
      controller.streamCompletions('u1', 'c1', { prompt: 'q' }, r.res as never),
    ).rejects.toBeInstanceOf(HttpException)

    expect(r.state.headers['Content-Type']).toBeUndefined()
    expect(r.state.written).toEqual([])
    // 闸门在占槽之前：被拒的请求不该消耗并发额度，也不该留下会话占用
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.chatHolder('c1')).toBeUndefined()
  })
})

// 流与连接解耦后：断连只退订，pump 继续跑完并落库；resume 带 afterSeq 回放；
// 取消的唯一入口是 stop 端点与停机排空（registerCancel）。
describe('ChatController 断连与停止', () => {
  it('断连不中断生成：pump 跑完，resume 回放全部事件', async () => {
    const { controller, slots, sessions } = makeController({
      streams: () =>
        (async function* () {
          yield { type: 'content', text: '半' } as never
          await new Promise((r) => setTimeout(r, 20))
          yield { type: 'content', text: '答' } as never
        })(),
    })

    const r = fakeRes()
    const running = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, r.res as never)
    await new Promise((res) => setImmediate(res))
    r.fire('close')
    await running
    expect(r.state.ended).toBe(true)

    // pump 独立于连接：等它跑完（槽位随之归还）
    for (let i = 0; i < 100 && !sessions.get('c1')?.done; i++) {
      await new Promise((res) => setTimeout(res, 10))
    }
    expect(sessions.get('c1')?.done).toBe(true)
    expect(slots.activeCount('u1')).toBe(0)

    // resume：从 afterSeq=0 回放全量（含 done 帧），事件带 seq id 供客户端记账
    const r2 = fakeRes()
    await controller.streamCompletions('u1', 'c1', { resume: true, afterSeq: 0 }, r2.res as never)
    const all = r2.state.written.join('')
    expect(all).toContain('半')
    expect(all).toContain('答')
    expect(all).toContain('"done":true')
    expect(r2.state.written[0].startsWith('id: 1\n')).toBe(true)
  })

  it('resume 无可续订的流返回 404', async () => {
    const { controller } = makeController({ streams: () => oneChunkStream() })
    const r = fakeRes()
    await controller.streamCompletions(
      'u1',
      'c-none',
      { resume: true, afterSeq: 3 },
      r.res as never,
    )
    expect(r.state.statusCode).toBe(404)
    expect(r.state.headers['Content-Type']).toBeUndefined()
  })

  it('stop 端点取消 pump：signal abort，done 帧带 stopped 标记', async () => {
    const { controller, slots, streamOpts } = makeController({
      streams: (_id, signal) =>
        (async function* () {
          yield { type: 'content', text: '半' } as never
          // 在途的生成调用：只有取消信号能把它收回来
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

    await controller.stopStream('u1', 'c1')
    await running

    expect(streamOpts[0]?.signal?.aborted).toBe(true)
    expect(r.state.ended).toBe(true)
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.chatHolder('c1')).toBeUndefined()
    // stop 是正常收尾：done 帧带 stopped 标记，而不是 error 帧
    expect(r.state.written.some((w) => w.includes('"stopped":true'))).toBe(true)
    expect(r.state.written.some((w) => w.includes('"error"'))).toBe(false)
  })

  it('预检阶段断连：连接立即退出，生成后台继续跑完', async () => {
    const gate = deferred()
    let entered = false
    const { controller, slots, sessions } = makeController({
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
    await running
    // 连接侧：一帧未写、立即收尾
    expect(r.state.written).toEqual([])
    expect(r.state.ended).toBe(true)

    // 生成不被断连打断：gate 放开后 pump 跑完并归还槽位
    gate.resolve()
    for (let i = 0; i < 100 && !sessions.get('c1')?.done; i++) {
      await new Promise((res) => setTimeout(res, 10))
    }
    expect(entered).toBe(true)
    expect(sessions.get('c1')?.done).toBe(true)
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.chatHolder('c1')).toBeUndefined()
  })

  it('未断连时照常写 done', async () => {
    const { controller } = makeController({ streams: () => oneChunkStream() })
    const ok = fakeRes()
    await controller.streamCompletions('u1', 'c1', { prompt: 'q' }, ok.res as never)
    expect(ok.state.written.some((w) => w.includes('"done":true'))).toBe(true)
  })

  it('停机时在途流被取消：走与 stop 同一条收尾，登记与槽位都归还', async () => {
    const { controller, slots, streamOpts } = makeController({
      streams: (_id, signal) =>
        (async function* () {
          yield { type: 'content', text: '半' } as never
          // 在途的生成调用：只有取消信号能把它收回来
          await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('shutting down')), {
              once: true,
            })
          })
        })(),
    })

    const r = fakeRes()
    const running = controller.streamCompletions('u1', 'c1', { prompt: 'q' }, r.res as never)
    await new Promise((res) => setImmediate(res))
    expect(slots.inFlight()).toBe(1)

    await slots.beforeApplicationShutdown()
    await running

    expect(streamOpts[0]?.signal?.aborted).toBe(true)
    expect(slots.inFlight()).toBe(0)
    expect(slots.activeCount('u1')).toBe(0)
    expect(slots.chatHolder('c1')).toBeUndefined()
    expect(r.state.ended).toBe(true)
    // 停机不是「回答出错」：不该写 error 帧
    expect(r.state.written.some((w) => w.includes('"error"'))).toBe(false)
  })
})
