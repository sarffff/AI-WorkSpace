import { HttpException, Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { LlmAbortedError, type LlmClient } from '@/common/llm-client'
import type { MemoryService } from '@/modules/memory/memory.service'
import type { KnowledgeService } from '@/modules/knowledge/knowledge.service'
import type { SettingsService } from '@/modules/settings/settings.service'
import type { PrismaService } from '@/prisma/prisma.service'
import type { AgentToolRegistry, CreateTicketTool } from './agent-tools'
import type { AgentPersonaService } from './agent-persona.service'
import type { RagHit } from '@/modules/knowledge/knowledge.service'
import { ChatService, type AgentStreamEvent } from './chat.service'

// 这条 spec 守的是 run / guarded 的接线本身。
// 曾经的缺陷：guarded 里写 `for await (const evt of run)` —— run 是绑定了 this 的
// 异步生成器**函数**，未被调用，类型检查照样通过，运行时首帧即抛
// "run is not async iterable"，于是整条 Agent 循环、HITL 确认门、轨迹落库全部不可达，
// 而 AgentRun 表里一条记录都不会有。只有真正消费一次返回的流才能发现。

const hit = (over: Partial<RagHit> = {}): RagHit => ({
  content: 'VPN 连接失败请先确认账号未锁定',
  score: 0.8,
  documentId: 'doc-1',
  documentName: 'vpn.md',
  sectionPath: 'VPN 排查',
  ...over,
})

const completion = (message: Record<string, unknown>, usage?: Record<string, number>) => ({
  completion: { choices: [{ message }], usage },
  model: 'test-model',
})

function make(opts: {
  decisions: Array<Record<string, unknown>>
  toolResult?: { result: unknown; summary: string; sources?: RagHit[] }
  configGet?: (key: string) => string | undefined
  /** 决策响应到手之后触发：模拟「这一次调用刚回来，用户就走了」 */
  afterDecision?: () => void
  /** 工具执行期间触发：模拟用户在检索/建单途中关窗口 */
  duringExecute?: () => void
  /** 给出若干块则走流式生成分支 */
  streamChunks?: string[]
  /** 每产出一块后触发：可在生成途中制造一次断连 */
  duringStream?: () => void
  /** message.aggregate 的返回（今日已用 token） */
  tokenSum?: { _sum: { promptTokens: number | null; completionTokens: number | null } }
}) {
  const persisted: Record<string, unknown>[] = []
  const llmCalls: Record<string, unknown>[] = []
  const chains: string[][] = []
  const executed: string[] = []
  const messageWrites: Record<string, unknown>[] = []
  const aggregateCalls: Record<string, unknown>[] = []

  const prisma = {
    chat: {
      findUnique: async () => ({
        user: { id: 'u1', role: 'employee', department: 'IT' },
        summary: null,
        summaryAnchorId: null,
      }),
      update: async () => ({}),
    },
    message: {
      findMany: async () => [],
      create: async (args: { data: Record<string, unknown> }) => {
        messageWrites.push(args.data)
        return { id: 'm-new', ...args.data }
      },
      aggregate: async (args: Record<string, unknown>) => {
        aggregateCalls.push(args)
        return opts.tokenSum ?? { _sum: { promptTokens: 0, completionTokens: 0 } }
      },
    },
    agentRun: {
      create: async (args: { data: Record<string, unknown> }) => {
        persisted.push(args.data)
        return args.data
      },
    },
    user: { findUnique: async () => ({ id: 'u1', role: 'employee', department: 'IT' }) },
  }

  const decisions = [...opts.decisions]
  // 与真实 LlmClient 一致：signal 已取消则一次请求都不发（真实实现里就是 LlmAbortedError）
  const checkCancelled = (input: Record<string, unknown>) => {
    if ((input.signal as AbortSignal | undefined)?.aborted) throw new LlmAbortedError()
  }
  const llmClient = {
    // 与真实 LlmClient.modelChain 同构：主模型 + env LLM_FALLBACK_MODELS（去重）
    modelChain: (primary: string) => {
      const chain = [primary]
      const raw = opts.configGet?.('LLM_FALLBACK_MODELS') ?? ''
      for (const m of raw.split(',')) {
        const t = m.trim()
        if (t && !chain.includes(t)) chain.push(t)
      }
      return chain
    },
    complete: async (_client: unknown, models: string[], input: Record<string, unknown>) => {
      checkCancelled(input)
      llmCalls.push(input)
      chains.push(models)
      const next = decisions.shift()
      if (!next) throw new Error('决策调用次数超出预期')
      opts.afterDecision?.()
      return completion(next, { prompt_tokens: 10, completion_tokens: 5 })
    },
    stream: async (_client: unknown, _models: string[], input: Record<string, unknown>) => {
      checkCancelled(input)
      llmCalls.push(input)
      const chunks = opts.streamChunks
      if (!chunks) throw new Error('本用例走直答路径，不应进入流式生成')
      const signal = input.signal as AbortSignal | undefined
      return {
        model: 'test-model',
        // 与真实 SDK 一致：取消后不再产出块，并以「正常结束」收场（不抛错）
        stream: (async function* () {
          for (const text of chunks) {
            if (signal?.aborted) return
            yield { choices: [{ delta: { content: text } }] }
            opts.duringStream?.()
          }
        })(),
      }
    },
  }

  const settingsService = {
    get: async (id: string, key: string) =>
      key === 'llmApiKey' ? 'test-key' : key === 'llmBaseUrl' ? 'https://example.invalid' : '',
  }
  const registry = {
    definitions: () => [],
    isReadOnly: () => true,
    execute: async (name: string) => {
      executed.push(name)
      opts.duringExecute?.()
      return opts.toolResult ?? { result: { message: '知识库中未检索到相关内容' }, summary: 's' }
    },
  }
  const personas = { active: async () => ({ version: 7, content: '生效人设全文' }) }
  const memoryService = { getUserMemory: async () => [], remember: async () => undefined }
  const knowledgeService = { searchRelevant: async () => [] }

  const service = new ChatService(
    prisma as unknown as PrismaService,
    { get: (key: string) => opts.configGet?.(key) } as unknown as ConfigService,
    llmClient as unknown as LlmClient,
    settingsService as unknown as SettingsService,
    knowledgeService as unknown as KnowledgeService,
    memoryService as unknown as MemoryService,
    registry as unknown as AgentToolRegistry,
    personas as unknown as AgentPersonaService,
    { createFromDraft: async () => ({ id: 't1', title: 'x' }) } as unknown as CreateTicketTool,
  )

  return { service, persisted, llmCalls, chains, executed, messageWrites, aggregateCalls }
}

async function drain(stream: AsyncGenerator<AgentStreamEvent>) {
  const events: AgentStreamEvent[] = []
  for await (const evt of stream) events.push(evt)
  return events
}

describe('ChatService.startStream 流接线', () => {
  const warns: unknown[] = []
  beforeEach(() => {
    warns.length = 0
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void warns.push(m))
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('返回的流可以被完整消费（回归守卫：函数未被调用时首帧即抛）', async () => {
    const { service, persisted, llmCalls } = make({
      decisions: [{ content: '你好，有什么可以帮你？' }],
    })

    const { stream } = await service.startStream('c1', '你好', undefined, undefined, undefined, {
      requestId: 'req-1',
    })
    const events = await drain(stream)

    expect(events).toEqual([{ type: 'content', text: '你好，有什么可以帮你？' }])
    // 生效的人设版本要真的进消息序列
    const messages = llmCalls[0]?.messages as Array<{ role: string; content: unknown }>
    expect(messages[0]).toMatchObject({ role: 'system', content: '生效人设全文' })
    // 归因字段落库
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      status: 'completed',
      personaVersion: 7,
      requestId: 'req-1',
      rounds: 1,
    })
  })

  it('检索命中重复时按片段去重，引用数与 [n] 编号口径一致', async () => {
    const dup = hit()
    const { service, persisted } = make({
      decisions: [
        {
          tool_calls: [
            {
              type: 'function',
              id: 'call-1',
              function: { name: 'search_knowledge', arguments: '{"query":"vpn"}' },
            },
          ],
          content: null,
        },
        {
          tool_calls: [
            {
              type: 'function',
              id: 'call-2',
              function: { name: 'search_knowledge', arguments: '{"query":"vpn 重查"}' },
            },
          ],
          content: null,
        },
        { content: '按知识库回答' },
      ],
      // 两次检索返回完全相同的片段（多轮检索的常见结果）
      toolResult: { result: [dup], summary: '命中 1 片段', sources: [dup, hit({ score: 0.4 })] },
    })

    const { stream } = await service.startStream('c1', 'vpn 怎么连')
    const events = await drain(stream)

    const sources = events.find((e) => e.type === 'sources') as { sources: RagHit[] }
    expect(sources.sources).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ sources: 1, toolCalls: 2 })
  })

  it('中断路径也落一条 partial 轨迹，并带上同一 requestId', async () => {
    const { service, persisted } = make({
      decisions: [{ content: '部分回答' }],
    })
    const { stream } = await service.startStream('c1', '你好', undefined, undefined, undefined, {
      requestId: 'req-2',
    })
    // 取走首帧即提前 return，模拟客户端断连触发 generator.return()
    const first = await stream.next()
    expect(first.value).toMatchObject({ type: 'content' })
    await stream.return(undefined as never)

    expect(persisted.at(-1)).toMatchObject({
      status: 'partial',
      requestId: 'req-2',
      personaVersion: 7,
    })
  })
})

