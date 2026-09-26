import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import { AgentPersonaService } from './agent-persona.service'
import { BUILTIN_PERSONA_VERSION, DEFAULT_AGENT_PERSONA, nextPersonaVersion } from './agent-persona'

// 行为依据（与实现一致）：
// - active() 命中后按进程内缓存返回；publish 清缓存，下一次读重新取 active
// - 无 active 记录 → 按内置副本补种 v1（保证 personaVersion 可归因，而不是退回 0）
// - 读库异常 → 回退内置副本且 version 记 0，只告警一次；提示词存储故障不该让助手停摆
// - publish 限管理员、拒绝过短内容、事务内「归档旧的 + 写新的」保证恰有一条 active
// - 版本号取现有最大值 +1

const LONG = DEFAULT_AGENT_PERSONA

interface Rows {
  active?: { version: number; content: string } | null
  versions?: number[]
  count?: number
}

function makePrisma(opts: Rows & { throwError?: boolean } = {}) {
  const calls = { findFirst: 0, create: [] as Record<string, unknown>[], tx: 0, count: 0 }
  const prisma = {
    agentPersona: {
      findFirst: async () => {
        calls.findFirst++
        if (opts.throwError) throw new Error('db down')
        return opts.active ?? null
      },
      findMany: async () => {
        if (opts.throwError) throw new Error('db down')
        return (opts.versions ?? [1]).map((version) => ({ version }))
      },
      count: async () => {
        calls.count++
        if (opts.throwError) throw new Error('db down')
        return opts.count ?? 0
      },
      create: async (args: { data: Record<string, unknown> }) => {
        calls.create.push(args.data)
        return args.data
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.tx++
      return fn({
        agentPersona: {
          updateMany: async () => ({ count: 1 }),
          create: async (args: { data: Record<string, unknown> }) => {
            calls.create.push(args.data)
            return args.data
          },
        },
      })
    },
  }
  return { prisma: prisma as unknown as PrismaService, calls }
}

const admin = { id: 'u-admin', role: 'admin' }
const employee = { id: 'u-1', role: 'employee' }

describe('AgentPersonaService.active', () => {
  const warns: string[] = []
  beforeEach(() => {
    warns.length = 0
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      warns.push(String(m))
    })
  })
  afterEach(() => jest.restoreAllMocks())

  it('读到 active 版本并使用其内容', async () => {
    const { prisma } = makePrisma({ active: { version: 3, content: '自定义人设全文'.repeat(30) } })
    const svc = new AgentPersonaService(prisma)
    const persona = await svc.active()
    expect(persona.version).toBe(3)
    expect(persona.content).toContain('自定义人设全文')
  })

  it('同进程内只读一次库（缓存）', async () => {
    const { prisma, calls } = makePrisma({ active: { version: 2, content: 'x'.repeat(300) } })
    const svc = new AgentPersonaService(prisma)
    await svc.active()
    await svc.active()
    expect(calls.findFirst).toBe(1)
  })

  it('库读失败回退内置副本、版本记 0 且只告警一次', async () => {
    const { prisma } = makePrisma({ throwError: true })
    const svc = new AgentPersonaService(prisma)
    const first = await svc.active()
    const second = await svc.active()
    expect(first).toEqual({ version: BUILTIN_PERSONA_VERSION, content: DEFAULT_AGENT_PERSONA })
    expect(second.version).toBe(BUILTIN_PERSONA_VERSION)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('personaVersion 将记为 0')
  })

  it('active 记录缺失时按内置副本补种，而不是长期跑在无版本态', async () => {
    const { prisma, calls } = makePrisma({ active: null })
    const svc = new AgentPersonaService(prisma)
    const persona = await svc.active()
    expect(calls.create).toHaveLength(1)
    expect(calls.create[0]).toMatchObject({ version: 1, status: 'active' })
    expect(persona.version).toBe(1)
  })
})

