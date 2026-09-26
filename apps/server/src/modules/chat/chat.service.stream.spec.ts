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