// 确认门没有结论时的两条收尾路径：超时、以及客户端断连。
// 都不能把这一路流无限挂住（挂住冻的是 SSE、会话槽位和整个界面），
// 也不能把草稿判成拒绝 —— 之后恢复出来的确认卡还要能把它建成。
describe('ChatService 确认门收尾', () => {
  const TOOL_CALL = {
    type: 'function' as const,
    id: 'call-ticket',
    function: {
      name: 'create_ticket',
      arguments: '{"title":"重置密码","content":"账号 x","priority":"high","category":"account"}',
    },
  }

  function makeConfirmCase(confirmTimeoutMs = 150) {
    const persisted: Record<string, unknown>[] = []
    const draftWrites: string[] = []
    const llmCalls: Array<Record<string, unknown>> = []
    const created = { count: 0 }

    const prisma = {
      chat: {
        findUnique: async () => ({
          user: { id: 'u1', role: 'employee', department: 'IT' },
          summary: null,
          summaryAnchorId: null,
        }),
        update: async () => ({}),
      },
      message: {
        findMany: async () => [],
        create: async (a: { data: Record<string, unknown> }) => ({ id: 'm1', ...a.data }),
      },
      agentRun: {
        create: async (a: { data: Record<string, unknown> }) => {
          persisted.push(a.data)
        },
      },
      ticketDraft: {
        upsert: async () => {
          draftWrites.push('upsert')
        },
        // 始终 pending：没人决定过
        findUnique: async () => ({ status: 'pending' }),
        updateMany: async () => {
          draftWrites.push('updateMany')
          return { count: 1 }
        },
      },
    }

    const registry = {
      definitions: () => [],
      isReadOnly: () => false, // 写工具：串行、走确认门
      execute: async (_name: string, _args: string, ctx: Record<string, unknown>) => {
        ;(ctx.registerConfirm as (d: unknown) => void)({
          title: '重置密码',
          content: '账号 x',
          priority: 'high',
          category: 'account',
        })
        return { result: null, summary: '等待用户确认', needsConfirm: true }
      },
    }

    const decisions: Array<Record<string, unknown>> = [
      { content: null, tool_calls: [TOOL_CALL] },
      { content: '确认卡还在等你决定，这轮先没建单。' }, // 超时后模型据此收尾
    ]
    const llmClient = {
      modelChain: (p: string) => [p],
      complete: async (_c: unknown, _m: string[], input: Record<string, unknown>) => {
        llmCalls.push(input)
        const next = decisions.shift()
        if (!next) throw new Error('不应再发起决策调用')
        return { completion: { choices: [{ message: next }], usage: {} }, model: 'test-model' }
      },
      stream: async () => {
        throw new Error('超时收尾走直答路径，不该进流式生成')
      },
    }

    const config = {
      get: (key: string) =>
        key === 'CONFIRM_WAIT_TIMEOUT_MS'
          ? String(confirmTimeoutMs)
          : key === 'CONFIRM_WAIT_POLL_MS'
            ? '30'
            : undefined,
    }
    const settings = {
      get: async (_id: string, key: string) =>
        key === 'llmApiKey' ? 'k' : key === 'llmBaseUrl' ? 'https://example.invalid' : '',
    }

    const service = new ChatService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      llmClient as unknown as LlmClient,
      settings as unknown as SettingsService,
      { searchRelevant: async () => [] } as unknown as KnowledgeService,
      { getUserMemory: async () => [] } as unknown as MemoryService,
      registry as unknown as AgentToolRegistry,
      { active: async () => ({ version: 3, content: '人设' }) } as unknown as AgentPersonaService,
      {
        createFromDraft: async () => {
          created.count++
          return { id: 't1', title: '重置密码' }
        },
      } as unknown as CreateTicketTool,
    )
    return { service, persisted, draftWrites, llmCalls, created }
  }

  it('超时后仍产出收尾事件与最终回答，且不建单、不把草稿判成拒绝', async () => {
    const { service, persisted, draftWrites, created } = makeConfirmCase()

    const { stream } = await service.startStream('c1', '帮我重置密码')
    const events = await drain(stream)

    // 先推确认 → 以超时收尾 → 给出回答：客户端不会看到一个永远不动的界面
    expect(events.map((e) => e.type)).toEqual(['tool', 'confirm_required', 'tool', 'content'])
    expect((events[2] as { step: { summary: string } }).step.summary).toContain('超时')
    expect(events[3]).toMatchObject({ type: 'content', text: '确认卡还在等你决定，这轮先没建单。' })

    expect(created.count).toBe(0)
    // 草稿只允许被 upsert 成 pending：改写状态会让稍后恢复的确认卡失效
    expect(draftWrites).toEqual(['upsert'])
    expect(persisted[0]).toMatchObject({ status: 'completed', ticketId: null, personaVersion: 3 })
  })

  it('超时结论回传给模型：说明未建单且不要重复调用', async () => {
    const { service, llmCalls } = makeConfirmCase()
    const { stream } = await service.startStream('c1', '帮我重置密码')
    await drain(stream)

    const messages = llmCalls[1]?.messages as Array<{ role: string; content: unknown }>
    const toolMsg = messages.find((m) => m.role === 'tool')
    expect(String(toolMsg?.content)).toContain('尚未对该建单请求做出决定')
    expect(String(toolMsg?.content)).toContain('不要重复调用 create_ticket')
  })

  it('等待中被客户端断连取消：立刻收手，不占着槽位等满超时窗口', async () => {
    // 超时窗口放到 60s：只有取消真的传进了确认门，这个用例才不会挂死
    const ac = new AbortController()
    const { service, persisted, draftWrites, llmCalls, created } = makeConfirmCase(60_000)

    const { stream } = await service.startStream(
      'c1',
      '帮我重置密码',
      undefined,
      undefined,
      undefined,
      { requestId: 'req-gone', signal: ac.signal },
    )
    const it = stream[Symbol.asyncIterator]()
    expect(await it.next()).toMatchObject({ value: { type: 'tool' } })
    expect(await it.next()).toMatchObject({ value: { type: 'confirm_required' } })

    ac.abort()
    const startedAt = Date.now()
    const rest: AgentStreamEvent[] = []
    let err: unknown = null
    try {
      for (;;) {
        const r = await it.next()
        if (r.done) break
        rest.push(r.value as AgentStreamEvent)
      }
    } catch (e) {
      err = e
    }

    expect(Date.now() - startedAt).toBeLessThan(2000)
    expect(err).toBeInstanceOf(LlmAbortedError)
    // 人都不在了，还去问第二轮模型 = 白付一次整个上下文的 token
    expect(llmCalls).toHaveLength(1)
    expect(created.count).toBe(0)
    // 与超时同一路：草稿保持 pending，用户回来仍能确认建单
    expect(draftWrites).toEqual(['upsert'])
    expect(persisted.at(-1)).toMatchObject({ status: 'partial', requestId: 'req-gone' })
  })
})

