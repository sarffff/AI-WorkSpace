import type { KnowledgeService, RagHit } from '@/modules/knowledge/knowledge.service'
import type { TicketsService } from '@/modules/tickets/tickets.service'
import type { MemoryService } from '@/modules/memory/memory.service'
import { AgentToolRegistry } from './registry.service'
import { CreateTicketTool } from './create-ticket.tool'
import { GetTicketTool, LookupMyTicketsTool, SearchKnowledgeTool } from './read-tools'
import { toJsonSchema, validateArgs } from './schema'
import type { ToolContext } from './types'

// 行为依据（与实现一致）：
// - search_knowledge 空命中返回 { message }（驱动反思轮），命中则截断到 500 字符
// - lookup_my_tickets 复用 list 的行级可见性后收窄到本人创建，按 updatedAt 倒序
// - create_ticket：evalMode 只记意图 > 幂等短路 > HITL 确认门 > 直接建单，优先级依次判定
// - createFromDraft 建单后必定写一条 ticket 记忆

const owner = { id: 'u1', role: 'employee', department: 'IT' }
const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({ owner, ...extra })

const hit = (name: string, content: string): RagHit => ({
  content,
  score: 0.9,
  documentId: 'd1',
  documentName: name,
  sectionPath: 'A > B',
})

describe('SearchKnowledgeTool', () => {
  const build = (hits: RagHit[]) => {
    const knowledge = { searchRelevant: jest.fn().mockResolvedValue(hits) }
    return {
      knowledge,
      tool: new SearchKnowledgeTool(knowledge as unknown as KnowledgeService),
    }
  }

  it('命中时返回片段并携带 sources 供溯源', async () => {
    const { tool, knowledge } = build([hit('VPN 手册', 'x'.repeat(600))])
    const res = await tool.execute({ query: 'vpn' }, ctx())
    expect(knowledge.searchRelevant).toHaveBeenCalledWith(owner, 'vpn')
    const rows = res.result as { content: string; documentName: string }[]
    expect(rows[0].documentName).toBe('VPN 手册')
    expect(rows[0].content).toHaveLength(500) // 截断，避免单片段挤爆上下文
    expect(res.sources).toHaveLength(1)
    expect(res.summary).toBe('"vpn" · 命中 1 片段')
  })

  it('空命中返回 message（驱动反思轮），summary 记 0 片段', async () => {
    const { tool } = build([])
    const res = await tool.execute({ query: 'nope' }, ctx())
    expect(res.result).toEqual({ message: '知识库中未检索到相关内容' })
    expect(res.summary).toBe('"nope" · 命中 0 片段')
  })
})

describe('LookupMyTicketsTool', () => {
  const row = (id: string, creatorId: string, status: string, updatedAt: Date) => ({
    id,
    creatorId,
    title: `t-${id}`,
    status,
    priority: 'normal',
    assignee: { name: '张三' },
    createdAt: new Date('2026-08-01'),
    updatedAt,
    comments: [{ kind: 'system', content: 'c'.repeat(300), createdAt: new Date('2026-08-02') }],
  })

  const build = (rows: unknown[]) => {
    const tickets = { list: jest.fn().mockResolvedValue(rows) }
    return new LookupMyTicketsTool(tickets as unknown as TicketsService)
  }

  it('过滤掉非本人创建的工单，并按 updatedAt 倒序', async () => {
    const tool = build([
      row('a', 'u1', 'open', new Date('2026-08-03')),
      row('b', 'other', 'open', new Date('2026-08-09')), // 他人创建（可见但非本人）
      row('c', 'u1', 'closed', new Date('2026-08-05')),
    ])
    const res = (await tool.execute({}, ctx())).result as {
      total: number
      tickets: { id: string; latestComment: { content: string } }[]
    }
    expect(res.total).toBe(2)
    expect(res.tickets.map((t) => t.id)).toEqual(['c', 'a'])
    expect(res.tickets[0].latestComment.content).toHaveLength(200) // 评论截断
  })

  it('带 status 时按状态过滤', async () => {
    const tool = build([
      row('a', 'u1', 'open', new Date('2026-08-03')),
      row('c', 'u1', 'closed', new Date('2026-08-05')),
    ])
    const res = (await tool.execute({ status: 'closed' }, ctx())).result as {
      tickets: { id: string }[]
    }
    expect(res.tickets.map((t) => t.id)).toEqual(['c'])
  })
})

