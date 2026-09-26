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
  const res: Record<string, unknown> = {
    setHeader: (k: string, v: string) => {
      state.headers[k] = v
    },
    on: () => undefined,
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
  return { res, state }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeController(opts: {
  streams: (chatId: string) => AsyncGenerator<unknown>
  onStartStream?: () => Promise<void>
}) {
  const slots = new StreamSlotService({
    get: (key: string) => (key === 'MAX_CONCURRENT_STREAMS_PER_USER' ? '1' : undefined),
  } as unknown as ConfigService)

  const chatService = {
    assertOwned: async () => ({ id: 'c1' }),
    startStream: async (chatId: string) => {
      await opts.onStartStream?.()
      return { stream: opts.streams(chatId) }
    },
  }
  const controller = new ChatController(chatService as unknown as ChatService, slots)
  return { controller, slots }
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
})