// 断连之后循环不该继续往下走：工具副作用没人可告知、下一轮决策白付 token。
describe('ChatService 断连取消', () => {
  const SEARCH = {
    type: 'function' as const,
    id: 'call-search',
    function: { name: 'search_knowledge', arguments: '{"query":"vpn"}' },
  }
  const opts = (signal: AbortSignal) => ({ requestId: 'req-1', signal })

  it('决策响应到手时用户已走：不执行工具', async () => {
    const ac = new AbortController()
    const { service, executed, persisted } = make({
      decisions: [{ content: null, tool_calls: [SEARCH] }, { content: '不该走到这里' }],
      afterDecision: () => ac.abort(),
    })

    const { stream } = await service.startStream(
      'c1',
      'vpn 怎么连',
      undefined,
      undefined,
      undefined,
      opts(ac.signal),
    )
    await expect(drain(stream)).rejects.toBeInstanceOf(LlmAbortedError)

    expect(executed).toEqual([])
    expect(persisted.at(-1)).toMatchObject({ status: 'partial' })
  })

  it('工具执行中断连：不再发起下一轮决策，也不开生成流', async () => {
    const ac = new AbortController()
    const { service, executed, llmCalls } = make({
      decisions: [
        { content: null, tool_calls: [SEARCH] },
        { content: null }, // 若真走到这里就会进入流式生成
      ],
      toolResult: { result: [hit()], summary: '命中 1 片段' },
      duringExecute: () => ac.abort(),
    })

    const { stream } = await service.startStream(
      'c1',
      'vpn 怎么连',
      undefined,
      undefined,
      undefined,
      opts(ac.signal),
    )
    await expect(drain(stream)).rejects.toBeInstanceOf(LlmAbortedError)

    expect(executed).toEqual(['search_knowledge'])
    expect(llmCalls).toHaveLength(1)
  })

  it('生成流被取消后即使「正常结束」，也不把截断的回答当完整回答落库', async () => {
    // 真实 SDK 在 abort 时是把响应流关成正常结束，而不是抛错 —— 只依赖异常会漏判
    const ac = new AbortController()
    const { service, persisted, messageWrites } = make({
      decisions: [
        { content: null, tool_calls: [SEARCH] },
        { content: null }, // 无正文 → 进入流式生成
      ],
      toolResult: { result: [hit()], summary: '命中 1 片段' },
      streamChunks: ['前半句', '后半句', '不该出现的第三段'],
      duringStream: () => ac.abort(), // 第一段之后就断连
    })

    const { stream } = await service.startStream(
      'c1',
      'vpn 怎么连',
      undefined,
      undefined,
      undefined,
      opts(ac.signal),
    )
    await expect(drain(stream)).rejects.toBeInstanceOf(LlmAbortedError)

    const assistant = messageWrites.filter((m) => m.role === 'assistant')
    expect(assistant).toHaveLength(1)
    expect(String(assistant[0].content)).toBe('前半句\n\n_[已中断]_ ')
    expect(persisted.at(-1)).toMatchObject({ status: 'partial' })
  })

  it('未取消时照常跑完：取消检查不会自己把流程掐了', async () => {
    const ac = new AbortController()
    const { service, executed, persisted } = make({
      decisions: [{ content: null, tool_calls: [SEARCH] }, { content: '按知识库回答' }],
      toolResult: { result: [hit()], summary: '命中 1 片段' },
    })

    const { stream } = await service.startStream(
      'c1',
      'vpn 怎么连',
      undefined,
      undefined,
      undefined,
      {
        requestId: 'req-1',
        signal: ac.signal,
      },
    )
    const events = await drain(stream)

    expect(executed).toEqual(['search_knowledge'])
    expect(events.at(-1)).toMatchObject({ type: 'content', text: '按知识库回答' })
    expect(persisted.at(-1)).toMatchObject({ status: 'completed', rounds: 2 })
  })
})