describe('GetTicketTool', () => {
  it('只取最近 2 条评论并截断内容', async () => {
    const tickets = {
      detail: jest.fn().mockResolvedValue({
        id: 'TK1',
        title: '投影仪报修',
        status: 'processing',
        priority: 'high',
        content: 'y'.repeat(900),
        assignee: { name: '李四' },
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-02'),
        comments: [
          { kind: 'comment', author: { name: 'a' }, content: '1', createdAt: new Date() },
          { kind: 'comment', author: { name: 'b' }, content: '2', createdAt: new Date() },
          { kind: 'comment', author: { name: 'c' }, content: '3', createdAt: new Date() },
        ],
      }),
    }
    const tool = new GetTicketTool(tickets as unknown as TicketsService)
    const res = await tool.execute({ id: 'TK1' }, ctx())
    const out = res.result as { content: string; recentComments: { content: string }[] }
    expect(tickets.detail).toHaveBeenCalledWith(owner, 'TK1')
    expect(out.content).toHaveLength(500)
    expect(out.recentComments.map((c) => c.content)).toEqual(['2', '3'])
    expect(res.summary).toBe('工单「投影仪报修」(processing)')
  })
})

describe('CreateTicketTool', () => {
  const args = {
    title: '重置密码',
    content: '账号 zhangsan',
    priority: 'high' as const,
    category: 'account' as const,
  }

  const build = () => {
    const tickets = {
      create: jest.fn().mockResolvedValue({ id: 'TK-NEW-123456789', title: '重置密码' }),
    }
    const memory = { remember: jest.fn().mockResolvedValue(undefined) }
    return {
      tickets,
      memory,
      tool: new CreateTicketTool(
        tickets as unknown as TicketsService,
        memory as unknown as MemoryService,
      ),
    }
  }

  it('evalMode 只记录意图：不建单、不写记忆', async () => {
    const { tool, tickets, memory } = build()
    const res = await tool.execute(args, ctx({ evalMode: true }))
    expect(tickets.create).not.toHaveBeenCalled()
    expect(memory.remember).not.toHaveBeenCalled()
    expect(res.result).toEqual({ evaluation: 'create_ticket intent recorded' })
  })

  it('evalMode 优先于确认门（评测绝不触发 HITL）', async () => {
    const { tool, tickets } = build()
    const registerConfirm = jest.fn()
    const res = await tool.execute(args, ctx({ evalMode: true, registerConfirm }))
    expect(registerConfirm).not.toHaveBeenCalled()
    expect(tickets.create).not.toHaveBeenCalled()
    expect(res.needsConfirm).toBeUndefined()
  })

  it('本会话已建单时幂等短路，不重复建单', async () => {
    const { tool, tickets } = build()
    const createdTicket = { id: 'TK-OLD', title: '旧工单' }
    const res = await tool.execute(args, ctx({ createdTicket }))
    expect(tickets.create).not.toHaveBeenCalled()
    expect(res.result).toEqual({
      ticketId: 'TK-OLD',
      title: '旧工单',
      status: '已创建，请勿重复建单，直接告知用户工单编号',
    })
    expect(res.summary).toBe('已存在工单「旧工单」，跳过')
  })

  it('幂等短路优先于确认门（已建单不再弹确认）', async () => {
    const { tool } = build()
    const registerConfirm = jest.fn()
    const res = await tool.execute(
      args,
      ctx({ createdTicket: { id: 'TK-OLD', title: '旧工单' }, registerConfirm }),
    )
    expect(registerConfirm).not.toHaveBeenCalled()
    expect(res.needsConfirm).toBeUndefined()
  })

  it('有确认门时只登记草稿，不产生建单副作用', async () => {
    const { tool, tickets, memory } = build()
    const registerConfirm = jest.fn()
    const res = await tool.execute(args, ctx({ registerConfirm }))
    expect(registerConfirm).toHaveBeenCalledWith({
      title: '重置密码',
      content: '账号 zhangsan',
      priority: 'high',
      category: 'account',
    })
    expect(tickets.create).not.toHaveBeenCalled()
    expect(memory.remember).not.toHaveBeenCalled()
    expect(res).toMatchObject({ result: null, needsConfirm: true, summary: '等待用户确认' })
  })

  it('无确认门时直接建单并写记忆', async () => {
    const { tool, tickets, memory } = build()
    const res = await tool.execute(args, ctx({ chatId: 'chat-1' }))
    // 来源与归属会话走第三个内部参数：不接受客户端自报（偏转率的分子与归属依据）
    expect(tickets.create).toHaveBeenCalledWith(
      'u1',
      { title: '重置密码', content: '账号 zhangsan', priority: 'high', category: 'account' },
      { source: 'agent', chatId: 'chat-1' },
    )
    expect(memory.remember).toHaveBeenCalledWith(
      'u1',
      'ticket',
      expect.stringContaining('创建工单「重置密码」'),
      'chat-1',
    )
    expect(res.ticket).toEqual({ id: 'TK-NEW-123456789', title: '重置密码' })
  })

  it('priority / category 缺省时按 normal / other 建单', async () => {
    const { tool, tickets } = build()
    await tool.execute({ title: 't', content: 'c' }, ctx())
    expect(tickets.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ priority: 'normal', category: 'other' }),
      // ctx() 无 chatId：归属留空，不能被写成空串（口径要能区分「未知」和「不属于任何会话」）
      expect.objectContaining({ source: 'agent', chatId: null }),
    )
  })

  describe('分类参数（schema enum + fallback）', () => {
    const validate = (raw: unknown) => validateArgs('create_ticket', CreateTicketTool.schema, raw)

    it.each(['account', 'hardware', 'network', 'software', 'process', 'other'])(
      '接受合法分类 %s',
      (category) => {
        const res = validate({ title: 't', content: 'c', category })
        expect(res.ok).toBe(true)
        expect(res.args?.category).toBe(category)
      },
    )

    it.each([
      ['中文标签（模型可能直接给标签而非枚举值）', '账号权限'],
      ['臆造分类', 'printer'],
      ['数字', 3],
      ['空字符串', ''],
    ])('分类为 %s 时回退 other 而非报错（分类判错不该打断建单）', (_label, category) => {
      const res = validate({ title: 't', content: 'c', category })
      expect(res.ok).toBe(true)
      expect(res.args?.category).toBe('other')
    })

    it('六个分类都出现在给模型的 schema enum 中', () => {
      const params = toJsonSchema(CreateTicketTool.schema) as {
        properties: { category: { enum: string[] } }
      }
      expect(params.properties.category.enum).toEqual([
        'account',
        'hardware',
        'network',
        'software',
        'process',
        'other',
      ])
    })
  })

  describe('createFromDraft', () => {
    it('建单成功后必定写一条 ticket 记忆（含单号前 8 位）', async () => {
      const { tool, tickets, memory } = build()
      const ref = await tool.createFromDraft(
        'u9',
        { title: '重置密码', content: 'c', priority: 'low', category: 'account' },
        'chat-9',
      )
      expect(ref).toEqual({ id: 'TK-NEW-123456789', title: '重置密码' })
      // 会话归属要落到工单行本身，不能只进长期记忆 —— 偏转率的分子按工单行数算
      expect(tickets.create).toHaveBeenCalledWith(
        'u9',
        expect.objectContaining({ title: '重置密码' }),
        { source: 'agent', chatId: 'chat-9' },
      )
      expect(memory.remember).toHaveBeenCalledWith(
        'u9',
        'ticket',
        expect.stringContaining('单号 TK-NEW-'),
        'chat-9',
      )
    })

    it('建单失败时不写记忆，异常向上抛（调用方回滚草稿）', async () => {
      const { tool, tickets, memory } = build()
      tickets.create.mockRejectedValue(new Error('DB down'))
      await expect(
        tool.createFromDraft('u9', {
          title: 't',
          content: 'c',
          priority: 'low',
          category: 'other',
        }),
      ).rejects.toThrow('DB down')
      expect(memory.remember).not.toHaveBeenCalled()
    })
  })
})

