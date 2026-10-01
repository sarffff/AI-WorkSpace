import { Logger } from '@nestjs/common'
import { mkdtemp, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ConfigService } from '@nestjs/config'
import { ChatAttachmentStore, isSafeChatAttachmentId } from './chat-attachment.store'

// 行为依据（与实现一致）：
// - 附件 id 直接拼进文件路径，所以显式校验字符集：穿越型 id 一律拒绝
// - write 失败必须抛（调用方要"写盘成功才落库"）；read 文件不存在返回 null
// - remove 幂等：不存在当作已达成目的；非法 id 也不抛

async function makeStore(dir?: string) {
  const base = dir ?? (await mkdtemp(join(tmpdir(), 'chat-attach-')))
  const config = { get: () => base } as unknown as ConfigService
  return { store: new ChatAttachmentStore(config), base }
}

describe('ChatAttachmentStore', () => {
  it('写读往返一致', async () => {
    const { store } = await makeStore()
    const id = '0f1e2d3c-4b5a-6978-8a7b-6c5d4e3f2a1b'
    await store.write(id, Buffer.from('日志正文\n第二行', 'utf8'))
    expect((await store.read(id))?.toString('utf8')).toBe('日志正文\n第二行')
  })

  it('目录不存在时自动建', async () => {
    const base = await mkdtemp(join(tmpdir(), 'chat-attach-parent-'))
    const nested = join(base, 'attachments')
    const { store } = await makeStore(nested)
    await store.write('abc123', Buffer.from('x'))
    expect(await readdir(nested)).toEqual(['abc123.bin'])
  })

  it('拒绝路径穿越与非法字符的 id', async () => {
    // 这条用例本就该触发拒绝日志，静音掉才不会淹掉别处的真错误
    const err = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    const { store, base } = await makeStore()
    for (const bad of ['../../etc/passwd', 'a/b', 'a\\b', '..', 'x'.repeat(65), 'id with space']) {
      expect(isSafeChatAttachmentId(bad)).toBe(false)
      await expect(store.write(bad, Buffer.from('x'))).rejects.toThrow('非法附件 id')
      expect(await store.read(bad)).toBeNull()
      await expect(store.remove(bad)).resolves.toBeUndefined()
    }
    // 一个字节都不该落到盘上
    expect(await readdir(base)).toEqual([])
    err.mockRestore()
  })

  it('读不存在的附件返回 null，删除不存在的附件不抛', async () => {
    const { store } = await makeStore()
    expect(await store.read('deadbeef')).toBeNull()
    await expect(store.remove('deadbeef')).resolves.toBeUndefined()
    await expect(store.removeMany(['deadbeef', 'cafe'])).resolves.toBeUndefined()
  })
})