// 决策分档：多轮决策每轮都重发整个上下文，是 token 大头；但选错工具的代价直接落在
// 用户头上，所以缺省必须与生成同模型，分档只能是显式配置。
describe('决策模型分档', () => {
  const direct = { decisions: [{ content: '直答' }] }

  it('未配置决策模型时沿用生成模型链（默认不降级）', async () => {
    const { service, chains } = make({ ...direct })
    const { stream } = await service.startStream('c1', '你好', 'glm-strong')
    await drain(stream)

    expect(chains).toEqual([['glm-strong']])
  })

  it('配置后决策走自己的链，并保留备用模型降级', async () => {
    const { service, chains } = make({
      ...direct,
      configGet: (key) =>
        key === 'LLM_DECISION_MODEL'
          ? 'glm-flash'
          : key === 'LLM_FALLBACK_MODELS'
            ? 'glm-strong, backup-x'
            : undefined,
    })
    const { stream } = await service.startStream('c1', '你好', 'glm-strong')
    await drain(stream)

    // 决策链以指定模型打头，其后仍是 env 备用列表（含生成模型，故降级会回到强模型）
    expect(chains[0]).toEqual(['glm-flash', 'glm-strong', 'backup-x'])
  })

  it('配置为空白时等价于未配置', async () => {
    const { service, chains } = make({
      ...direct,
      configGet: (key) => (key === 'LLM_DECISION_MODEL' ? '   ' : undefined),
    })
    const { stream } = await service.startStream('c1', '你好', 'glm-strong')
    await drain(stream)

    expect(chains[0]).toEqual(['glm-strong'])
  })
})

