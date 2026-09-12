import { Test } from '@nestjs/testing'
import { KnowledgeService } from '@/modules/knowledge/knowledge.service'
import { TicketsService } from '@/modules/tickets/tickets.service'
import { MemoryService } from '@/modules/memory/memory.service'
import { AGENT_TOOL_PROVIDERS } from './index'
import { AgentToolRegistry } from './registry.service'
import { CreateTicketTool } from './create-ticket.tool'

// DI 装配校验：其余 spec 都手工 new 注册表，绕过了 Nest 容器 ——
// AGENT_TOOLS 工厂的 inject 列表漏登记/顺序错乱只会在真实启动时才暴露，
// 这里用 Testing 模块把装配本身也纳入回归。

describe('agent-tools DI 装配', () => {
  const build = () =>
    Test.createTestingModule({ providers: [...AGENT_TOOL_PROVIDERS] })
      .useMocker((token) => {
        if (token === KnowledgeService) return { searchRelevant: jest.fn() }
        if (token === TicketsService)
          return { list: jest.fn(), detail: jest.fn(), create: jest.fn() }
        if (token === MemoryService) return { remember: jest.fn() }
        return undefined
      })
      .compile()

  it('注册表可从容器解析，且拿到全部四个工具', async () => {
    const moduleRef = await build()
    const registry = moduleRef.get(AgentToolRegistry)
    expect(registry.names()).toEqual([
      'search_knowledge',
      'lookup_my_tickets',
      'get_ticket',
      'create_ticket',
    ])
  })

  it('definitions() 每项都有非空 description 与合法 parameters（模型可见契约）', async () => {
    const moduleRef = await build()
    const defs = moduleRef.get(AgentToolRegistry).definitions()
    expect(defs).toHaveLength(4)
    for (const def of defs) {
      expect(def.type).toBe('function')
      expect(def.function.description.length).toBeGreaterThan(10)
      expect(def.function.parameters).toMatchObject({ type: 'object' })
    }
  })

  it('CreateTicketTool 可单独注入（ChatService 依赖它做确认后建单）', async () => {
    const moduleRef = await build()
    expect(moduleRef.get(CreateTicketTool)).toBeInstanceOf(CreateTicketTool)
  })
})
