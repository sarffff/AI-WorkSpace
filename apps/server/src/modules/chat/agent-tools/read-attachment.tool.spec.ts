import type { PrismaService } from '@/prisma/prisma.service'
import type { ChatAttachmentStore } from '../chat-attachment.store'
import { ReadAttachmentTool, ATTACHMENT_READ_CHARS } from './read-attachment.tool'
import type { ToolContext } from './types'

// 行为依据（与实现一致）：
// - 只读、按会话限定：别会话的附件 id 一律"查无"，不暴露存在性
// - 文本白名单之外的（图片等二进制）直接告诉模型读不了，不喂乱码
// - 全文截到 ATTACHMENT_READ_CHARS，并如实标 truncated
// - 缺 chatId 的调用上下文（不属于任何会话）不查库

interface Row {
  id: string
  chatId: string
  name: string
}

function make(rows: Row[], bytes: Record<string, Buffer | null> = {}) {
  const seen: Record<string, unknown> = {}
  const prisma = {
    chatAttachment: {
      findFirst: async (a: { where: Record<string, unknown> }) => {
        seen.where = a.where
        return rows.find((r) => r.id === a.where.id && r.chatId === a.where.chatId) ?? null
      },
    },
  }
  const store = {
    read: async (id: string) => (id in bytes ? bytes[id] : Buffer.from('磁盘上的原文')),
  } as unknown as ChatAttachmentStore
  const tool = new ReadAttachmentTool(prisma as unknown as PrismaService, store)
  return { tool, seen }
}

const ctx = (chatId?: string) => ({ chatId }) as unknown as ToolContext

describe('ReadAttachmentTool', () => {
  it('读取本会话文本附件的全文', async () => {
    const { tool, seen } = make([{ id: 'att-1', chatId: 'c1', name: 'vpn.log' }])
    const res = await tool.execute({ attachment_id: 'att-1' }, ctx('c1'))
    expect(seen.where).toMatchObject({ id: 'att-1', chatId: 'c1' })
    expect(res.result).toMatchObject({ name: 'vpn.log', chars: 6, truncated: false })
    expect(res.summary).toContain('vpn.log')
  })

  it('别会话的附件 id 报"不存在"，而不是"无权"', async () => {
    const { tool } = make([{ id: 'att-1', chatId: 'c2', name: 'secret.log' }])
    const res = await tool.execute({ attachment_id: 'att-1' }, ctx('c1'))
    expect(res.result).toMatchObject({ message: expect.stringContaining('不属于本会话') })
    expect(res.summary).toBe('附件不存在')
  })

  it('没有会话上下文时不去查库', async () => {
    const { tool, seen } = make([{ id: 'att-1', chatId: 'c1', name: 'vpn.log' }])
    const res = await tool.execute({ attachment_id: 'att-1' }, ctx(undefined))
    expect(seen.where).toBeUndefined()
    expect(res.result).toMatchObject({ message: expect.stringContaining('缺少会话上下文') })
  })

  it('图片等二进制附件拒绝读取，不把乱码喂给模型', async () => {
    const { tool } = make([{ id: 'att-9', chatId: 'c1', name: 'shot.png' }])
    const res = await tool.execute({ attachment_id: 'att-9' }, ctx('c1'))
    expect(res.result).toMatchObject({ message: expect.stringContaining('不可读') })
    expect(res.summary).toContain('shot.png')
  })

  it('超长全文截断并如实标记', async () => {
    const long = 'x'.repeat(ATTACHMENT_READ_CHARS + 500)
    const { tool } = make([{ id: 'att-1', chatId: 'c1', name: 'big.txt' }], {
      'att-1': Buffer.from(long, 'utf8'),
    })
    const res = await tool.execute({ attachment_id: 'att-1' }, ctx('c1'))
    expect(res.result).toMatchObject({ chars: ATTACHMENT_READ_CHARS, truncated: true })
  })

  it('元数据在、字节丢了：如实说读不到，不编内容', async () => {
    const { tool } = make([{ id: 'att-1', chatId: 'c1', name: 'gone.txt' }], { 'att-1': null })
    const res = await tool.execute({ attachment_id: 'att-1' }, ctx('c1'))
    expect(res.result).toMatchObject({ message: expect.stringContaining('已丢失') })
    expect(res.summary).toBe('附件字节丢失')
  })
})
