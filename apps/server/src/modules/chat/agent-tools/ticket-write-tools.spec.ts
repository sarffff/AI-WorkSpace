import type { TicketsService } from '@/modules/tickets/tickets.service'
import { AddTicketCommentTool, CloseMyTicketTool } from './ticket-write-tools'
import type { ToolContext } from './types'

// 行为依据（与实现一致）：
// - 两个写工具 readOnly=false（串行执行），evalMode 只记意图不写库
// - add_ticket_comment 复用 addComment 的行级可见性（越权由 NotFound 兜，registry 转错误）
// - close_my_ticket 只关本人创建的工单：非本人返回结构化错误、已关闭幂等跳过、否则走 update 关单

const owner = { id: 'u1', role: 'employee', department: 'IT' }
const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({ owner, ...extra })

describe('AddTicketCommentTool', () => {
  const build = () => {
    const tickets = { addComment: jest.fn().mockResolvedValue({ id: 'c1' }) }
    return { tickets, tool: new AddTicketCommentTool(tickets as unknown as TicketsService) }
  }

  it('是写工具（串行）', () => {
    expect(new AddTicketCommentTool({} as TicketsService).readOnly).toBe(false)
  })

  it('evalMode 只记录意图，不写库', async () => {
    const { tool, tickets } = build()
    const res = await tool.execute(
      { id: 'TK1', content: '补充：工号 123' },
      ctx({ evalMode: true }),
    )
    expect(tickets.addComment).not.toHaveBeenCalled()
    expect(res.result).toEqual({ evaluation: 'add_ticket_comment intent recorded' })
  })

  it('正常路径复用 addComment 的行级可见性', async () => {
    const { tool, tickets } = build()
    const res = await tool.execute({ id: 'TK1', content: '追问进度' }, ctx())
    expect(tickets.addComment).toHaveBeenCalledWith(owner, 'TK1', { content: '追问进度' })
    expect(res.result).toEqual({ ticketId: 'TK1', status: '已在工单时间线追加留言' })
  })
})

describe('CloseMyTicketTool', () => {
  const build = (detail: unknown) => {
    const tickets = {
      detail: jest.fn().mockResolvedValue(detail),
      update: jest.fn().mockResolvedValue({ id: 'TK1', status: 'closed' }),
    }
    return { tickets, tool: new CloseMyTicketTool(tickets as unknown as TicketsService) }
  }

  const ticketOf = (over: Record<string, unknown> = {}) => ({
    id: 'TK1',
    title: '重置密码',
    status: 'processing',
    creator: { id: 'u1', name: '张三' },
    ...over,
  })

  it('是写工具（串行）', () => {
    expect(new CloseMyTicketTool({} as TicketsService).readOnly).toBe(false)
  })

  it('evalMode 只记录意图，不写库', async () => {
    const { tool, tickets } = build(ticketOf())
    const res = await tool.execute({ id: 'TK1' }, ctx({ evalMode: true }))
    expect(tickets.detail).not.toHaveBeenCalled()
    expect(tickets.update).not.toHaveBeenCalled()
    expect(res.result).toEqual({ evaluation: 'close_my_ticket intent recorded' })
  })

  it('非本人创建的工单：返回结构化错误，不关单', async () => {
    const { tool, tickets } = build(ticketOf({ creator: { id: 'someone-else', name: '李四' } }))
    const res = await tool.execute({ id: 'TK1' }, ctx())
    expect(tickets.update).not.toHaveBeenCalled()
    expect((res.result as { error: string }).error).toContain('不是您本人创建的')
  })

  it('已关闭的工单幂等跳过，不重复写库', async () => {
    const { tool, tickets } = build(ticketOf({ status: 'closed' }))
    const res = await tool.execute({ id: 'TK1' }, ctx())
    expect(tickets.update).not.toHaveBeenCalled()
    expect(res.result).toMatchObject({ ticketId: 'TK1', status: 'closed' })
    expect((res.result as { message: string }).message).toContain('已是关闭状态')
  })

  it('本人的未关闭工单：走 update 关单，写入时间线', async () => {
    const { tool, tickets } = build(ticketOf())
    const res = await tool.execute({ id: 'TK1' }, ctx())
    expect(tickets.detail).toHaveBeenCalledWith(owner, 'TK1')
    expect(tickets.update).toHaveBeenCalledWith(owner, 'TK1', { status: 'closed' })
    expect(res.result).toMatchObject({ ticketId: 'TK1', status: 'closed', message: '工单已关闭' })
    expect(res.summary).toContain('已关闭工单「重置密码」')
  })
})