// 用量闸门：限流管频率，管不住「一次提问烧多少」。一路 Agent 是 1-4 次决策 + 1 次生成，
// 跑飞的循环几分钟就能把上游配额吃穿 —— 那笔钱按 token 计。
describe('每用户每日 token 预算', () => {
  const budgetConfig = (budget: string) => ({
    configGet: (key: string) => (key === 'USER_DAILY_TOKEN_BUDGET' ? budget : undefined),
  })

  it('未配置预算时不发聚合查询（关掉功能不该给每次提问加一次 DB 往返）', async () => {
    const { service, aggregateCalls } = make({ decisions: [{ content: '直答' }] })

    await expect(service.assertTokenBudget('u1')).resolves.toBeUndefined()
    expect(aggregateCalls).toHaveLength(0)

    const state = await service.budgetStatus('u1')
    expect(state.budgetTokens).toBe(0)
    expect(aggregateCalls).toHaveLength(0)
  })

  it('未超预算放行，用量口径为 prompt + completion', async () => {
    const { service, aggregateCalls } = make({
      decisions: [{ content: '直答' }],
      ...budgetConfig('10000'),
      tokenSum: { _sum: { promptTokens: 4000, completionTokens: 1500 } },
    })

    await expect(service.assertTokenBudget('u1')).resolves.toBeUndefined()
    const state = await service.budgetStatus('u1')
    expect(state.usedTokens).toBe(5500)
    // 只算自己会话里的 assistant 消息，且窗口从今天 00:00 起
    expect(aggregateCalls[0]?.where).toMatchObject({ role: 'assistant', chat: { userId: 'u1' } })
    expect(
      (aggregateCalls[0]?.where as { createdAt: { gte: Date } }).createdAt.gte.getHours(),
    ).toBe(0)
  })

  it('用满预算即拒：429 + 可读原因 + 重置时间', async () => {
    const { service } = make({
      decisions: [{ content: '直答' }],
      ...budgetConfig('10000'),
      tokenSum: { _sum: { promptTokens: 9000, completionTokens: 2000 } },
    })

    const err = await service.assertTokenBudget('u1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpException)
    const body = (err as HttpException).getResponse() as Record<string, unknown>
    expect((err as HttpException).getStatus()).toBe(429)
    expect(body.reason).toBe('token_budget')
    expect(body.usedTokens).toBe(11000)
    expect(body.budgetTokens).toBe(10000)
    expect(String(body.message)).toContain('10000')
    expect(String(body.resetsAt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