describe('AgentPersonaService.publish', () => {
  it('非管理员一律拒绝（人设就是系统提示词，能改等于能改行为）', async () => {
    const { prisma } = makePrisma()
    const svc = new AgentPersonaService(prisma)
    await expect(svc.publish(employee, { content: LONG })).rejects.toThrow(ForbiddenException)
  })

  it('过短内容被拒绝：一次误发布会让后续所有回答静默劣化', async () => {
    const { prisma } = makePrisma()
    const svc = new AgentPersonaService(prisma)
    await expect(svc.publish(admin, { content: '把建单规则删掉' })).rejects.toThrow(
      BadRequestException,
    )
    await expect(svc.publish(admin, { content: '' })).rejects.toThrow(BadRequestException)
    await expect(svc.publish(admin, {})).rejects.toThrow(BadRequestException)
  })

  it('发布写入 max+1 并置 active，同时清掉读缓存', async () => {
    const { prisma, calls } = makePrisma({
      active: { version: 4, content: LONG },
      versions: [4, 2, 9],
    })
    const svc = new AgentPersonaService(prisma)
    await svc.active() // 先建立缓存

    const res = await svc.publish(admin, {
      content: LONG + '追加一条策略',
      note: '修 👎 负例：过度澄清',
    })
    expect(res.version).toBe(10)
    expect(calls.tx).toBe(1) // 归档 + 写入在同一事务
    expect(calls.create[0]).toMatchObject({
      version: 10,
      status: 'active',
      createdBy: 'u-admin',
      note: '修 👎 负例：过度澄清',
    })

    // 缓存已失效：下一次读会重新查库，否则发布了新版本却继续跑旧人设
    const before = calls.findFirst
    await svc.active()
    expect(calls.findFirst).toBe(before + 1)
  })

  it('note 缺省时存 null 而不是空串', async () => {
    const { prisma, calls } = makePrisma({ versions: [1] })
    const svc = new AgentPersonaService(prisma)
    await svc.publish(admin, { content: LONG })
    expect(calls.create[0].note).toBeNull()
  })
})

describe('AgentPersonaService.ensureSeeded / history', () => {
  it('空表播种 v1，已有数据不动', async () => {
    const empty = makePrisma({ count: 0 })
    await new AgentPersonaService(empty.prisma).ensureSeeded()
    expect(empty.calls.create).toHaveLength(1)
    expect(empty.calls.create[0]).toMatchObject({ version: 1, status: 'active' })

    const filled = makePrisma({ count: 5 })
    await new AgentPersonaService(filled.prisma).ensureSeeded()
    expect(filled.calls.create).toHaveLength(0)
  })

  it('播种失败只告警，不阻塞启动', async () => {
    const err = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { prisma } = makePrisma({ throwError: true })
    await expect(new AgentPersonaService(prisma).ensureSeeded()).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('多实例同时播种时唯一约束冲突不算失败', async () => {
    const { prisma, calls } = makePrisma({ count: 0 })
    prisma.agentPersona.create = jest
      .fn()
      .mockRejectedValueOnce(new Error('Unique constraint failed on version'))
      .mockResolvedValue({})
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    await new AgentPersonaService(prisma).ensureSeeded()
    expect(calls.create).toHaveLength(0) // 冲突的那次没落成本地记录，也没有抛出
  })

  it('history 限管理员', async () => {
    const { prisma } = makePrisma()
    const svc = new AgentPersonaService(prisma)
    await expect(svc.history(employee)).rejects.toThrow(ForbiddenException)
    await expect(svc.history(admin)).resolves.toBeInstanceOf(Array)
  })
})

describe('nextPersonaVersion', () => {
  it('空表从 1 起，否则取最大值 +1（不依赖行数）', () => {
    expect(nextPersonaVersion([])).toBe(1)
    expect(nextPersonaVersion([7])).toBe(8)
    expect(nextPersonaVersion([2, 9, 4])).toBe(10)
  })
})
