import { Logger } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { LlmClient } from '@/common/llm-client'
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
}) {
  const persisted: Record<string, unknown>[] = []
  const llmCalls: Record<string, unknown>[] = []

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
      create: async (args: { data: Record<string, unknown> }) => ({
        id: 'm-new',
        ...args.data,
      }),
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
  const llmClient = {
    modelChain: (primary: string) => [primary],
    complete: async (_client: unknown, _models: string[], input: Record<string, unknown>) => {
      llmCalls.push(input)
      const next = decisions.shift()
      if (!next) throw new Error('决策调用次数超出预期')
      return completion(next, { prompt_tokens: 10, completion_tokens: 5 })
    },
    stream: async () => {
      throw new Error('本用例走直答路径，不应进入流式生成')
    },
  }

  const settingsService = {
    get: async (id: string, key: string) =>
      key === 'llmApiKey' ? 'test-key' : key === 'llmBaseUrl' ? 'https://example.invalid' : '',
  }
  const registry = {
    definitions: () => [],
    isReadOnly: () => true,
    execute: async () =>
      opts.toolResult ?? { result: { message: '知识库中未检索到相关内容' }, summary: 's' },
  }
  const personas = { active: async () => ({ version: 7, content: '生效人设全文' }) }
  const memoryService = { getUserMemory: async () => [], remember: async () => undefined }
  const knowledgeService = { searchRelevant: async () => [] }

  const service = new ChatService(
    prisma as unknown as PrismaService,
    { get: () => undefined } as unknown as ConfigService,
    llmClient as unknown as LlmClient,
    settingsService as unknown as SettingsService,
    knowledgeService as unknown as KnowledgeService,
    memoryService as unknown as MemoryService,
    registry as unknown as AgentToolRegistry,
    personas as unknown as AgentPersonaService,
    { createFromDraft: async () => ({ id: 't1', title: 'x' }) } as unknown as CreateTicketTool,
  )

  return { service, persisted, llmCalls }
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

    const { stream } = await service.startStream(
      'c1',
      '你好',
      undefined,
      undefined,
      undefined,
      'req-1',
    )
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
    const { stream } = await service.startStream(
      'c1',
      '你好',
      undefined,
      undefined,
      undefined,
      'req-2',
    )
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

// 确认门超时：不能把这一路流无限挂住（挂住冻的是 SSE、会话槽位和整个界面），
// 也不能把草稿判成拒绝 —— 之后恢复出来的确认卡还要能把它建成。
describe('ChatService 确认门超时收尾', () => {
  const TOOL_CALL = {
    type: 'function' as const,
    id: 'call-ticket',
    function: {
      name: 'create_ticket',
      arguments: '{"title":"重置密码","content":"账号 x","priority":"high","category":"account"}',
    },
  }

  function makeConfirmCase() {
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
          ? '150'
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
})