// 注册表 + 真实工具的装配校验：模型看到的工具清单与并发判定必须与实现一致
describe('注册表装配（真实工具）', () => {
  const registry = new AgentToolRegistry([
    new SearchKnowledgeTool({} as KnowledgeService),
    new LookupMyTicketsTool({} as TicketsService),
    new GetTicketTool({} as TicketsService),
    new CreateTicketTool({} as TicketsService, {} as MemoryService),
  ])

  it('暴露全部四个工具', () => {
    expect(registry.names()).toEqual([
      'search_knowledge',
      'lookup_my_tickets',
      'get_ticket',
      'create_ticket',
    ])
  })

  it('三个读工具可并行，建单工具必须串行', () => {
    expect(registry.isReadOnly('search_knowledge')).toBe(true)
    expect(registry.isReadOnly('lookup_my_tickets')).toBe(true)
    expect(registry.isReadOnly('get_ticket')).toBe(true)
    expect(registry.isReadOnly('create_ticket')).toBe(false)
  })

  it('create_ticket 的 required 只含 title/content（priority 有 fallback）', () => {
    const def = registry.definitions().find((d) => d.function.name === 'create_ticket')
    expect((def?.function.parameters as { required: string[] }).required).toEqual([
      'title',
      'content',
    ])
  })
})
