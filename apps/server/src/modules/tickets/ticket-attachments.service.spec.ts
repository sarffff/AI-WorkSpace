import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import type { PrismaService } from '@/prisma/prisma.service'
import type { TicketAttachmentStore } from './ticket-attachment.store'
import { TicketAttachmentsService } from './ticket-attachments.service'

// 行为依据（与实现一致）：
// - 可见性沿用工单：员工仅本人创建的工单，越权/不存在回 NotFound
// - 上传先落库拿 id 再写盘，写盘失败回滚 DB 行（不留下载即 404 的幽灵附件）
// - 下载/删除都校验附件属于该工单；删除限上传者或坐席
// - 工单不存在时一律 NotFound（不泄露存在性）

const employee = { id: 'u1', role: 'employee' }
const staff = { id: 'admin1', role: 'admin' }

function make(fx: {
  ticket?: { id: string; creatorId: string } | null
  attachment?: Record<string, unknown> | null
  bytes?: Buffer | null
  writeError?: Error
}) {
  const calls: Record<string, unknown[]> = { create: [], delete: [], write: [], remove: [] }
  const prisma = {
    ticket: {
      findUnique: async () => (fx.ticket === undefined ? { id: 't1', creatorId: 'u1' } : fx.ticket),
    },
    ticketAttachment: {
      create: async (a: { data: Record<string, unknown> }) => {
        calls.create.push(a.data)
        return { id: 'att-1', ...a.data }
      },
      findMany: async () => [fx.attachment ?? { id: 'att-1', filename: 'a.png' }],
      findUnique: async () => fx.attachment,
      delete: async (a: unknown) => {
        calls.delete.push(a)
        return {}
      },
    },
  }
  const store = {
    write: async (id: string, buf: Buffer) => {
      calls.write.push({ id, size: buf.length })
      if (fx.writeError) throw fx.writeError
    },
    read: async () => (fx.bytes === undefined ? Buffer.from('x') : fx.bytes),
    remove: async (id: string) => {
      calls.remove.push(id)
    },
    removeMany: async () => undefined,
  }
  const service = new TicketAttachmentsService(
    prisma as unknown as PrismaService,
    store as unknown as TicketAttachmentStore,
  )
  return { service, calls }
}

const fileOf = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    originalname: 'screenshot.png',
    mimetype: 'image/png',
    size: 3,
    buffer: Buffer.from('abc'),
    ...over,
  }) as Express.Multer.File

describe('TicketAttachmentsService.add', () => {
  it('可见工单：落库 + 写盘，返回元数据', async () => {
    const { service, calls } = make({ ticket: { id: 't1', creatorId: 'u1' } })
    const res = await service.add(employee, 't1', fileOf())
    expect(res).toMatchObject({ id: 'att-1', filename: 'screenshot.png', mimeType: 'image/png' })
    expect(calls.create).toHaveLength(1)
    expect(calls.write).toEqual([{ id: 'att-1', size: 3 }])
  })

  it('未收到文件 → 400', async () => {
    const { service } = make({ ticket: { id: 't1', creatorId: 'u1' } })
    await expect(service.add(employee, 't1', undefined)).rejects.toThrow(BadRequestException)
  })

  it('员工传他人工单 → NotFound（不泄露存在性）', async () => {
    const { service } = make({ ticket: { id: 't1', creatorId: 'someone' } })
    await expect(service.add(employee, 't1', fileOf())).rejects.toThrow(NotFoundException)
  })

  it('写盘失败回滚 DB 行，异常上抛', async () => {
    const { service, calls } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      writeError: new Error('disk full'),
    })
    await expect(service.add(employee, 't1', fileOf())).rejects.toThrow('disk full')
    expect(calls.delete).toHaveLength(1) // 空记录被回滚删除
  })
})

describe('TicketAttachmentsService.getForDownload', () => {
  it('附件属于该工单且字节存在：返回文件名/类型/字节', async () => {
    const { service } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      attachment: {
        id: 'att-1',
        ticketId: 't1',
        filename: 'a.png',
        mimeType: 'image/png',
        size: 1,
      },
      bytes: Buffer.from('img'),
    })
    const res = await service.getForDownload(employee, 't1', 'att-1')
    expect(res.filename).toBe('a.png')
    expect(res.bytes.toString()).toBe('img')
  })

  it('附件不属于该工单 → NotFound（防借道读取）', async () => {
    const { service } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      attachment: { id: 'att-1', ticketId: 'OTHER', filename: 'a.png', mimeType: 'x', size: 1 },
    })
    await expect(service.getForDownload(employee, 't1', 'att-1')).rejects.toThrow(NotFoundException)
  })

  it('字节丢失 → NotFound', async () => {
    const { service } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      attachment: { id: 'att-1', ticketId: 't1', filename: 'a.png', mimeType: 'x', size: 1 },
      bytes: null,
    })
    await expect(service.getForDownload(employee, 't1', 'att-1')).rejects.toThrow('已丢失')
  })
})

describe('TicketAttachmentsService.remove', () => {
  it('上传者本人可删：删行 + 删文件', async () => {
    const { service, calls } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      attachment: { id: 'att-1', ticketId: 't1', uploaderId: 'u1' },
    })
    const res = await service.remove(employee, 't1', 'att-1')
    expect(res).toEqual({ success: true })
    expect(calls.delete).toHaveLength(1)
    expect(calls.remove).toEqual(['att-1'])
  })

  it('坐席可删他人上传的附件', async () => {
    const { service, calls } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      attachment: { id: 'att-1', ticketId: 't1', uploaderId: 'u1' },
    })
    await service.remove(staff, 't1', 'att-1')
    expect(calls.remove).toEqual(['att-1'])
  })

  it('员工删非本人上传的附件 → Forbidden（保护坐席留的证据）', async () => {
    const { service } = make({
      ticket: { id: 't1', creatorId: 'u1' },
      attachment: { id: 'att-1', ticketId: 't1', uploaderId: 'admin1' },
    })
    await expect(service.remove(employee, 't1', 'att-1')).rejects.toThrow(ForbiddenException)
  })
})
